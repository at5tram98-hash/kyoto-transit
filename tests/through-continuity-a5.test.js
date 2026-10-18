import test from "node:test";
import assert from "node:assert/strict";
import {
  spansTakeda, findThroughContinuation,
} from "../public/js/through-continuity.js";
import { subwayRideCandidates } from "../public/js/vnext-core.js";
import { rankRides } from "../public/js/riding.js";

const date = "2026-10-19";
const kToB = ["K13", "K14", "K15", "B06", "B07"];
const bToK = ["B08", "B07", "B06", "K15", "K14", "K13"];
const network = {
  stops: new Map([...new Set([...kToB, ...bToK])].map((id) =>
    [id, { id, name: id, type: id[0] === "K" ? "subway" : "kintetsu" }]
  )),
};
const service = (id, stops, times, tripId = "official-1") => ({
  id, operator: "through", category: "local", stops,
  trips: [{
    id: tripId, date, headsign: stops.at(-1),
    arrivals: times, departures: times,
  }],
});
const south = service("cross-south", kToB, [600, 602, 604, 606, 608]);
const north = service("cross-north", bToK, [600, 603, 605, 607, 609, 611]);
function splitRide(stops, times, destination, extras = {}) {
  return {
    kind: "ride",
    operator: stops[0].startsWith("K") ? "subway" : "kintetsu",
    serviceId: "partial-only",
    tripId: "partial-trip",
    serviceDate: date,
    from: stops[0], to: stops.at(-1),
    depart: times[0], arrive: times.at(-1),
    category: "local", destination: "竹田",
    officialStops: stops.map((id, i) => ({
      id, name: id, time: times[i],
      arrival: times[i], departure: times[i],
    })),
    ...(destination ? { userDestination: { id: destination } } : {}),
    ...extras,
  };
}

test("only services physically crossing both sides of K15 count as through", () => {
  assert.equal(spansTakeda(kToB), true);
  assert.equal(spansTakeda(bToK), true);
  assert.equal(spansTakeda(["K13", "K14", "K15"]), false);
  assert.equal(spansTakeda(["B06", "K15", "B06"]), false);
});

test("K to B upgrades the same active train with its destination intact", () => {
  const old = splitRide(kToB.slice(0, 3), [600, 602, 604], "B07");
  const next = findThroughContinuation(old, [{ services: [south] }], {
    minute: 603, network,
  });
  assert.equal(next.operator, "through");
  assert.deepEqual(next.officialStops.map((s) => s.id), kToB);
  assert.deepEqual(next.userDestination, old.userDestination);
  assert.equal(next.tripId, "official-1");
  assert.equal(next.depart, old.depart);
  assert.equal(next.to, "B07");
});

test("B to K selects through service with correct order and no forced transfer", () => {
  const old = splitRide(bToK.slice(0, 4), [600, 603, 605, 607], "K13");
  const next = findThroughContinuation(old, [{ services: [north] }], {
    minute: 607, network,
  });
  assert.equal(next.operator, "through");
  assert.deepEqual(next.officialStops.map((s) => s.id), bToK);
  assert.equal(next.userDestination.id, "K13");
  assert.equal(next.to, "K13");
});

test("split feeds without destination cannot assert an unverified train identity", () => {
  const old = splitRide(kToB.slice(0, 3), [600, 602, 604]);
  assert.equal(findThroughContinuation(old, [{ services: [south] }], {
    minute: 604, network,
  }), null);
});

test("the same official trip may extend a short partial ride without guessing a destination", () => {
  const old = splitRide(["K14", "K15"], [602, 604], null, {
    serviceId: south.id, tripId: south.trips[0].id,
  });
  const extended = findThroughContinuation(old, [{ services: [south] }], {
    minute: 604, network,
  });
  assert.equal(extended.operator, "through");
  assert.equal(extended.userDestination, undefined);
});

test("do not continue if rider selected Takeda or another stop on the original side", () => {
  for (const destination of ["K15", "K14"]) {
    const old = splitRide(kToB.slice(0, 3), [600, 602, 604], destination);
    assert.equal(findThroughContinuation(old, [{ services: [south] }], {
      minute: 604, network,
    }), null);
  }
});

test("non-matching timetable, stale minute or incomplete stop list cannot extend", () => {
  const old = splitRide(kToB.slice(0, 3), [600, 602, 604], "B07");
  const late = service("late", kToB, [600, 602, 610, 612, 614]);
  assert.equal(findThroughContinuation(old, [{ services: [late] }], {
    minute: 604, network,
  }), null);
  assert.equal(findThroughContinuation(old, [{ services: [south] }], {
    minute: 630, network,
  }), null);
  assert.equal(findThroughContinuation(old, [{ services: [
    { ...south, stops: ["K13", "K14", "K15"] },
  ] }], { minute: 604, network }), null);
});

test("ambiguous train identity leaves the existing ride unchanged", () => {
  const old = splitRide(kToB.slice(0, 3), [600, 602, 604], "B07");
  const alternative = service("second-through", kToB, [600, 602, 604, 606, 608]);
  assert.equal(findThroughContinuation(old, [{ services: [south, alternative] }], {
    minute: 604, network,
  }), null);
});

test("B-side candidate search includes genuine train entering subway", () => {
  const ride = subwayRideCandidates(
    { services: [north] },
    { fromId: "B06", minute: 605, network, direction: null },
  ).find((r) => spansTakeda(r.officialStops));
  assert.equal(ride?.operator, "through");
  assert.deepEqual(ride.officialStops.map((s) => s.id), ["B06", "K15", "K14", "K13"]);
});

test("subway track geometry also supports confirmed through candidates", () => {
  const legs = [splitRide(kToB, [600, 602, 604, 606, 608], "B07", {
    operator: "through", to: "B07", arrive: 608,
  })];
  const at = Date.now();
  const geo = {
    stops: kToB.map((id, i) => ({ id, lat: 35.006 - i * 0.001, lng: 135.75 })),
    lines: [
      { line: "烏丸線", points: [[135.75, 35.0], [135.75, 35.01]] },
    ],
  };
  const ranked = rankRides(legs, {
    network, geo, minute: 602, now: at, railFeed: null, busFeed: null,
    samples: [
      {lat:35.0053,lng:135.75,timestamp:at-25000,accuracy:10,speed:4},
      {lat:35.0051,lng:135.75,timestamp:at-12000,accuracy:10,speed:4},
      {lat:35.0049,lng:135.75,timestamp:at,accuracy:10,speed:4},
    ],
  });
  assert.ok(ranked[0].evidence.some((e) =>
    e.reason === "実際の線路形状・停車駅の区間付近" && e.points > 0
  ));
});
