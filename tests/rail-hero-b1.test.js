import test from "node:test";
import assert from "node:assert/strict";
import { railGuideInfo, railGuidePhase } from "../public/js/rail-guide-phase.js";
import { heroModel } from "../public/js/now-model.js";
import { nextStationHero, railHeroCopy } from "../public/js/now-components.js";
import { journeyProgress } from "../public/js/journey-core.js";
import { setAppLocale } from "../public/js/locale.js";

const at = 2_000_000;
const stops = ["K07", "K08", "K09", "K10"].map((id, index) => ({
  id,
  name: ["丸太町", "烏丸御池", "四条", "五条"][index],
  time: 600 + 2 * index,
  arrival: 600 + 2 * index,
  departure: 600 + 2 * index,
}));
const ride = {
  operator: "subway",
  from: "K07", to: "K10", destination: "竹田",
  category: "local",
  officialStops: stops,
  userDestination: { id: "K10" },
};
const geo = {
  stops: stops.map((s, index) => ({
    id: s.id,
    lat: 35.0 + index * 0.001,
    lng: 135.75,
  })),
};
function model(minute, extra = {}) {
  const options = {
    at, minute,
    locationStatus: extra.fix ? "active" : "unavailable",
    geo, ...extra,
  };
  const progress = journeyProgress(ride, options);
  return heroModel(ride, progress, options);
}

test("B-1: an underground GPS loss says timetable estimate, not approaching", () => {
  const result = model(601);
  assert.equal(result.railGuide.phase, "estimated");
  const html = nextStationHero(result, ride, { stops });
  assert.match(html, /data-rail-phase="estimated"/);
  assert.match(html, /次駅（時刻表による推定）/);
  assert.match(html, /時刻表推定/);
  assert.doesNotMatch(html, /next-state-label">まもなく到着/);
});

test("B-1: tunnel hold or recovery never renders zero-minute arrival certainty", () => {
  const held = railGuideInfo({
    trainState: "APPROACHING",
    positionSource: "gps_dropout_hold",
    hasFreshGps: false,
    motionSpeed: 10,
    hasNextStation: true,
    minutes: 0,
  });
  assert.equal(held.phase, "estimated");
  assert.equal(held.showEstimate, false);
  const content = railHeroCopy({
    bus: false,
    nextStation: stops[1],
    railGuide: held,
    observed: { positionSource: "gps_dropout_hold" },
    minutes: 0,
  });
  assert.match(content.duration, /到着予測を保留/);
});

test("B-1: physically stopped in a station separates current and next station", () => {
  const result = model(602.1, {
    fix: {
      lat: geo.stops[1].lat,
      lng: geo.stops[1].lng,
      accuracy: 8,
      speed: 0,
      timestamp: at,
    },
  });
  assert.equal(result.phase, "STOPPED");
  assert.equal(result.railGuide.phase, "stopped");
  assert.equal(result.nextStation.id, "K08");
  assert.equal(result.nextNext.id, "K09");
  const html = nextStationHero(result, ride, { stops });
  assert.match(html, /ただいま停車中/);
  assert.match(html, /次は 四条 · 発車を確認中/);
  assert.match(html, /烏丸御池/);
  assert.match(html, /data-rail-phase="stopped"/);
  assert.doesNotMatch(html, /next-state-label">次は/);
});

test("B-1: approaching requires both a verified fix and moving vehicle", () => {
  const base = {
    trainState: "APPROACHING",
    positionSource: "location",
    hasFreshGps: true,
    hasNextStation: true,
  };
  assert.equal(railGuidePhase({ ...base, motionSpeed: 5 }), "approaching");
  assert.equal(railGuidePhase({ ...base, motionSpeed: 0 }), "departed");
  assert.equal(railGuidePhase({ ...base, motionSpeed: 1.8 }), "departed");
  assert.equal(railGuidePhase({ ...base, motionSpeed: null }), "departed");
  assert.equal(railGuidePhase({ ...base, hasFreshGps: false, motionSpeed: 5 }), "estimated");
});

test("B-1: departing screen uses next stop, never currently stopped", () => {
  const info = railGuideInfo({
    trainState: "DEPARTED",
    positionSource: "location",
    hasFreshGps: true,
    hasNextStation: true,
    motionSpeed: 9,
    minutes: 3,
  });
  assert.deepEqual([info.phase, info.showEstimate], ["departed", true]);
  const copy = railHeroCopy({ bus: false, railGuide: info, minutes: 3 });
  assert.match(copy.label, /発車後/);
  assert.match(copy.duration, /約3分/);
  assert.match(copy.duration, /時刻表推定/);
});

test("B-1: schedule time reached is explicitly unverified", () => {
  const info = railGuideInfo({
    trainState: "APPROACHING",
    positionSource: "schedule",
    hasFreshGps: false,
    hasNextStation: true,
    minutes: 0,
  });
  const copy = railHeroCopy({ bus: false, railGuide: info, minutes: 0 });
  assert.equal(info.phase, "estimated");
  assert.match(copy.duration, /到着未確認/);
});

test("B-1: unavailable diversion remains visibly unverified", () => {
  assert.equal(railGuidePhase({
    routeUnavailable: true, hasFreshGps: true,
    trainState: "STOPPED", hasNextStation: true,
  }), "unavailable");
  assert.match(railHeroCopy({
    bus: false, railGuide: { phase: "unavailable" },
  }).duration, /運休・経路変更/);
});

test("B-1: station English and alighting stay separate from rail stage", () => {
  const result = model(601);
  const html = nextStationHero(result, ride, { stops });
  assert.doesNotMatch(html, /class="station-en"/);
  assert.match(html, /class="journey-next-name">烏丸御池/);
  assert.match(html, /あなたの降車/);
  assert.equal(result.userDestination.id, "K10");
  assert.equal(result.nextStation.id, "K08");
});

test("B-1: bus LCD retains the old bus copy, not the rail phase", () => {
  assert.equal(railHeroCopy({ bus: true }), null);
});

test("B-1: rail phase messages have English equivalents", () => {
  setAppLocale("en");
  try {
    const result = model(601);
    const html = nextStationHero(result, ride, { stops });
    assert.match(html, /Next stop \(timetable estimate\)/);
    assert.match(html, /Arrival.*timetable estimate|Approx\./);
  } finally {
    setAppLocale("ja");
  }
});
