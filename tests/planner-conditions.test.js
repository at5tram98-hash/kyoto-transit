import test from "node:test";
import assert from "node:assert/strict";
import { planRoutes, walkingMinutes } from "../public/js/router.js";
import { searchTimetable } from "../public/js/search-core.js";
const date = "2026-10-15";
const service = (id, operator, from, to, trips) => ({
  id,
  operator,
  category: "local",
  label: id,
  stops: [from, to],
  trips: trips.map(([depart, arrive], i) => ({
    id: `${id}-${i}`,
    date,
    arrivals: [depart, arrive],
    departures: [depart, arrive],
  })),
});
const network = {
  mode: "timetable",
  validDates: [date],
  stops: new Map(
    ["A", "B", "C", "D"].map((id) => [id, { id, name: id, type: "subway" }]),
  ),
  services: [
    service("local", "subway", "A", "B", [
      [360, 400],
      [600, 620],
      [630, 650],
      [1445, 1460],
    ]),
    service("express", "kintetsu", "A", "B", [
      [365, 366],
      [610, 615],
      [1435, 1450],
    ]),
  ],
  walks: [],
};
const request = {
  from: "A",
  to: "B",
  date,
  start: 599,
  buffer: 3,
  maxWalk: 20,
  trainType: "all",
  via: [],
};
test("始発は後発で追い抜く列車より、最初の実際の出発を選ぶ", () => {
  const r = searchTimetable(network, { ...request, timeMode: "first" }, {});
  assert.ok(r.length);
  assert.equal(r[0].legs[0].depart, 360);
});
test("終電は運行日の24時超を含む最後の接続可能便を選ぶ", () => {
  const r = searchTimetable(network, { ...request, timeMode: "last" }, {});
  assert.equal(r[0].legs[0].depart, 1445);
  assert.equal(r[0].time, 1460);
});
test("交通機関の指定は初回探索と始発終電に反映する", () => {
  const r = planRoutes(network, { ...request, operators: ["subway"] }, {});
  assert.ok(r.length);
  assert.ok(
    r.every((x) =>
      x.legs
        .filter((l) => l.kind === "ride")
        .every((l) => l.operator === "subway"),
    ),
  );
  const first = searchTimetable(
    network,
    { ...request, timeMode: "first", operators: ["kintetsu"] },
    {},
  );
  assert.equal(first[0].legs[0].depart, 365);
  assert.deepEqual(planRoutes(network, { ...request, operators: [] }, {}), []);
});
test("徒歩速度は実際の接続・徒歩上限へ反映される", () => {
  const n = {
    ...network,
    walks: [
      { from: "C", to: "D", minutes: 2 },
      { from: "D", to: "A", minutes: 2 },
    ],
  };
  assert.equal(walkingMinutes({ minutes: 10 }, { walkSpeed: "slow" }), 13);
  assert.equal(walkingMinutes({ minutes: 10 }, { walkSpeed: "fast" }), 8);
  const standard = planRoutes(
    n,
    {
      ...request,
      from: "C",
      start: 596,
      operators: ["subway"],
      walkSpeed: "standard",
    },
    {},
  );
  assert.equal(standard[0].legs.find((l) => l.kind === "ride").depart, 600);
  const slow = planRoutes(
    n,
    {
      ...request,
      from: "C",
      start: 596,
      operators: ["subway"],
      walkSpeed: "slow",
    },
    {},
  );
  assert.equal(slow[0].legs.find((l) => l.kind === "ride").depart, 630);
  const first = searchTimetable(
    n,
    {
      ...request,
      from: "C",
      operators: ["subway"],
      timeMode: "first",
      walkSpeed: "slow",
    },
    {},
  );
  assert.equal(first[0].start, 354);
  assert.equal(first[0].legs.find((l) => l.kind === "ride").depart, 360);
});

test("persisted realtime presentation expires without changing the historic journey", async () => {
  const { routeObservationState } =
    await import("../public/js/route-search-model.js");
  const now = Date.parse("2026-10-15T01:00:00Z");
  const observation = {
    source: "live",
    asOf: new Date(now - 1000).toISOString(),
    delay: 3,
  };
  assert.equal(
    routeObservationState([observation], { now, online: true }).source,
    "live",
  );
  assert.match(
    routeObservationState([observation], { now: now + 90000, online: true })
      .label,
    /要更新/,
  );
  assert.match(
    routeObservationState([observation], { now, online: false }).label,
    /オフライン/,
  );
  assert.equal(
    routeObservationState([{ source: "live" }], { now, online: true }).source,
    "prediction",
  );
  assert.equal(
    routeObservationState([{ ...observation, source: "prediction" }], {
      now,
      online: true,
    }).source,
    "prediction",
  );
  assert.equal(
    routeObservationState([], { now, online: false }).source,
    "schedule",
  );
  assert.equal(
    observation.source,
    "live",
    "presentation never rewrites saved model data",
  );
});
