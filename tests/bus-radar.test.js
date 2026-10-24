import test from "node:test";
import assert from "node:assert/strict";
import { radarStop, radarBuses } from "../public/js/bus-radar.js";

const ids = ["a", "b", "c", "d", "e"];
const network = {
  stops: new Map(ids.map((id) => [id, { id, name: { a: "北野", b: "千本", c: "堀川", d: "烏丸", e: "銀閣寺道" }[id], type: "citybus" }])),
  services: [
    { operator: "citybus", route: "204", stops: ["a", "b", "c", "d", "e"] },
    { operator: "citybus", route: "204", stops: ["e", "d", "c", "b", "a"] },
  ],
};
const geo = { stops: ids.map((id, i) => ({ id, lat: 35 + i * 0.001, lng: 135.7 })) };
const now = Date.parse("2026-10-24T01:00:00Z");
const live = (results) => ({ source: "live", stale: false, asOf: new Date(now - 10000).toISOString(), results });

test("an approaching bus is placed at the stop it was reported at", () => {
  const buses = radarBuses({
    stop: network.stops.get("d"),
    data: live([{ route: "204", dest: "銀閣寺", stopsAway: 2, source: "live" }]),
    network,
    geo,
    now,
  });
  assert.equal(buses.length, 1);
  assert.equal(buses[0].atName, "千本");
  assert.equal(buses[0].from.lat, geo.stops[1].lat);
  assert.equal(buses[0].route, "204");
});

test("the direction comes from the headsign", () => {
  const [bus] = radarBuses({
    stop: network.stops.get("c"),
    data: live([{ route: "204", dest: "北野", stopsAway: 1, source: "live" }]),
    network,
    geo,
    now,
  });
  assert.equal(bus.atName, "烏丸");
});

test("nothing is drawn from stale, scheduled or unplaceable rows", () => {
  const stop = network.stops.get("d");
  assert.deepEqual(radarBuses({ stop, data: { ...live([{ route: "204", dest: "銀閣寺", stopsAway: 1, source: "live" }]), stale: true }, network, geo, now }), []);
  assert.deepEqual(radarBuses({ stop, data: live([{ route: "204", dest: "銀閣寺", minutes: 4, source: "schedule" }]), network, geo, now }), []);
  assert.deepEqual(radarBuses({ stop, data: live([{ route: "204", dest: "銀閣寺", stopsAway: 7, source: "live" }]), network, geo, now }), []);
});

test("the radar stop is the nearest city bus stop within 500 m", () => {
  const rows = [
    { id: "K07", meters: 30, stop: { type: "subway" } },
    { id: "d", meters: 120, stop: { type: "citybus" } },
    { id: "far", meters: 900, stop: { type: "citybus" } },
  ];
  assert.equal(radarStop(rows).id, "d");
  assert.equal(radarStop([{ id: "far", meters: 900, stop: { type: "citybus" } }]), null);
});

test("a bus between stops is placed by its reported minutes and moves on with the clock", async () => {
  const { busPosition, RADAR_MAX_PROGRESS, BUS_METRES_PER_MINUTE } = await import("../public/js/bus-radar.js");
  // Stops 1.1 km apart: each segment takes 1112 m at the average bus pace.
  const wide = { stops: ids.map((id, i) => ({ id, lat: 35 + i * 0.01, lng: 135.7 })) };
  const segment = 1111.95 / BUS_METRES_PER_MINUTE;
  const [bus] = radarBuses({
    stop: network.stops.get("d"),
    data: live([{ route: "204", dest: "銀閣寺", stopsAway: 2, minutes: segment * 1.5, source: "live" }]),
    network,
    geo: wide,
    now: Date.parse(live([]).asOf),
  });
  // Two segments from 千本, one and a half left: halfway along 千本→堀川.
  assert.ok(Math.abs(bus.progress - 0.5) < 0.01, String(bus.progress));
  const later = busPosition(bus, bus.reportedAt + (segment / 4) * 60000);
  assert.ok(Math.abs(later.along - 0.75) < 0.01, String(later.along));
  // It never reaches the next stop before the operator reports it there.
  assert.equal(busPosition(bus, bus.reportedAt + 3600000).along, RADAR_MAX_PROGRESS);
});

test("with no minutes reported a bus starts a quarter of the way along", async () => {
  const { RADAR_UNKNOWN_START } = await import("../public/js/bus-radar.js");
  const [bus] = radarBuses({
    stop: network.stops.get("d"),
    data: live([{ route: "204", dest: "銀閣寺", stopsAway: 2, source: "live" }]),
    network,
    geo,
    now: Date.parse(live([]).asOf),
  });
  assert.equal(bus.progress, RADAR_UNKNOWN_START);
});

test("on a loop the direction is the one that reaches the headsign soonest", async () => {
  const { serviceFor } = await import("../public/js/bus-radar.js");
  const names = { p: "九条車庫前", q: "東福寺", r: "祇園", x: "熊野神社前", y: "丸太町七本松", s: "円町", t: "西大路駅前" };
  const loop = {
    stops: new Map(Object.entries(names).map(([id, name]) => [id, { id, name }])),
    services: [
      { id: "cw", operator: "citybus", route: "202", stops: ["p", "q", "r", "x", "y", "s", "t", "p"] },
      { id: "ccw", operator: "citybus", route: "202", stops: ["p", "t", "s", "y", "x", "r", "q", "p"] },
    ],
  };
  assert.equal(serviceFor({ route: "202", dest: "祇園・熊野神社" }, "q", loop).service.id, "cw");
  assert.equal(serviceFor({ route: "202", dest: "西大路駅・円町" }, "q", loop).service.id, "ccw");
});

test("a new report of the same bus never moves it backwards", async () => {
  const timed = { ...network, services: network.services.map((s) => ({ ...s, offsets: [0, 4, 8, 12, 16] })) };
  const args = { stop: timed.stops.get("d"), network: timed, geo };
  const first = radarBuses({ ...args, data: live([{ route: "204", dest: "銀閣寺", stopsAway: 2, source: "live" }]), now });
  const t = now + 120000;
  const data = { ...live([{ route: "204", dest: "銀閣寺", stopsAway: 2, source: "live" }]), asOf: new Date(t).toISOString() };
  const [again] = radarBuses({ ...args, data, now: t, previous: first });
  assert.ok(again.along > 0.4, String(again.along));
});

test("a row with no stop count (接近なし, after the last bus) is never drawn at the stop", () => {
  const buses = radarBuses({
    stop: network.stops.get("d"),
    data: live([
      { route: "204", dest: "銀閣寺", stopsAway: null, minutes: null, status: "接近なし", source: "live" },
      { route: "204", dest: "銀閣寺", source: "live" },
    ]),
    network,
    geo,
    now,
  });
  assert.deepEqual(buses, []);
});

test("loop-less routes are 甲 heading west and 乙 heading east", async () => {
  const { lineSide } = await import("../public/js/bus-direction.js");
  const located = new Map([["w", { lat: 35, lng: 135.70 }], ["e", { lat: 35, lng: 135.78 }]]);
  assert.equal(lineSide({ stops: ["e", "w"] }, located), "kou");
  assert.equal(lineSide({ stops: ["w", "e"] }, located), "otsu");
  assert.equal(lineSide({ stops: ["w", "e", "x", "w"] }, located), null);
});
