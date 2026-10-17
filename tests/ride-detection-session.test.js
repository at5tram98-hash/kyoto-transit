import test from "node:test";
import assert from "node:assert/strict";
import {
  createRideDetectionSession,
  RideMode,
  RideState,
} from "../public/js/ride-detection-session.js";
import { realtimeRideEvidence } from "../public/js/realtime-evidence.js";
import { contradictionDecision } from "../public/js/smartlive-evidence.js";
import { createTransitEvidenceEngine } from "../public/js/transit-evidence.js";
import {
  parseAnnouncement,
  announcementMatch,
} from "../public/js/announcement-parser.js";
import {
  acquireAudioWindow,
  releaseAudioWindow,
  microphoneAlreadyGranted,
} from "../public/js/audio-window.js";
const at = 1800000000000;
const north = {
  operator: "subway",
  serviceId: "K-north",
  direction: "north",
  tripId: "N1",
  serviceDate: "2026-10-17",
  depart: 600,
  officialStops: [
    { id: "K07", name: "丸太町", time: 600 },
    { id: "K06", name: "今出川", time: 603 },
    { id: "K05", name: "鞍馬口", time: 606 },
  ],
};
const south = {
  ...north,
  serviceId: "K-south",
  tripId: "S1",
  direction: "south",
  officialStops: [
    { id: "K07", name: "丸太町", time: 600 },
    { id: "K08", name: "烏丸御池", time: 603 },
    { id: "K09", name: "四条", time: 606 },
  ],
};

test("one session owns candidate, confirmation, contradictions, rechecking shell, correction and lock", () => {
  const s = createRideDetectionSession();
  assert.equal(s.snapshot(at).phase, RideState.IDLE);
  assert.equal(s.transition("rechecking", at), false);
  s.candidates([{ ride: north, score: 60 }], at);
  assert.equal(s.snapshot(at).phase, RideState.CONFIRMING);
  s.confirm(north, at);
  assert.equal(s.snapshot(at).mode, RideMode.RAIL);
  s.contradiction("direction", 0.9, "south", at + 1000);
  assert.equal(s.snapshot(at + 1000).phase, RideState.CONTRADICTING);
  s.recheck(north, at + 2000);
  assert.equal(s.snapshot(at + 2000).shell, north);
  assert.equal(s.confirm(south, at + 3000), true);
  assert.equal(s.canConfirm(north, ["audio", "gps"], 99, at + 4000), false);
  assert.equal(
    s.canConfirm(north, ["audio", "gps", "realtime"], 95, at + 4000),
    true,
  );
  assert.equal(s.canConfirm(north, ["audio", "gps"], 99, at + 49000), true);
});

test("GPS-derived heading and stop trail are one source, repeated signatures are never independent", () => {
  const s = createRideDetectionSession();
  s.confirm(north, at);
  s.contradiction("direction", 0.9, "south", at);
  assert.equal(s.contradiction("direction", 0.9, "south", at + 20000), false);
  s.contradiction("pattern", 0.9, "A>B", at + 1000);
  assert.equal(
    contradictionDecision(s.snapshot(at + 1000).contradictions, at + 1000)
      .release,
    false,
  );
  s.contradiction("audio", 0.9, "K09", at + 2000);
  assert.equal(
    contradictionDecision(s.snapshot(at + 2000).contradictions, at + 2000)
      .release,
    true,
  );
  assert.equal(s.snapshot(at + 120000).contradictionScore, 0);
  assert.equal(s.snapshot(at + 120000).intensified, false);
});

test("audio sequence tracks adjacent next stations and rejects reverse order without keeping transcripts", () => {
  const s = createRideDetectionSession();
  assert.equal(s.audio(north, "K06", at).status, "supportive");
  assert.equal(s.audio(north, "K06", at + 6000).status, "neutral");
  assert.equal(s.audio(north, "K05", at + 20000).status, "supportive");
  assert.equal(s.audio(north, "K06", at + 40000).status, "contradictory");
  const through = {
    ...north,
    operator: "through",
    officialStops: [{ id: "K14" }, { id: "K15" }, { id: "B06" }, { id: "B07" }],
  };
  assert.equal(s.audio(through, "K15", at).status, "supportive");
  assert.equal(s.audio(through, "B06", at + 10000).status, "supportive");
});

test("expected state, stopped/departing/alighting and transfer reset preserve distinct phases", () => {
  const s = createRideDetectionSession();
  s.confirm(north, at);
  const p = {
    progress: {
      source: "location",
      currentIndex: 1,
      nextIndex: 2,
      next: north.officialStops[2],
      stops: north.officialStops,
    },
  };
  assert.equal(s.expected(north, p, 603).nextStop, "K05");
  s.observeProgress(p, { observedAt: at, phase: "stopped" }, at, "K06");
  assert.equal(s.snapshot(at).phase, "alighting");
  s.observeProgress(
    p,
    { observedAt: at + 10000, phase: "departing" },
    at + 10000,
    "K06",
  );
  assert.equal(s.snapshot(at + 10000).phase, "riding");
  s.reset(at + 11000);
  s.candidates([{ ride: south, score: 50 }], at + 12000);
  assert.equal(s.snapshot(at + 12000).phase, "candidate");
});

for (const operator of ["kintetsu", "through", "citybus", "kyotobus"])
  test(`${operator} realtime: exact identity, unavailable data, wrong direction, stale/offline and unrelated vehicles`, () => {
    const ride = { ...north, operator, route: "204" };
    const row = {
      tripId: "N1",
      serviceDate: ride.serviceDate,
      direction: "north",
      timestamp: at / 1000,
    };
    const feed = { vehicles: [row], asOf: new Date(at).toISOString() };
    assert.equal(
      realtimeRideEvidence(ride, feed, { now: at }).status,
      "supportive",
    );
    assert.equal(
      realtimeRideEvidence(
        ride,
        { ...feed, vehicles: [{ ...row, direction: "south" }] },
        { now: at },
      ).status,
      "contradictory",
    );
    assert.equal(
      realtimeRideEvidence(
        ride,
        {
          ...feed,
          vehicles: [{ ...row, tripId: "other", direction: "south" }],
        },
        { now: at },
      ).status,
      "neutral",
    );
    assert.equal(
      realtimeRideEvidence(ride, feed, { now: at + 90001 }).status,
      "unavailable",
    );
    assert.equal(
      realtimeRideEvidence(ride, feed, { now: at, online: false }).status,
      "unavailable",
    );
    assert.equal(
      realtimeRideEvidence(ride, null, { now: at }).status,
      "unavailable",
    );
  });

test("a rejected current ride remains in the pool but cannot hide a strongly supported alternative", () => {
  const e = createTransitEvidenceEngine();
  for (const ride of [north, south])
    for (const type of ["audio", "motion", "timetable"])
      e.ingest({
        candidate: ride,
        type,
        confidence: 0.9,
        observedAt: at,
        metadata: {
          directionVerified: type === "audio",
          rejected: ride === north && type === "audio",
        },
      });
  e.ingest({
    candidate: south,
    type: "gps",
    confidence: 0.9,
    observedAt: at,
    metadata: {
      directionVerified: true,
      routeTrajectory: true,
      walkingLikely: false,
    },
  });
  const d = e.evaluate(
    [
      { ride: north, score: 80 },
      { ride: south, score: 70 },
    ],
    at,
  );
  assert.equal(d.confirmed, south);
  assert.ok(d.candidates.some((c) => c.ride === north));
});

test("kana, English and source aliases parse only explicit next station/destination phrases", () => {
  const stops = [
    ...north.officialStops,
    { id: "K01", name: "国際会館", en: "Kokusaikaikan" },
  ];
  assert.equal(
    parseAnnouncement("次の停車駅は、いまでがわです", stops).nextStop,
    "K06",
  );
  assert.equal(
    parseAnnouncement("The next station is Kokusaikaikan", stops).nextStop,
    "K01",
  );
  assert.equal(
    parseAnnouncement("今出川の話をしています", stops).nextStop,
    null,
  );
  assert.equal(
    announcementMatch(parseAnnouncement("次は今出川です", stops), south, 600),
    null,
  );
});

test("diagnostic history is bounded and omits stable candidate identifiers and sensitive observations", () => {
  const s = createRideDetectionSession();
  for (let i = 0; i < 150; i++) {
    s.candidates([{ ride: north, score: 60 }], at + i * 10);
    s.confirm(north, at + i * 10 + 1);
    s.reset(at + i * 10 + 2);
  }
  assert.ok(s.diagnostics().length <= 100);
  assert.doesNotMatch(
    JSON.stringify(s.diagnostics()),
    /K07|K-north|N1|lat|lng|transcript|officialStops/,
  );
});

test("audio windows are mutually exclusive and unavailable permission never opens a stream", async () => {
  assert.equal(acquireAudioWindow("a"), true);
  assert.equal(acquireAudioWindow("b"), false);
  releaseAudioWindow("b");
  assert.equal(acquireAudioWindow("b"), false);
  releaseAudioWindow("a");
  assert.equal(acquireAudioWindow("b"), true);
  releaseAudioWindow("b");
  assert.equal(await microphoneAlreadyGranted(), false);
});

test("nearby places combine only nearby physical names while retaining operator stop actions", async () => {
  const { groupNearbyPlaces } = await import("../public/js/transit-places.js");
  const rows = [
    { id: "a", stop: { name: "京都駅", type: "subway" } },
    { id: "b", stop: { name: "京都駅前", type: "citybus" } },
    { id: "c", stop: { name: "京都駅", type: "kyotobus" } },
  ];
  const groups = groupNearbyPlaces(rows, {
    stops: [
      { id: "a", lat: 35, lng: 135 },
      { id: "b", lat: 35.0001, lng: 135 },
      { id: "c", lat: 36, lng: 135 },
    ],
  });
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups[0].rows.map((r) => r.id),
    ["a", "b"],
  );
});

test("confidence actually decays with evidence age and disappears at TTL without inventing contradictions", () => {
  const e = createTransitEvidenceEngine();
  for (const type of ["audio", "gps"])
    e.ingest({ candidate: north, type, confidence: 0.9, observedAt: at });
  const initial = e.support(north, at).confidence;
  assert.ok(e.support(north, at + 20000).confidence < initial);
  assert.ok(e.support(north, at + 45001).confidence > 0);
  assert.equal(e.support(north, at + 75001).confidence, 0);
});

test("circular audio next-stop sequence crosses the cycle boundary and rejects the opposite loop", () => {
  const s = createRideDetectionSession(),
    ride = {
      ...north,
      operator: "citybus",
      circular: true,
      officialStops: ["A", "B", "C", "D", "E", "F", "A"].map((id) => ({ id })),
    };
  assert.equal(s.audio(ride, "F", at).status, "supportive");
  assert.equal(s.audio(ride, "A", at + 10000).status, "supportive");
  assert.equal(s.audio(ride, "B", at + 20000).status, "supportive");
  assert.equal(s.audio(ride, "A", at + 30000).status, "contradictory");
});

test("false-positive exit needs sustained independent conflict, off-route walking and distinct sensor samples", () => {
  const s = createRideDetectionSession();
  s.confirm(north, at);
  s.recheck(north, at);
  const sample = (t) => ({
    walking: true,
    offRoute: true,
    independentConflict: true,
    observedAt: t,
  });
  assert.equal(s.observeNotRiding(sample(at), at), false);
  assert.equal(s.observeNotRiding(sample(at), at + 1000), false);
  for (let i = 1; i < 5; i++)
    assert.equal(
      s.observeNotRiding(sample(at + i * 10000), at + i * 10000),
      false,
    );
  assert.equal(s.observeNotRiding(sample(at + 50000), at + 50000), true);
  assert.equal(
    s.observeNotRiding(
      { ...sample(at + 60000), independentConflict: false },
      at + 60000,
    ),
    false,
  );
});

test("same departure and headsign do not collapse distinct trips or service dates", () => {
  const e = createTransitEvidenceEngine();
  const other = { ...north, tripId: "N2" };
  for (const ride of [north, other])
    for (const type of ["audio", "timetable"])
      e.ingest({
        candidate: ride,
        type,
        confidence: 0.9,
        observedAt: at,
        metadata: { directionVerified: type === "audio" },
      });
  assert.equal(
    e.evaluate(
      [
        { ride: north, score: 60 },
        { ride: other, score: 60 },
      ],
      at,
    ).confirmed,
    null,
  );
  e.ingest({
    candidate: other,
    type: "realtime",
    confidence: 0.95,
    observedAt: at,
    metadata: { directionVerified: true },
  });
  e.ingest({
    candidate: other,
    type: "motion",
    confidence: 0.8,
    observedAt: at,
    metadata: {},
  });
  assert.equal(
    e.evaluate(
      [
        { ride: north, score: 60 },
        { ride: other, score: 60 },
      ],
      at,
    ).confirmed,
    other,
  );
  assert.equal(
    realtimeRideEvidence(
      { ...north, serviceDate: "2026-10-18" },
      {
        vehicles: [
          {
            tripId: "N1",
            serviceDate: "2026-10-17",
            direction: "south",
            timestamp: at / 1000,
          },
        ],
      },
      { now: at },
    ).status,
    "neutral",
  );
});