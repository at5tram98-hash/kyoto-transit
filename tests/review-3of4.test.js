import test from "node:test";
import assert from "node:assert/strict";
import { heroModel } from "../public/js/now-model.js";
import { operationStatus } from "../public/js/operation-status.js";
import { nextStationHero } from "../public/js/now-components.js";
import { parseRailDelay } from "../worker/rail.js";

test("fresh GPS away from the scheduled station cannot become STOPPED from timetable alone", () => {
  const at = 100000;
  const stops = [
    { id: "K08", name: "烏丸御池", time: 600, departure: 600 },
    { id: "K09", name: "四条", time: 602, departure: 602 },
    { id: "K10", name: "五条", time: 604, departure: 604 },
  ];
  const ride = {
    operator: "subway",
    category: "local",
    from: "K08",
    to: "K10",
    destination: "竹田",
    officialStops: stops,
    userDestination: { id: "K10" },
  };
  const progress = {
    stops,
    currentIndex: 1,
    nextIndex: 2,
    next: stops[2],
    arrival: 604,
  };
  const model = heroModel(ride, progress, {
    minute: 602,
    at,
    locationStatus: "active",
    fix: { lat: 35.08, lng: 135.8, accuracy: 12, timestamp: at },
    geo: { stops: [{ id: "K09", lat: 35.003, lng: 135.76 }] },
  });
  assert.notEqual(model.phase, "STOPPED");
});

test("Kintetsu delay parser accepts official unsigned and signed minute values", () => {
  assert.equal(parseRailDelay("10"), 10);
  assert.equal(parseRailDelay("+25"), 25);
  assert.equal(parseRailDelay("10分"), 10);
  assert.equal(parseRailDelay("+10分遅れ"), 10);
  assert.equal(parseRailDelay(""), 0);
  assert.equal(parseRailDelay("確認中"), null);
});

test("unknown operation status uses a neutral explicit marker instead of a question mark", () => {
  const status = operationStatus(
    { id: "subway", status: "unconfirmed", fetchedAt: null },
    { now: 100000, online: true },
  );
  assert.equal(status.kind, "unknown");
  assert.equal(status.symbol, "—");
  assert.equal(status.reason, "unavailable");
});

test("Japanese ride hero does not duplicate the station name in romanization", () => {
  const model = {
    bus: false,
    lineId: "B",
    trainState: "DEPARTED",
    phase: "DEPARTED",
    routeUnavailable: false,
    delayMinutes: 0,
    destination: "奈良",
    serviceType: "急行",
    label: "次は",
    nextStation: { id: "K15", code: "B05", name: "竹田", en: "Takeda" },
    nextNext: { id: "B06", code: "B06", name: "伏見", en: "Fushimi" },
    userDestination: { id: "B06", code: "B06", name: "伏見", en: "Fushimi" },
    minutes: 2,
    confidence: "estimated",
    remainingStops: 1,
    nextIsDestination: false,
    index: 0,
    throughNotice: "",
    boundary: null,
    destinationArrival: 620,
  };
  const ride = { operator: "kintetsu", category: "express", destination: "奈良" };
  const progress = {
    stops: [
      { id: "K15", name: "竹田", en: "Takeda" },
      { id: "B06", name: "伏見", en: "Fushimi" },
    ],
  };
  const html = nextStationHero(model, ride, progress);
  assert.match(html, /竹田/);
  assert.doesNotMatch(html, />Takeda</);
});
