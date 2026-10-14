import test from "node:test";
import assert from "node:assert/strict";
import {
  JOURNEY_KEY,
  journeyKey,
  readJourney,
  writeJourney,
  scheduledJourney,
  scheduledBoarding,
  boardingAvailable,
} from "../public/js/journey-session.js";
import { observeJourney } from "../public/js/journey-observation.js";
import { nearbyDepartures } from "../public/js/nearby-departures.js";
import { foldbackJourney } from "../public/js/boarding.js";

const now = { date: "2026-10-11", minute: 605 };
const network = {
  stops: new Map([
    ["K07", { name: "丸太町", type: "subway" }],
    ["K08", { name: "烏丸御池", type: "subway" }],
    ["K09", { name: "四条", type: "subway" }],
  ]),
};
const ride = {
  operator: "subway",
  from: "K07",
  to: "K09",
  depart: 600,
  arrive: 610,
  serviceDate: now.date,
  officialStops: [
    { id: "K07", name: "丸太町", time: 600 },
    { id: "K08", name: "烏丸御池", time: 605 },
    { id: "K09", name: "四条", time: 610 },
  ],
};
function storage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}
const feed = {
  services: [
    {
      id: "south",
      operator: "subway",
      stops: ["K07", "K08", "K09"],
      trips: [
        {
          id: "trip",
          date: now.date,
          arrivals: [600, 605, 610],
          departures: [600, 605, 610],
          headsign: "四条",
        },
      ],
    },
  ],
};
const validPlan = {
  rideKey: journeyKey(ride),
  stopId: "K08",
  depart: 617,
  date: now.date,
  day: "holiday",
  buffer: 3,
  direction: "north",
  destination: "国際会館",
  tripId: "favorite",
};

test("reload restores the same official trip, observed delay and selected favorite without storing GPS", () => {
  const s = storage(),
    at = Date.now();
  writeJourney(
    s,
    {
      ride,
      rideShift: 4,
      rideSource: "選んだ便",
      rideStartedAt: at - 60000,
      foldbackPlan: validPlan,
      fix: { lat: 35, lng: 135 },
      samples: [{ lat: 35, lng: 135 }],
    },
    { now, at },
  );
  const result = readJourney(s, { now, at, network });
  assert.deepEqual(result.ride, ride);
  assert.equal(result.rideShift, 4);
  assert.deepEqual(result.foldbackPlan, validPlan);
  assert.doesNotMatch(s.getItem(JOURNEY_KEY), /"lat"|"lng"|"samples"|"fix"/);
  writeJourney(s, { ride: null }, { now, at });
  assert.equal(s.getItem(JOURNEY_KEY), null);
});
test("invalid, expired, excessive and unsupported saved journeys are ignored", () => {
  const s = storage(),
    at = Date.now();
  for (const mutate of [
    (v) => (v.ride.operator = "other"),
    (v) => (v.savedAt -= 5 * 3600000),
    (v) => (v.startedAt -= 7 * 3600000),
    (v) => (v.ride.from = "missing"),
    (v) => (v.shift = Infinity),
    (v) => (v.ride.officialStops[0].time = "600"),
    (v) => (v.ride.serviceDate = "invalid"),
    (v) => (v.version = 2),
    (v) => (v.ride.serviceDate = "2026-99-99"),
    (v) => (v.startedAt = at + 120000),
  ]) {
    writeJourney(s, { ride, rideShift: 0, rideStartedAt: at }, { now, at });
    const value = JSON.parse(s.getItem(JOURNEY_KEY));
    mutate(value);
    s.setItem(JOURNEY_KEY, JSON.stringify(value));
    assert.equal(readJourney(s, { now, at, network }), null);
  }
  s.setItem(JOURNEY_KEY, "{bad");
  assert.equal(readJourney(s, { now, at, network }), null);
});
test("expired or unrelated foldback selection is not restored as a valid transfer", () => {
  const s = storage(),
    at = Date.now();
  for (const plan of [
    { ...validPlan, depart: 599 },
    { ...validPlan, rideKey: "different" },
    { ...validPlan, buffer: 99 },
  ]) {
    writeJourney(
      s,
      { ride, rideShift: 0, rideStartedAt: at, foldbackPlan: plan },
      { now, at },
    );
    assert.equal(readJourney(s, { now, at, network }).foldbackPlan, null);
  }
});
test("only an ongoing service can be resumed; overnight times stay on their service date", () => {
  const s = storage(),
    at = Date.now();
  writeJourney(s, { ride, rideShift: 0, rideStartedAt: at }, { now, at });
  assert.equal(
    readJourney(s, { now: { ...now, minute: 645 }, at, network }),
    null,
  );
  assert.equal(
    readJourney(s, { now: { date: "2026-10-12", minute: 5 }, at, network }),
    null,
  );
  const overnight = {
    ...ride,
    depart: 1430,
    arrive: 1470,
    officialStops: [
      { ...ride.officialStops[0], time: 1430 },
      { ...ride.officialStops[2], time: 1470 },
    ],
  };
  writeJourney(
    s,
    { ride: overnight, rideShift: 0, rideStartedAt: at },
    { now: { ...now, minute: 1435 }, at },
  );
  assert.ok(
    readJourney(s, { now: { date: "2026-10-12", minute: 10 }, at, network }),
  );
});
test("unknown bus times retain a bounded session without replacing them with invented times", () => {
  const s = storage(),
    at = Date.now(),
    bus = {
      ...ride,
      operator: "citybus",
      depart: null,
      arrive: null,
      officialStops: ride.officialStops.map((s) => ({ ...s, time: null })),
    };
  writeJourney(s, { ride: bus, rideShift: 0, rideStartedAt: at }, { now, at });
  assert.equal(readJourney(s, { now, at, network }).ride.arrive, null);
  assert.equal(
    readJourney(s, { now, at: at + 3 * 3600000 + 1, network }),
    null,
  );
});
test("storage failures do not prevent the active ride display", () => {
  const s = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("full");
    },
    removeItem() {
      throw Error("blocked");
    },
  };
  assert.doesNotThrow(() => writeJourney(s, { ride, rideShift: 0 }, { now }));
  assert.equal(readJourney(s, { now, network }), null);
});
test("manual boarding rejects a different day or distant departure and accepts an ongoing delayed trip", () => {
  assert.equal(boardingAvailable(ride, now), true);
  assert.equal(boardingAvailable({ operator: "subway" }, now), false);
  assert.equal(boardingAvailable(ride, { ...now, minute: 580 }), false);
  assert.equal(
    boardingAvailable(ride, { date: "2026-10-12", minute: 605 }),
    false,
  );
  assert.equal(boardingAvailable(ride, { ...now, minute: 621 }), false);
});
test("route boarding resolves the original scheduled times and continues to the full terminus", () => {
  const selected = scheduledJourney(
    { serviceId: "south", tripId: "trip", from: "K08", to: "K08", depart: 609 },
    feed,
    network,
    now.date,
  );
  assert.equal(selected.depart, 605);
  assert.equal(selected.to, "K09");
  assert.equal(selected.arrive, 610);
  assert.deepEqual(
    selected.officialStops.map((s) => s.id),
    ["K08", "K09"],
  );
  assert.equal(
    scheduledJourney(
      { serviceId: "south", tripId: "different", from: "K07" },
      feed,
      network,
      now.date,
    ),
    null,
  );
});
const geo = {
  stops: [
    { id: "K08", lat: 35, lng: 135 },
    { id: "K09", lat: 35.01, lng: 135 },
  ],
};
function observe(previous, minute, offset = 0, id = "K08", extra = {}) {
  const at = Date.now() + offset;
  return observeJourney(previous, ride, {
    minute,
    fix: { ...geo.stops.find((s) => s.id === id), accuracy: 10, timestamp: at },
    geo,
    at,
    speed: 0,
    shift: previous?.shift ?? 0,
    ...extra,
  });
}
test("waiting at one stop does not increase delay on repeated GPS updates", () => {
  const first = observe(null, 608),
    waiting = observe(first, 609, 20000),
    later = observe(waiting, 610, 40000);
  assert.equal(first.shift, 3);
  assert.equal(waiting.shift, 3);
  assert.equal(later.shift, 3);
  const next = observe(later, 616, 60000, "K09");
  assert.equal(next.shift, 6);
});
test("terminal confirmation completes after distinct continuous fixes instead of moving the time target", () => {
  let current = observe(null, 613, 0, "K09");
  const start = current.endSince;
  for (const offset of [20000, 40000, 60000, 80000, 100000])
    current = observe(current, 613 + Math.floor(offset / 60000), offset, "K09");
  assert.equal(current.endSince, start);
  assert.equal(current.shift, 3);
  assert.equal(current.arrived, true);
});
test("duplicate GPS fixes, an observation gap and movement do not confirm arrival", () => {
  const first = observe(null, 613, 0, "K09");
  const duplicate = observeJourney(first, ride, {
    minute: 615,
    shift: first.shift,
    geo,
    fix: { ...geo.stops[1], accuracy: 10, timestamp: first.lastFix },
    at: first.lastFix + 100000,
  });
  assert.equal(duplicate.arrived, false);
  assert.equal(observe(first, 615, 100000, "K09").arrived, false);
  assert.equal(observe(first, 613, 20000, "K09", { speed: 3 }).endSince, null);
});
test("arrivals are not shifted earlier while waiting before a scheduled departure", () => {
  const first = observe(null, 602);
  assert.equal(first.shift, 0);
  assert.equal(first.anchorIndex, undefined);
});
test("nearby departures are official, current-day, direction-specific and omit terminus departures", () => {
  const result = nearbyDepartures(feed, "K07", { ...now, minute: 599 });
  assert.equal(
    result.find((g) => g.direction === "south").entries[0].depart,
    600,
  );
  assert.deepEqual(
    nearbyDepartures(feed, "K09", now).flatMap((g) => g.entries),
    [],
  );
  assert.deepEqual(
    nearbyDepartures(feed, "K07", { date: "2026-10-12", minute: 599 }).flatMap(
      (g) => g.entries,
    ),
    [],
  );
  assert.deepEqual(
    nearbyDepartures(feed, "K07", now).flatMap((g) => g.entries),
    [],
  );
});
test("foldback begins the selected opposite train and refuses an unavailable trip or the wrong direction", async () => {
  const plan = {
    ...validPlan,
    depart: 605,
    direction: "south",
    tripId: "trip",
    destination: "四条",
    date: now.date,
  };
  const selected = await foldbackJourney(plan, { network, subwayFeed: feed });
  assert.equal(selected.from, "K08");
  assert.equal(selected.to, "K09");
  assert.equal(selected.depart, 605);
  await assert.rejects(
    () =>
      foldbackJourney(
        { ...plan, direction: "north" },
        { network, subwayFeed: feed },
      ),
    /未取得/,
  );
  await assert.rejects(
    () =>
      foldbackJourney({ ...plan, depart: 607 }, { network, subwayFeed: feed }),
    /未取得/,
  );
});

test("同じ発車分で行先未取得でも方面を守り、同方向で便が一意でない場合は選びません", () => {
  const north = {
    id: "north",
    operator: "subway",
    stops: ["K09", "K08", "K07"],
    trips: [
      {
        id: "north-trip",
        date: now.date,
        arrivals: [600, 605, 610],
        departures: [600, 605, 610],
        headsign: "丸太町",
      },
    ],
  };
  const both = { services: [...feed.services, north] },
    selection = {
      stopId: "K08",
      date: now.date,
      depart: 605,
      direction: "north",
    };
  assert.equal(
    scheduledBoarding(both, selection, network).tripId,
    "north-trip",
  );
  const ambiguous = {
    services: [
      ...both.services,
      {
        ...north,
        id: "other",
        trips: [{ ...north.trips[0], id: "another-trip" }],
      },
    ],
  };
  assert.equal(scheduledBoarding(ambiguous, selection, network), null);
  assert.equal(
    scheduledBoarding(
      ambiguous,
      { ...selection, tripId: "north-trip" },
      network,
    ).tripId,
    "north-trip",
  );
});

test("翌営業日の折り返しは当日の便で代用せず、指定日付の公式全駅時刻を取得する", async (t) => {
  const requests = [];
  const tomorrow = {
    services: feed.services.map((s) => ({
      ...s,
      trips: s.trips.map((trip) => ({
        ...trip,
        date: "2026-10-12",
        arrivals: [0, 5, 10],
        departures: [0, 5, 10],
      })),
    })),
    stops: [...network.stops].map(([id, s]) => ({ id, ...s })),
  };
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(new URL(url));
    return Response.json(tomorrow);
  });
  const selected = await foldbackJourney(
    {
      ...validPlan,
      depart: 1445,
      date: "2026-10-12",
      direction: "south",
      destination: "四条",
      tripId: "trip",
    },
    { network, subwayFeed: feed },
  );
  assert.equal(selected.serviceDate, "2026-10-12");
  assert.equal(selected.depart, 5);
  assert.equal(selected.to, "K09");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get("date"), "2026-10-12");
});

test("24時台の列車を翌営業日の0時台へ置き換えず、元の公式便で折り返す", async () => {
  const late = {
    services: feed.services.map((s) => ({
      ...s,
      trips: s.trips.map((t) => ({
        ...t,
        arrivals: [1460, 1465, 1470],
        departures: [1460, 1465, 1470],
      })),
    })),
  };
  const chosen = await foldbackJourney(
    {
      ...validPlan,
      depart: 1465,
      serviceDepart: 1465,
      direction: "south",
      destination: "四条",
      tripId: "trip",
    },
    { network, subwayFeed: late },
  );
  assert.equal(chosen.serviceDate, now.date);
  assert.equal(chosen.depart, 1465);
  assert.equal(
    boardingAvailable(chosen, { date: "2026-10-12", minute: 25 }),
    true,
  );
});

test("終点で好きな折り返し列車を待つ間は、終了した列車の時刻だけで案内を破棄しない", () => {
  const s = storage(),
    at = Date.now(),
    plan = { ...validPlan, depart: 700 };
  writeJourney(
    s,
    { ride, rideShift: 0, rideStartedAt: at, foldbackPlan: plan },
    { now, at },
  );
  assert.equal(
    readJourney(s, { now: { ...now, minute: 680 }, at, network }).foldbackPlan
      .depart,
    700,
  );
  assert.equal(
    readJourney(s, { now: { ...now, minute: 706 }, at, network }),
    null,
  );
});

test("終点未取得の便も既知の降車駅までの乗車時間を検証できる", () => {
  const ride = {
    operator: "citybus",
    serviceDate: now.date,
    depart: 600,
    arrive: null,
    userDestination: { id: "middle" },
    officialStops: [
      { id: "origin", time: 600 },
      { id: "middle", time: 610 },
      { id: "terminal", time: null },
    ],
  };
  assert.equal(boardingAvailable(ride, now), true);
  assert.equal(
    boardingAvailable({ ...ride, userDestination: { id: "terminal" } }, now),
    false,
  );
  assert.equal(boardingAvailable(ride, { ...now, minute: 650 }), false);
});
