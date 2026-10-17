import test from "node:test";
import assert from "node:assert/strict";
import {
  recoveryInput,
  missedConnection,
  nextDaySearch,
} from "../public/js/journey-recovery.js";
import {
  operationGroups,
  disruptedOperators,
} from "../public/js/operation-status.js";
import { planRoutes } from "../public/js/router.js";
import {
  itineraryRevision,
  editableItineraryLeg,
  updateItineraryRoute,
} from "../public/js/journey-plan.js";
const date = "2026-10-16",
  at = Date.parse(`${date}T01:00:00Z`),
  network = {
    stops: new Map(
      ["a", "b", "c", "d"].map((id) => [
        id,
        { id, name: id.toUpperCase(), type: "subway" },
      ]),
    ),
  },
  input = {
    from: "A",
    fromId: "a",
    to: "D",
    toId: "d",
    date,
    time: "10:00",
    timeMode: "departure",
    via: [
      { id: "b", name: "B", dwell: 3 },
      { id: "c", name: "C", dwell: 5 },
    ],
    operators: "subway,kintetsu,citybus,kyotobus",
    buffer: "3",
    maxWalk: "20",
    trainType: "all",
  },
  plan = {
    input,
    legIndex: 2,
    phase: "riding",
    route: {
      date,
      legs: [
        { kind: "ride", from: "a", to: "b" },
        { kind: "dwell", from: "b", to: "b" },
        { kind: "ride", from: "b", to: "c", depart: 610 },
        { kind: "ride", from: "c", to: "d" },
      ],
    },
  },
  now = { date, time: "10:20", minute: 620 };
test("changed destination replans remaining via points and preserves the original journey", () => {
  const before = structuredClone(plan),
    r = recoveryInput({ plan, stopId: "b", now, network });
  assert.equal(r.fromId, "b");
  assert.equal(r.toId, "d");
  assert.deepEqual(
    r.via.map((v) => v.id),
    ["c"],
  );
  assert.equal(r.time, "10:20");
  assert.equal(r.timeMode, "departure");
  assert.deepEqual(plan, before);
});
test("avoidance removes actual operators including through service at initial search", () => {
  const r = recoveryInput({
    plan,
    stopId: "b",
    now,
    network,
    avoid: ["through"],
  });
  assert.equal(r.operators, "citybus,kyotobus");
  const service = (id, operator, t) => ({
      id,
      operator,
      category: "local",
      stops: ["b", "d"],
      trips: [{ id, date, arrivals: [t, t + 5], departures: [t, t + 5] }],
    }),
    n = {
      ...network,
      mode: "timetable",
      validDates: [date],
      walks: [],
      services: [
        service("rail", "through", 621),
        service("bus", "citybus", 625),
      ],
    },
    routes = planRoutes(
      n,
      {
        from: "b",
        to: "d",
        date,
        start: 620,
        buffer: 3,
        maxWalk: 20,
        operators: r.operators.split(","),
      },
      {},
    );
  assert.ok(routes.length);
  assert.ok(
    routes.every((x) =>
      x.legs
        .filter((l) => l.kind === "ride")
        .every((l) => l.operator === "citybus"),
    ),
  );
  assert.throws(
    () =>
      recoveryInput({
        plan,
        now,
        network,
        avoid: ["through", "citybus", "kyotobus"],
      }),
    /交通機関/,
  );
});
test("a next-station proposal cannot depart before its official arrival and transfer buffer", () => {
  const ride = {
      serviceDate: date,
      officialStops: [{ id: "c", arrival: 1444.2 }],
    },
    r = recoveryInput({ plan, ride, stopId: "c", now, network, delay: 2 });
  assert.equal(r.date, "2026-10-17");
  assert.equal(r.time, "00:10");
  assert.equal(recoveryInput({ plan, stopId: "unknown", now, network }), null);
  assert.equal(recoveryInput({ plan, stopId: "d", now, network }), null);
});
test("missed departures propose recovery without inferring boarding or alighting", () => {
  const p = { ...plan, phase: "transfer" };
  assert.equal(missedConnection(p, now), true);
  assert.equal(missedConnection({ ...p, phase: "riding" }, now), false);
  assert.equal(missedConnection(p, { ...now, minute: 612 }), false);
  assert.equal(missedConnection(p, { date: "2026-10-17", minute: 0 }), true);
  assert.equal(nextDaySearch(date, 1380, "departure"), "2026-10-17");
  assert.equal(nextDaySearch(date, 1380, "last"), null);
});
test("an unknown onboard arrival requires departure-time review, while explicit alighting does not", () => {
  const ride = { serviceDate: date, officialStops: [{ id: "c", time: null }] };
  for (const candidate of [
    ride,
    { ...ride, officialStops: [] },
    {
      ...ride,
      serviceDate: undefined,
      officialStops: [{ id: "c", time: 625 }],
    },
  ]) {
    assert.equal(
      recoveryInput({ plan, ride: candidate, stopId: "c", now, network })
        .needsDepartureTime,
      true,
    );
  }
  ride.officialStops[0].time = 625;
  assert.equal(
    recoveryInput({ plan, ride, stopId: "c", now, network }).needsDepartureTime,
    false,
  );
  assert.equal(
    recoveryInput({ plan, stopId: "c", now, network }).needsDepartureTime,
    true,
  );
  assert.equal(
    recoveryInput({ plan, stopId: "c", now, network, atStop: true })
      .needsDepartureTime,
    false,
  );
});
test("operation groups are unique and saved routes do not remove current routes", () => {
  const lines = ["subway", "kintetsu", "citybus", "kyotobus"].map((id) => ({
      id,
    })),
    g = operationGroups(lines, ["through"], ["kintetsu", "citybus", "unknown"]);
  assert.deepEqual(
    g.current.map((x) => x.id),
    ["subway", "kintetsu"],
  );
  assert.deepEqual(
    g.favorites.map((x) => x.id),
    ["citybus"],
  );
  assert.deepEqual(
    g.others.map((x) => x.id),
    ["kyotobus"],
  );
});
test("only fresh explicit disruptions are automatically excluded", () => {
  const l = (id, status, fetchedAt = new Date(at).toISOString()) => ({
    id,
    status,
    fetchedAt,
  });
  assert.deepEqual(
    disruptedOperators(
      [
        l("subway", "delay"),
        l("kintetsu", "normal"),
        l("citybus", "suspended", new Date(at - 3600000).toISOString()),
        l("kyotobus", "unknown"),
      ],
      ["through", "citybus", "kyotobus"],
      { now: at, online: true },
    ),
    ["subway"],
  );
});
test("future service edits keep the active ride and reject stale or prefix-changing replies", () => {
  const active = structuredClone(plan);
  active.id = "active";
  const version = itineraryRevision(active),
    changed = structuredClone(active.route),
    rides = changed.legs.map(() => null);
  assert.equal(editableItineraryLeg(active, 2), false);
  assert.equal(editableItineraryLeg(active, 3), true);
  changed.legs[3].depart = 650;
  const updated = updateItineraryRoute(active, changed, rides, 3, version);
  assert.ok(updated);
  assert.equal(updated.phase, "riding");
  assert.equal(updated.legIndex, 2);
  assert.equal(updated.route.legs[3].depart, 650);
  assert.equal(
    updateItineraryRoute(active, changed, rides, 3, version, {
      date,
      minute: 651,
    }),
    null,
  );
  assert.equal(active.route.legs[3].depart, undefined);
  assert.equal(
    updateItineraryRoute(
      { ...active, phase: "transfer" },
      changed,
      rides,
      3,
      version,
    ),
    null,
  );
  changed.legs[2].depart = 999;
  assert.equal(updateItineraryRoute(active, changed, rides, 3, version), null);
});
