import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeTimetableFeeds,
  applyRealtime,
  reconcileRealtime,
  searchTimetable,
} from "../public/js/search-core.js";
import { planRoutes } from "../public/js/router.js";
import { scheduledJourney } from "../public/js/journey-session.js";
import {
  tripOptions,
  tripChoiceKey,
  replaceJourneyLeg,
  journeyChange,
  makeItinerary,
  advanceItinerary,
  itineraryAction,
  itineraryDestinationChanged,
  readItinerary,
  writeItinerary,
  ITINERARY_KEY,
} from "../public/js/journey-plan.js";

const date = "2026-10-14",
  passes = { subway: false, citybus: false, kyotobus: false },
  stops = new Map([
    ["a", { id: "a", name: "A", type: "subway", subwayKm: 0 }],
    ["b", { id: "b", name: "B", type: "subway", subwayKm: 4 }],
    ["c", { id: "c", name: "C", type: "citybus" }],
    ["d", { id: "d", name: "D", type: "citybus" }],
  ]),
  trip = (id, from, to, serviceDate = date) => ({
    id,
    date: serviceDate,
    arrivals: [from, to],
    departures: [from, to],
    headsign: "D",
  }),
  base = { stops, walks: [{ from: "b", to: "c", minutes: 3 }], services: [] },
  feeds = [
    {
      validDates: [date],
      meta: { operator: "subway" },
      stops: [...stops.values()],
      services: [
        {
          id: "rail",
          operator: "subway",
          label: "地下鉄",
          stops: ["a", "b"],
          platforms: ["1", "2"],
          trips: [
            trip("early", 470, 480),
            trip("current", 480, 490),
            trip("later", 495, 505),
            trip("last", 600, 610),
          ],
        },
        {
          id: "bus",
          operator: "citybus",
          route: "10",
          stops: ["c", "d"],
          trips: [
            trip("previous-bus", 493, 513),
            trip("current-bus", 500, 520),
            trip("next-bus", 525, 545),
          ],
        },
      ],
    },
  ],
  request = {
    from: "a",
    to: "d",
    date,
    start: 479,
    via: [],
    buffer: 3,
    maxWalk: 10,
    trainType: "all",
  },
  network = mergeTimetableFeeds(base, feeds, { date }),
  original = planRoutes(network, request, passes)[0];
const choose = (r, index, id, req = request, net = network) =>
  tripOptions(net, req, r, index).find((c) => c.leg.tripId === id);

test("別便に変えると間に合う後続バスへ乗換・着時刻・所要・案内用tripIdを更新する", () => {
  const copy = structuredClone(original),
    candidate = choose(original, 0, "later"),
    updated = replaceJourneyLeg(
      network,
      request,
      passes,
      original,
      0,
      candidate.key,
    );
  assert.equal(updated.legs[0].tripId, "later");
  assert.equal(updated.legs[2].tripId, "next-bus");
  assert.equal(updated.legs[1].depart, 505);
  assert.equal(updated.time, 545);
  assert.equal(updated.duration, 66);
  assert.equal(updated.transfers, 1);
  assert.equal(updated.fare.additional, 490);
  assert.deepEqual(original, copy);
  const ride = scheduledJourney(updated.legs[0], network, base, date);
  assert.equal(ride.tripId, "later");
  assert.equal(ride.depart, 495);
  assert.equal(journeyChange(original, updated).changedTrips, 2);
});
test("2区間目の早すぎる便は候補で理由を表示し確定を拒否する", () => {
  const option = choose(original, 2, "previous-bus");
  assert.equal(option.available, false);
  assert.match(option.reason, /間に合いません/);
  assert.throws(
    () => replaceJourneyLeg(network, request, passes, original, 2, option.key),
    /間に合いません/,
  );
});
test("2区間目を変えても前の乗車・徒歩を変えない", () => {
  const updated = replaceJourneyLeg(
    network,
    request,
    passes,
    original,
    2,
    choose(original, 2, "next-bus").key,
  );
  assert.deepEqual(updated.legs.slice(0, 2), original.legs.slice(0, 2));
  assert.equal(updated.time, 545);
});
test("最初の便だけ前便へ変えられ、出発時刻と後続接続も更新する", () => {
  const updated = replaceJourneyLeg(
    network,
    request,
    passes,
    original,
    0,
    choose(original, 0, "early").key,
  );
  assert.equal(updated.start, 470);
  assert.equal(updated.legs[2].tripId, "previous-bus");
  assert.equal(updated.time, 513);
});
test("後続の便がなくなった候補で元の経路を壊さない", () => {
  const copy = structuredClone(original);
  assert.throws(
    () =>
      replaceJourneyLeg(
        network,
        request,
        passes,
        original,
        0,
        choose(original, 0, "last").key,
      ),
    /接続がありません/,
  );
  assert.deepEqual(original, copy);
});
test("経由地の滞在を選択便後にも保持する", () => {
  const req = { ...request, via: [{ stop: "b", dwell: 8 }] },
    route = planRoutes(network, req, passes)[0],
    updated = replaceJourneyLeg(
      network,
      req,
      passes,
      route,
      0,
      choose(route, 0, "later", req).key,
    );
  assert.equal(updated.legs[1].kind, "dwell");
  assert.equal(updated.legs[1].minutes, 8);
  assert.equal(updated.legs[1].depart, 505);
  assert.equal(updated.legs[3].tripId, "next-bus");
});
test("定期控除を旅程全体で再計算する", () => {
  const covered = { ...passes, citybus: true },
    updated = replaceJourneyLeg(
      network,
      request,
      covered,
      original,
      0,
      choose(original, 0, "later").key,
    );
  assert.equal(updated.fare.normal, 490);
  assert.equal(updated.fare.additional, 260);
  assert.equal(
    updated.fare.details.find((d) => d.operator === "citybus").covered,
    true,
  );
});
test("降車駅を通過する急行・会社違い・逆方向・別系統を候補に混ぜない", () => {
  const n = {
    ...network,
    services: [
      ...network.services,
      {
        ...network.services[0],
        id: "skip",
        stops: ["a", "d"],
        category: "express",
      },
      { ...network.services[0], id: "reverse", stops: ["b", "a"] },
      { ...network.services[0], id: "other-company", operator: "kintetsu" },
      { ...network.services[1], id: "other-route", route: "11" },
    ],
  };
  assert.ok(
    tripOptions(n, request, original, 0).every(
      (o) => o.leg.serviceId === "rail",
    ),
  );
  assert.ok(
    tripOptions(n, request, original, 2).every(
      (o) => o.leg.serviceId === "bus",
    ),
  );
});
test("到着時刻が未取得の便は推測値を生成せず候補を無効化する", () => {
  const n = {
      ...network,
      services: [
        {
          ...network.services[0],
          trips: [{ ...network.services[0].trips[0], arrivals: [470, null] }],
        },
      ],
    },
    candidate = tripOptions(n, request, original, 0)[0];
  assert.equal(candidate.available, false);
  assert.match(candidate.reason, /取得できません/);
});
test("保存ダイヤの古さと実在する発着番線を候補で保持する", () => {
  const n = mergeTimetableFeeds(
    base,
    [{ ...feeds[0], meta: { operator: "subway", stale: true } }],
    { date },
  );
  const candidate = choose(original, 0, "later", request, n);
  assert.equal(candidate.leg.dataConfidence, "stale");
  assert.equal(candidate.leg.platform, "1");
  assert.equal(candidate.leg.arrivalPlatform, "2");
});
test("同名地点を別交通機関へ誤統合しない", () => {
  const b = {
      ...base,
      stops: new Map([
        ...stops,
        ["rail-A", { id: "rail-A", name: "A", type: "kintetsu" }],
      ]),
    },
    feed = {
      ...feeds[0],
      meta: { operator: "kintetsu" },
      stops: [
        { id: "unknown", name: "A" },
        { id: "b", name: "B" },
      ],
      services: [{ ...feeds[0].services[0], stops: ["unknown", "b"] }],
    };
  assert.equal(mergeTimetableFeeds(b, [feed]).services[0].stops[0], "rail-A");
});
test("翌日の同名tripIdと24:xxを区別し、翌日便の乗車時計を元の運行日に戻す", () => {
  const tomorrow = "2026-10-15",
    next = {
      ...feeds[0],
      validDates: [tomorrow],
      services: [
        { ...feeds[0].services[0], trips: [trip("current", 20, 30, tomorrow)] },
        {
          ...feeds[0].services[1],
          trips: [trip("night-bus", 40, 55, tomorrow)],
        },
      ],
    },
    today = {
      ...feeds[0],
      services: [
        { ...feeds[0].services[0], trips: [trip("current", 1430, 1440)] },
        { ...feeds[0].services[1], trips: [trip("old-bus", 1447, 1460)] },
      ],
    },
    n = mergeTimetableFeeds(base, [today, next], { date }),
    req = { ...request, start: 1425 },
    initial = planRoutes(n, req, passes)[0],
    options = tripOptions(n, req, initial, 0),
    candidate = options.find((o) => o.leg.serviceDate === tomorrow),
    updated = replaceJourneyLeg(n, req, passes, initial, 0, candidate.key),
    ride = scheduledJourney(updated.legs[0], n, base, date);
  assert.equal(new Set(options.map((o) => o.key)).size, 2);
  assert.equal(updated.legs[0].depart, 1460);
  assert.equal(updated.time, 1495);
  assert.equal(ride.serviceDate, tomorrow);
  assert.equal(ride.depart, 20);
});
test("元の到着指定を超える変更は確認用の差分を返す", () => {
  const updated = replaceJourneyLeg(
    network,
    { ...request, timeMode: "arrival", start: 521 },
    passes,
    original,
    0,
    choose(original, 0, "later").key,
  );
  assert.equal(updated.arrivalDeadlineExceeded, 24);
});
test("候補が更新された古い識別子を確定しない", () => {
  assert.throws(
    () => replaceJourneyLeg(network, request, passes, original, 0, "unknown"),
    /開き直してください/,
  );
});
test("全旅程から乗換徒歩・次便・最終地点を引き継ぐ", () => {
  const rides = original.legs.map((l) =>
      l.kind === "ride" ? scheduledJourney(l, network, base, date) : null,
    ),
    plan = makeItinerary(original, rides, { date }, 0, { at: 1000 }),
    action = itineraryAction(plan),
    next = advanceItinerary(plan);
  assert.equal(action.walk, 3);
  assert.equal(action.next.tripId, "current-bus");
  assert.equal(next.legIndex, 2);
  assert.equal(next.phase, "transfer");
  assert.equal(advanceItinerary(next).phase, "arrived");
  assert.equal(plan.phase, "armed");
});
test("選択trip・全区間・次の区間を再読込で復元し、期限切れと破損を拒否する", () => {
  const values = new Map(),
    storage = {
      getItem: (k) => values.get(k),
      setItem: (k, v) => values.set(k, v),
      removeItem: (k) => values.delete(k),
    },
    rides = original.legs.map((l) =>
      l.kind === "ride" ? scheduledJourney(l, network, base, date) : null,
    ),
    plan = makeItinerary(original, rides, { date }, 0, { at: 1000 });
  writeItinerary(storage, plan, 1000);
  assert.equal(
    readItinerary(storage, base, 2000).rides[2].tripId,
    "current-bus",
  );
  assert.equal(readItinerary(storage, base, 5 * 3600000), null);
  values.set(ITINERARY_KEY, "{");
  assert.equal(readItinerary(storage, base, 2000), null);
  writeItinerary(storage, null);
  assert.equal(values.has(ITINERARY_KEY), false);
});

const observedAt = Date.parse("2026-10-14T00:00:00Z"),
  rtContext = { nowMinute: 479, nowEpoch: observedAt };
test("便別・運行日一致の遅れは後続接続を再探索して実便と運賃を更新する", () => {
  const realtime = {
    subway: {
      asOf: observedAt,
      trains: [
        { tripId: "current", serviceId: "rail", serviceDate: date, delay: 15 },
      ],
    },
  };
  const updated = reconcileRealtime(
    network,
    request,
    passes,
    original,
    realtime,
    rtContext,
  );
  assert.equal(updated.legs[0].tripId, "current");
  assert.equal(updated.legs[0].arrive, 505);
  assert.equal(updated.legs[0].realtimeApplied, true);
  assert.equal(updated.legs[2].tripId, "next-bus");
  assert.equal(updated.legs[2].depart, 525);
  assert.equal(updated.time, 545);
  assert.equal(updated.realtimeSource, "live");
  assert.equal(original.time, 520);
});
test("便が特定できない推定は予定便をずらさず乗換危険を表示する", () => {
  const rt = {
    subway: { asOf: observedAt, trains: [{ dest: "D", delay: 15 }] },
  };
  const updated = reconcileRealtime(
    network,
    request,
    passes,
    original,
    rt,
    rtContext,
  );
  assert.equal(updated.legs[0].arrive, 490);
  assert.equal(updated.legs[2].depart, 500);
  assert.equal(updated.time, 520);
  assert.equal(updated.connectionRisk, true);
  assert.equal(updated.realtimeSource, "prediction");
});
test("古い・別運行日の実測を便別の時刻として適用しない", () => {
  const rt = {
    subway: {
      asOf: observedAt - 91000,
      trains: [{ tripId: "current", serviceDate: date, dest: "D", delay: 15 }],
    },
  };
  const updated = reconcileRealtime(
    network,
    request,
    passes,
    original,
    rt,
    rtContext,
  );
  assert.equal(updated.time, 520);
  assert.equal(updated.legs[0].realtime.exact, false);
  const otherDay = {
    subway: {
      asOf: observedAt,
      trains: [
        { tripId: "current", serviceDate: "2026-10-15", dest: "D", delay: 15 },
      ],
    },
  };
  assert.equal(
    reconcileRealtime(network, request, passes, original, otherDay, rtContext)
      .legs[0].realtime.exact,
    false,
  );
});
test("同じ系統に複数接近があれば特定便の遅れと偽装しない", () => {
  const rt = {
    citybus: {
      asOf: observedAt,
      results: [
        { route: "10", dest: "D", minutes: 5, source: "live" },
        { route: "10", dest: "D", minutes: 10, source: "live" },
      ],
    },
  };
  assert.equal(
    applyRealtime(original, rt, { ...rtContext, nowMinute: 490 }).legs[2]
      .realtime,
    null,
  );
});
test("遅延実測により接続が無くなれば無効な全旅程を確定しない", () => {
  const rt = {
    subway: {
      asOf: observedAt,
      trains: [{ tripId: "current", serviceDate: date, delay: 60 }],
    },
  };
  const updated = reconcileRealtime(
    network,
    request,
    passes,
    original,
    rt,
    rtContext,
  );
  assert.equal(updated.connectionUnavailable, true);
  assert.equal(updated.time, 520);
});
test("1本前検索は一律時間引算ではなく前の出発と後続便を探索する", () => {
  const routes = searchTimetable(
    network,
    { ...request, start: 479, previousDeparture: true },
    passes,
  );
  assert.equal(routes[0].start, 470);
  assert.equal(routes[0].legs[0].tripId, "early");
  assert.equal(routes[0].time, 513);
});
test("最後の降車後に徒歩が残ると到着確認まで旅程を保持する", () => {
  const plan = {
    route: {
      legs: [
        { kind: "ride", to: "b" },
        { kind: "walk", from: "b", to: "c", minutes: 3 },
      ],
    },
    legIndex: 0,
    phase: "riding",
  };
  assert.equal(advanceItinerary(plan).phase, "walking");
});

test("降車地点の変更は元の後続旅程への自動進行を無効とする", () => {
  const plan = {
    phase: "riding",
    legIndex: 0,
    route: { legs: [{ kind: "ride", to: "b" }] },
  };
  assert.equal(
    itineraryDestinationChanged(plan, { userDestination: { id: "c" } }),
    true,
  );
  assert.equal(
    itineraryDestinationChanged(plan, { userDestination: { id: "b" } }),
    false,
  );
  assert.equal(
    itineraryDestinationChanged(
      { ...plan, phase: "armed" },
      { userDestination: { id: "c" } },
    ),
    false,
  );
});

test("別便の確定でRealtimeを再照合しても選択tripIdを維持し、遅れを二重加算しない", async () => {
  const { planWorkerJob } = await import("../public/js/planner-worker.js");
  const req = { ...request, to: "b" };
  const initial = planRoutes(network, req, passes)[0];
  const option = choose(initial, 0, "later", req);
  const nowEpoch = Date.parse(`${date}T00:00:00Z`);
  const realtime = {
    subway: {
      asOf: new Date(nowEpoch).toISOString(),
      source: "live",
      trains: [
        { tripId: "later", serviceId: "rail", serviceDate: date, delay: 5 },
      ],
    },
  };
  const result = planWorkerJob({
    base,
    feeds,
    request: req,
    passes,
    action: "replace-leg",
    journey: initial,
    legIndex: 0,
    choiceKey: option.key,
    realtime,
    realtimeContext: { nowMinute: 480, nowEpoch },
    nowEpoch,
  }).journey;
  assert.equal(result.legs[0].tripId, "later");
  assert.equal(result.legs[0].depart, 500);
  assert.equal(result.legs[0].arrive, 510);
  assert.equal(result.legs[0].realtimeApplied, true);
  assert.equal(result.estimatedTime, 510);
  assert.equal(initial.legs[0].tripId, "current");
});

test("選便の実測遅れは公式停車時刻と分けて案内へ渡し、古い・違う便の値は無効化する", async () => {
  const { selectedRideShift, boardingAvailable } =
    await import("../public/js/journey-session.js");
  const epoch = Date.parse(`${date}T00:00:00Z`);
  const leg = {
    ...original.legs[0],
    realtimeApplied: true,
    realtime: {
      exact: true,
      source: "live",
      delay: 20,
      asOf: new Date(epoch).toISOString(),
    },
  };
  const ride = scheduledJourney(leg, network, base, date);
  assert.equal(ride.officialStops[0].departure, 480);
  assert.equal(selectedRideShift(ride, epoch), 20);
  assert.equal(boardingAvailable(ride, { date, minute: 515 }, epoch), true);
  assert.equal(selectedRideShift(ride, epoch + 90001), null);
  assert.equal(
    selectedRideShift({ ...ride, tripId: "different" }, epoch),
    null,
  );
  assert.equal(
    selectedRideShift(
      {
        ...ride,
        selectedObservation: { ...ride.selectedObservation, exact: false },
      },
      epoch,
    ),
    null,
  );
});
