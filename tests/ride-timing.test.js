import test from "node:test";
import assert from "node:assert/strict";
import { timeRideFromFeed, rideHasTimes, pickTrip } from "../public/js/ride-timing.js";

const untimed = (ids, extra = {}) => ({
  operator: "citybus",
  route: "205",
  from: ids[0],
  serviceId: "bus-205-down",
  depart: null,
  officialStops: ids.map((id) => ({ id, name: id, time: null, arrival: null, departure: null, estimated: false })),
  ...extra,
});

const line = {
  id: "official-bus-205-down",
  operator: "citybus",
  route: "205",
  stops: ["a", "b", "c", "d"],
  officialFallback: true,
  officialStops: [0, 2],
  trips: [
    { id: "t1", departures: [600, 604, 609, 615], arrivals: [600, 604, 609, 615] },
    { id: "t2", departures: [612, 616, 621, 627], arrivals: [612, 616, 621, 627] },
    { id: "t3", departures: [640, 644, 649, 655], arrivals: [640, 644, 649, 655] },
  ],
};

test("乗車した停留所の発車が今に近い便の時刻を各停留所に入れる", () => {
  const ride = untimed(["b", "c", "d"]);
  assert.equal(rideHasTimes(ride), false);
  const timed = timeRideFromFeed(ride, { services: [line] }, { minute: 618 });
  assert.equal(timed.tripId, "t2");
  assert.deepEqual(timed.officialStops.map((s) => s.time), [616, 621, 627]);
  // b and d are segment estimates; c was read from its own board.
  assert.deepEqual(timed.officialStops.map((s) => s.estimated), [true, false, true]);
  assert.equal(timed.depart, null, "the ride keeps its identity");
  assert.equal(timed.scheduledDepart, 616);
  assert.equal(rideHasTimes(timed), true);
});

test("遅れて来る便を優先し、まだ来ない便は近くても重みを倍にする", () => {
  assert.equal(pickTrip(line, 1, 610).trip.id, "t1"); // 604 left 6 min ago vs 616 in 6 → t1 (6 < 12)
  assert.equal(pickTrip(line, 1, 613).trip.id, "t2"); // 9 ago vs 3 ahead (6)
  assert.equal(pickTrip(line, 1, 700), null, "outside the window nothing is guessed");
});

test("系統IDが合わなくても同じ系統・同じ向きの便から時刻を取る", () => {
  const ride = untimed(["c", "d"], { serviceId: "other" });
  const timed = timeRideFromFeed(ride, { services: [line] }, { minute: 650 });
  assert.equal(timed.tripId, "t3");
  // The opposite direction (d → c) is not matched.
  assert.equal(timeRideFromFeed(untimed(["d", "c"], { serviceId: "x" }), { services: [line] }, { minute: 650 }), null);
});

test("循環系統は一周の続きを同じ便の区間時間で推定する", () => {
  const loop = {
    id: "official-bus-205-down",
    route: "205",
    stops: ["a", "b", "c", "a"],
    trips: [{ id: "L", departures: [600, 605, 612, 620] }],
  };
  const ride = untimed(["b", "c", "a", "b"]);
  const timed = timeRideFromFeed(ride, { services: [loop] }, { minute: 606 });
  assert.deepEqual(timed.officialStops.map((s) => s.time), [605, 612, 620, 625]);
  assert.deepEqual(timed.officialStops.map((s) => s.estimated), [false, false, false, true]);
});

test("時刻表がない・便がないときは何も作らない", () => {
  assert.equal(timeRideFromFeed(untimed(["b", "c"]), null, { minute: 600 }), null);
  assert.equal(timeRideFromFeed(untimed(["b", "c"]), { services: [] }, { minute: 600 }), null);
});

test("時刻表で選んだ便（発車時刻あり）は照会し直さない", async () => {
  const { rideNeedsTiming } = await import("../public/js/ride-timing.js");
  assert.equal(rideNeedsTiming(untimed(["b", "c"])), true);
  assert.equal(rideNeedsTiming(untimed(["b", "c"], { depart: 616 })), false);
  assert.equal(rideNeedsTiming(timeRideFromFeed(untimed(["b", "c"]), { services: [line] }, { minute: 616 })), false);
});

test("到着予定を45分過ぎた乗車・開始から3時間たった時刻なしの乗車は終了する", async () => {
  const { rideOverdue } = await import("../public/js/vnext-detect.js");
  const timed = { officialStops: [{ id: "a", time: 600 }, { id: "b", time: 630 }] };
  assert.equal(rideOverdue(timed, { minute: 670 }), false);
  assert.equal(rideOverdue(timed, { minute: 676 }), true);
  assert.equal(rideOverdue(timed, { minute: 676, shift: 10 }), false);
  const untimed = { officialStops: [{ id: "a" }, { id: "b" }] };
  assert.equal(rideOverdue(untimed, { minute: 900, startedAt: 1, at: 2 * 3600000 }), false);
  assert.equal(rideOverdue(untimed, { minute: 900, startedAt: 0, at: 9 * 3600000 }), false);
  assert.equal(rideOverdue(untimed, { minute: 900, startedAt: 1, at: 4 * 3600000 }), true);
});
