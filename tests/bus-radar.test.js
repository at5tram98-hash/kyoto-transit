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
  const { busPosition, RADAR_MAX_PROGRESS } = await import("../public/js/bus-radar.js");
  const timed = { ...network, services: network.services.map((s) => ({ ...s, offsets: [0, 4, 8, 12, 16] })) };
  const [bus] = radarBuses({
    stop: timed.stops.get("d"),
    data: live([{ route: "204", dest: "銀閣寺", stopsAway: 2, minutes: 6, source: "live" }]),
    network: timed,
    geo,
    now: Date.parse(live([]).asOf),
  });
  // 8 scheduled minutes from 千本, 4 of them on the 千本→堀川 segment: 6 left is halfway.
  assert.equal(bus.progress, 0.5);
  assert.ok(Math.abs(bus.lat - (geo.stops[1].lat + geo.stops[2].lat) / 2) < 1e-9);
  const later = busPosition(bus, bus.reportedAt + 60000);
  assert.ok(Math.abs(later.along - 0.75) < 1e-9);
  // It never reaches the next stop before the operator reports it there.
  assert.equal(busPosition(bus, bus.reportedAt + 3600000).along, RADAR_MAX_PROGRESS);
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
