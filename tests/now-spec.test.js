import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createNetwork } from "../public/js/network.js";
import { journeyProgress } from "../public/js/journey-core.js";
import { heroModel, reduceTrainState } from "../public/js/now-model.js";
import {
  north3Feed,
  north3Board,
  north3Day,
} from "../public/js/north3-feed.js";
import { mergeTimetableFeeds } from "../public/js/search-core.js";
import { scheduledJourney } from "../public/js/journey-session.js";
import { parseHyperdia } from "../worker/timetables.js";
import {
  parseBusChoices,
  approachURL,
  directRailSnapshot,
} from "../worker/index.js";
import { snapToPolyline, routeMapModel } from "../public/js/route-map.js";
import { routeConfigFor } from "../public/js/bus-routes.js";
import {
  readSearchPairs,
  saveSearchPair,
} from "../public/js/search-history.js";
import { matchArmedJourney } from "../public/js/ride-state-resolver.js";
import { dateFeed, serviceActive } from "../worker/static-gtfs.js";
const network = createNetwork(
    JSON.parse(readFileSync("public/data/bus-catalog.json")),
  ),
  snapshot = JSON.parse(readFileSync("public/data/north3-timetables.json")),
  geo = JSON.parse(readFileSync("public/data/locations.json"));
const at = 100000,
  stop = (id, time, departure = time) => ({
    id,
    name: network.stops.get(id).name,
    time,
    departure,
  });
const rail = {
  operator: "subway",
  category: "local",
  from: "K08",
  to: "K11",
  depart: 600,
  destination: "竹田",
  officialStops: [
    stop("K08", 600),
    stop("K09", 602),
    stop("K10", 604),
    stop("K11", 606),
  ],
  userDestination: { id: "K11" },
};
const model = (ride, minute, extra = {}) =>
  heroModel(ride, journeyProgress(ride, { minute, at, ...extra }), {
    minute,
    at,
    locationStatus: "unavailable",
    ...extra,
  });
test("LCD hero separates user's destination from train terminus and exposes English/code", () => {
  const m = model({ ...rail, userDestination: { id: "K10" } }, 600.5);
  assert.equal(m.nextStation.code, "K09");
  assert.equal(m.nextStation.en, "Shijo");
  assert.equal(m.userDestination.id, "K10");
  assert.equal(m.destination, "竹田");
  assert.equal(m.confidence, "estimated");
});
test("Without GPS, railway schedules never claim a confirmed approach or stop", () => {
  for (const minute of [600.5, 601.3, 602, 602.5]) {
    const estimated = model(rail, minute);
    assert.equal(estimated.phase, "DEPARTED");
    assert.equal(estimated.estimatedWithoutGps, true);
    assert.equal(estimated.locationConfidence, "unavailable");
  }
  assert.equal(model(rail, 602).nextStation.id, "K09");
  assert.equal(model(rail, 602.5).nextStation.id, "K10");
});
test("Reducer rejects backwards fixes and retains arrival for four seconds", () => {
  const p = { key: "x", index: 2, state: "STOPPED", since: at };
  assert.equal(
    reduceTrainState(p, { key: "x", index: 1, state: "STOPPED" }, at + 10000),
    p,
  );
  assert.equal(
    reduceTrainState(p, { key: "x", index: 3, state: "DEPARTED" }, at + 3000),
    p,
  );
  assert.equal(
    reduceTrainState(p, { key: "x", index: 3, state: "DEPARTED" }, at + 4000)
      .index,
    3,
  );
});
for (const [name, ids, expected] of [
  ["K→B", ["K14", "K15", "B06", "B07"], ["K15", "B05"]],
  ["B→K", ["B06", "K15", "K14", "K13"], ["B05", "K15"]],
])
  test(`Takeda ${name} bridges both station codes before changing line`, () => {
    const ride = {
      ...rail,
      operator: "through",
      from: ids[0],
      officialStops: ids.map((id, i) => stop(id, 600 + i * 3)),
    };
    assert.deepEqual(model(ride, 602).boundary.codes, expected);
    assert.equal(model(ride, 603).boundary.phase, "approaching");
    assert.equal(model(ride, 604).lineId, name === "K→B" ? "B" : "K");
  });
test("Without GPS, a selected destination is shown without an unverified alighting command", () => {
  const m = model({ ...rail, userDestination: { id: "K09" } }, 601);
  assert.equal(m.nextIsDestination, true);
  assert.equal(m.label, "次は");
});
test("Stale rail observations clear stale delay and fall back to scheduled time", () => {
  const m = model(rail, 600.5, {
    shift: 3,
    shiftKnown: true,
    feed: { stale: true, asOf: "2026-01-01T00:00:00Z" },
  });
  assert.equal(m.confidence, "stale");
  assert.equal(m.delayMinutes, null);
  assert.equal(m.arrivalEstimate, 600);
});
test("Missing stop times are unavailable and never synthetic fixed intervals", () => {
  const m = model(
    {
      ...rail,
      officialStops: rail.officialStops.map((s) => ({
        ...s,
        time: null,
        departure: null,
      })),
    },
    601,
  );
  assert.equal(m.confidence, "unavailable");
  assert.equal(m.arrivalEstimate, null);
});
test("North 3 preserves all ten stops in both directions and existing stop IDs", () => {
  const services = network.services.filter((s) => s.route === "北3");
  assert.equal(services.length, 2);
  assert.equal(services[0].stops.length, 10);
  assert.deepEqual(services[1].stops, [...services[0].stops].reverse());
  assert.equal(network.stops.get("bus-109").name, "北大路バスターミナル");
  assert.equal(network.stops.get("bus-141").name, "烏丸北大路");
  assert.ok(
    services[0].stops.every((id) => geo.stops.some((p) => p.id === id)),
  );
});
test("North 3 holiday calendar, joint operators and school-day restrictions survive conversion", () => {
  assert.equal(north3Day("2026-10-12"), "holiday");
  assert.equal(north3Day("2026-10-13"), "weekday");
  assert.equal(north3Day("2028-01-01"), null);
  const ordinary = north3Feed(snapshot, network, "2026-10-13"),
    school = north3Feed(snapshot, network, "2026-10-13", { schoolDay: true });
  assert.ok(
    school.services[0].trips.length > ordinary.services[0].trips.length,
  );
  assert.ok(
    ordinary.services.every((s) =>
      s.trips.every((t) => t.operatingCompany === "citybus"),
    ),
  );
  const joint = school.services[0].trips.find(
    (t) => t.operatingCompany === "kyotobus",
  );
  assert.equal(joint.operatingConditions.schoolDayRequired, true);
  const merged = mergeTimetableFeeds(network, [school]);
  assert.equal(
    merged.services[0].trips.find((t) => t.id === joint.id).operatingCompany,
    "kyotobus",
  );
});
test("North 3 stays searchable while estimated terminus times remain labelled", () => {
  const f = north3Feed(snapshot, network, "2026-10-13"),
    s = f.services[0],
    t = s.trips[0];
  assert.equal(s.terminalArrivalDerived, true);
  const ride = scheduledJourney(
    { from: s.stops[0], to: s.stops[4], serviceId: s.id, tripId: t.id },
    f,
    network,
    "2026-10-13",
  );
  assert.equal(ride.officialStops.length, 10);
  assert.equal(ride.userDestination.id, s.stops[4]);
  assert.equal(ride.officialStops.at(-1).estimated, true);
  assert.equal(ride.operatingCompany, "citybus");
  assert.ok(
    north3Board(
      snapshot,
      snapshot.rows[0].name,
      "north",
      "weekday",
    ).entries.some((e) => e.operatingCompany === "kyotobus"),
  );
});
test("Official parentheses preserve Kyoto Bus departures and service conditions", () => {
  const parsed = parseHyperdia(
    '<table><tr><td class="tt-time wek"><h3>平日7時台</h3>3 (10) 17</td></tr></table>',
  );
  assert.deepEqual(
    parsed.days.weekday.map((e) => e.depart),
    [423, 430, 437],
  );
  assert.equal(parsed.days.weekday[1].operatingCompany, "kyotobus");
  assert.equal(
    parsed.days.weekday[1].operatingConditions.schoolDayRequired,
    true,
  );
});
test("North 3 official N030 route identifiers are accepted, unrelated routes rejected", () => {
  const choices = parseBusChoices(
    '<li class="route-row-data"><input name="rowCheckDataItem" value="N03010001;10055:29459:3"><p id="destinationAbbreviation_div_data">京都産大</p></li>',
  );
  assert.equal(choices[0].route, "北3");
  assert.equal(
    new URL(approachURL("東元町", choices[0].value)).searchParams.get(
      "destinationCd",
    ),
    "N03010001",
  );
  assert.throws(() => approachURL("東元町", "N08010001;1:2:3"));
});
test("GPS snapping rejects stale fixes, remote points, and unverified changed routes", () => {
  const fix = { lat: 35.05, lng: 135.75, accuracy: 10, timestamp: at };
  const points = [
    [135.75, 35.04],
    [135.75, 35.06],
  ];
  assert.equal(snapToPolyline(fix, points, { at }).lng, 135.75);
  assert.equal(snapToPolyline(fix, points, { at: at + 60000 }), null);
  assert.equal(snapToPolyline({ ...fix, lng: 135.8 }, points, { at }), null);
  const m = routeMapModel(rail, journeyProgress(rail, { minute: 601 }), {
    geo,
    fix,
    routeConfig: routeConfigFor("北3", { verified: false, shape: points }),
    at,
  });
  assert.equal(m.source, "unavailable");
  assert.equal(m.position, null);
});

test("Unverified diversions clear next position and arrival instead of retaining old observations", () => {
  const m = model({ ...rail, routeVariant: { verified: false } }, 601, {
    feed: { source: "live" },
    fix: { timestamp: at, lat: 35.01, lng: 135.75, accuracy: 10 },
    locationStatus: "active",
  });
  assert.equal(m.confidence, "unavailable");
  assert.equal(m.nextStation, null);
  assert.equal(m.arrivalEstimate, null);
  assert.equal(m.locationConfidence, "unavailable");
});
test("Search history is bounded, deduplicated, resilient to corrupt or disabled storage, and stores no GPS", () => {
  const values = new Map(),
    storage = {
      getItem: (k) => values.get(k),
      setItem: (k, v) => values.set(k, v),
    };
  for (let i = 0; i < 10; i++)
    saveSearchPair(storage, {
      from: "丸太町",
      to: "行先" + i,
      lat: 35,
      lng: 135,
    });
  assert.equal(readSearchPairs(storage).history.length, 5);
  assert.equal(readSearchPairs(storage).history[0].to, "行先9");
  saveSearchPair(storage, { from: "丸太町", to: "行先9" });
  assert.equal(readSearchPairs(storage).history.length, 5);
  assert.equal([...values.values()][0].includes("lat"), false);
  assert.deepEqual(readSearchPairs({ getItem: () => "{broken" }), {
    history: [],
    favorites: [],
  });
  assert.doesNotThrow(() =>
    saveSearchPair(null, { from: "丸太町", to: "京都" }),
  );
});
test("Full station timetable retains the origin before the selected boarding station", () => {
  const feed = {
    services: [
      {
        id: "s",
        operator: "subway",
        stops: ["K07", "K08", "K09", "K10", "K11"],
        trips: [
          {
            id: "t",
            date: "2026-10-13",
            arrivals: [595, 600, 602, 604, 606],
            departures: [595, 600, 602, 604, 606],
          },
        ],
      },
    ],
  };
  const ride = scheduledJourney(
    { serviceId: "s", tripId: "t", from: "K08", to: "K10" },
    feed,
    network,
    "2026-10-13",
  );
  assert.equal(ride.fullOfficialStops[0].id, "K07");
  assert.equal(ride.officialStops[0].id, "K08");
  assert.equal(ride.userDestination.id, "K10");
  assert.equal(ride.officialStops.at(-1).id, "K11");
});

test("Armed North 3 requires matching route, direction, time and fresh approach observations", () => {
  const f = north3Feed(snapshot, network, "2026-10-13"),
    service = f.services[0],
    trip = service.trips[0];
  const ride = scheduledJourney(
    {
      serviceId: service.id,
      tripId: trip.id,
      from: service.stops[0],
      to: service.stops[6],
    },
    f,
    network,
    "2026-10-13",
  );
  const candidate = {
    ride: {
      operator: "citybus",
      route: "北3",
      from: service.stops[2],
      destination: "京都産大",
      officialStops: ride.officialStops
        .slice(2)
        .map((s) => ({ ...s, time: null })),
    },
    score: 78,
    source: "接近＋位置",
    live: {
      destination: "京都産大",
      capturedAt: new Date(at).toISOString(),
      buses: [{ stopsAway: 1 }],
    },
  };
  const matched = matchArmedJourney(
    [candidate],
    { ride },
    trip.departures[2],
    at,
  )[0];
  assert.equal(matched.armedMatch, true);
  assert.equal(matched.score, 90);
  assert.equal(matched.ride.userDestination.id, service.stops[6]);
  const wrong = matchArmedJourney(
    [{ ...candidate, ride: { ...candidate.ride, route: "204" } }],
    { ride },
    trip.departures[2],
    at,
  )[0];
  assert.equal(wrong.armedMatch, undefined);
  const stale = matchArmedJourney(
    [candidate],
    { ride },
    trip.departures[2],
    at + 180000,
  )[0];
  assert.equal(stale.score, 78);
});

test("Native Kintetsu uses B05 at Takeda; a through ride after the boundary keeps the local line", () => {
  const native = {
    ...rail,
    operator: "kintetsu",
    from: "B02",
    officialStops: ["B02", "K15", "B06"].map((id, i) => stop(id, 600 + i * 3)),
  };
  const m = model(native, 602);
  assert.equal(m.lineId, "B");
  assert.equal(m.nextStation.code, "B05");
  assert.equal(m.boundary, null);
  const inside = {
    ...rail,
    operator: "through",
    officialStops: ["K10", "K09", "K08"].map((id, i) => stop(id, 600 + i * 3)),
  };
  assert.equal(model(inside, 602).lineId, "K");
});

test("GTFS road shapes reach the selected bus journey and weekdays use the service date", () => {
  const raw = {
    operator: "citybus",
    source: "fixture",
    stops: [],
    routes: [{ id: "r", shortName: "北3" }],
    trips: [
      {
        id: "t",
        routeId: "r",
        serviceId: "weekday",
        shapeId: "road",
        stops: ["a", "b"],
        arrivals: [600, 605],
        departures: [600, 605],
        headsign: "終点",
      },
    ],
    calendar: [
      {
        serviceId: "weekday",
        start: "2026-10-01",
        end: "2026-10-31",
        week: [true, true, true, true, true, false, false],
      },
    ],
    shapes: [
      {
        id: "road",
        points: [
          [135.75, 35.04],
          [135.75, 35.05],
          [135.76, 35.05],
        ],
      },
    ],
  };
  assert.equal(serviceActive(raw, "weekday", "2026-10-12"), true);
  assert.equal(serviceActive(raw, "weekday", "2026-10-11"), false);
  const f = dateFeed(raw, "2026-10-12");
  assert.deepEqual(
    f.services[0].routeVariants.road.shape,
    raw.shapes[0].points,
  );
  assert.equal(f.services[0].trips[0].shapeId, "road");
  const n = {
      stops: new Map([
        ["a", { name: "出発" }],
        ["b", { name: "終点" }],
      ]),
    },
    ride = scheduledJourney(
      { serviceId: f.services[0].id, tripId: "t", from: "a", to: "b" },
      f,
      n,
      "2026-10-12",
    );
  assert.equal(ride.routeVariant.verified, true);
  raw.shapes[0].points[0][0] = NaN;
  assert.deepEqual(dateFeed(raw, "2026-10-12").services[0].routeVariants, {});
});

test("A moving train near its upcoming platform does not skip straight to the following station", () => {
  const p = geo.stops.find((s) => s.id === "K09"),
    fix = { ...p, accuracy: 10, timestamp: at, speed: 6 };
  const m = model(rail, 601.8, { fix, geo, locationStatus: "active" });
  assert.equal(m.nextStation.id, "K09");
  assert.equal(m.phase, "APPROACHING");
  assert.equal(m.confidence, "estimated");
});

test("Rail positions use server-rendered official markup without launching a browser and retain fallback", async () => {
  const html = `<body>2026/10/12 21:49 現在<div id="stations">${Array.from({ length: 26 }, (_, i) => `<div data-stationid="B${String(i + 1).padStart(2, "0")}"><span class="station-name">駅${i + 1}</span></div>`).join("")}</div><div id="train-points-up"><div class="cell-3"><div class="train-info-up"><span class="train-destination-text">大和西大寺</span><img src="tr_r_01.png"></div></div></div><div id="train-points-down"></div></body>`;
  let browserCalls = 0;
  const env = {
      BROWSER: {
        quickAction: async (_action, options) => {
          browserCalls++;
          // Background requests never settle, but train markup is ready once
          // its own selector appears. Station-only extraction is incomplete.
          if (options.gotoOptions.waitUntil === 'networkidle2')
            throw Error('Navigation timeout: background traffic');
          if (!options.waitForSelector.selector.includes('.train-info-'))
            return new Response(html.replace(/<div class="train-info-up">[\s\S]*?<\/div>/, ''));
          return new Response(html);
        },
      },
    },
    at = new Date("2026-10-12T12:50:00Z");
  const direct = await directRailSnapshot(env, {
    at,
    fetcher: async () => new Response(html),
  });
  assert.equal(direct.trains.length, 1);
  assert.equal(browserCalls, 0);
  const fallback = await directRailSnapshot(env, {
    at,
    fetcher: async () => new Response("", { status: 503 }),
  });
  assert.equal(fallback.trains.length, 1);
  assert.equal(browserCalls, 1);
});

test('Rail recovery accepts an empty overnight diagram without waiting for nonexistent trains',async()=>{
  const html=`<body>2026/10/13 02:00 現在<div id="stations">${Array.from({length:26},(_,i)=>`<div data-stationid="B${String(i+1).padStart(2,'0')}"><span class="station-name">駅${i+1}</span></div>`).join('')}</div><div id="train-points-up"></div><div id="train-points-down"></div></body>`;
  const env={BROWSER:{quickAction:async(_action,options)=>{
    if(options.waitForSelector.selector.includes('.train-info-'))throw Error('No overnight train selector exists');
    return new Response(html);
  }}};
  const result=await directRailSnapshot(env,{at:new Date('2026-10-12T17:00:00Z'),fetcher:async()=>new Response('',{status:503})});
  assert.equal(result.trains.length,0);
  assert.equal(result.stations.length,26);
});

test('Rail recovery preserves the Browser Run HTTP failure in its diagnostic',async()=>{
  const env={BROWSER:{quickAction:async()=>new Response('navigation timed out',{status:422})}};
  await assert.rejects(()=>directRailSnapshot(env,{fetcher:async()=>new Response('',{status:503})}),/HTTP 422/);
});
test("地理座標を実地図と同じMercator投影へ変換し、京都の南北順を保つ", async () => {
  const { mapProject, mapViewport, routeMapHTML } = await import(
    "../public/js/route-map.js"
  );
  const north = mapProject([135.75, 35.07], 15),
    south = mapProject([135.75, 35.04], 15);
  assert.ok(north[1] < south[1]);
  assert.equal(north[0], south[0]);
  const points = [
      [135.75, 35.04],
      [135.76, 35.07],
    ],
    view = mapViewport(points);
  for (const p of points) {
    const projected = mapProject(p, view.zoom);
    assert.ok(Math.abs(projected[0] - view.center[0] * 2 ** view.zoom) < 210);
    assert.ok(Math.abs(projected[1] - view.center[1] * 2 ** view.zoom) < 120);
  }
  const html = routeMapHTML(
    {
      points,
      stops: [],
      position: null,
      source: "schedule",
      approximate: true,
    },
    { lineId: "bus", bus: true },
  );
  assert.match(html, /https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png/);
  assert.match(html, /© OpenStreetMap/);
  assert.match(html, /路線は概略/);
  assert.match(html, /data-map-zoom/);
});

test("近鉄線の長距離経路も端点を地図の外へ切らずに全体表示する", async () => {
  const { mapProject, mapViewport } = await import("../public/js/route-map.js");
  const points = [
      [135.759, 35.0],
      [135.785, 34.482],
    ],
    view = mapViewport(points, 180);
  for (const p of points) {
    const [x, y] = mapProject(p, view.zoom);
    assert.ok(Math.abs(x - view.center[0] * 2 ** view.zoom) < 210);
    assert.ok(Math.abs(y - view.center[1] * 2 ** view.zoom) < 90);
  }
});
