import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeRouteTrajectory,
  fuseBoardingSignals,
  boostedAudioConfidence,
} from "../public/js/boarding-fusion-core.js";
import { createTransitEvidenceEngine } from "../public/js/transit-evidence.js";

const now = 2_000_000;
const route = [
  { lat: 35.0, lng: 135.75 },
  { lat: 35.001, lng: 135.75 },
  { lat: 35.002, lng: 135.75 },
];
const sample = (lat, lng, ageMs, accuracy = 8) => ({
  lat,
  lng,
  accuracy,
  timestamp: now - ageMs,
});

test("路線上の移動軌跡から端末コンパスなしで前進方向を判定する", () => {
  const trajectory = summarizeRouteTrajectory(
    [
      sample(35.00002, 135.75, 20000),
      sample(35.00055, 135.75, 10000),
      sample(35.0013, 135.75, 0),
    ],
    route,
    now,
  );
  assert.equal(trajectory.direction, "forward");
  assert.ok(trajectory.routeRatio >= 0.99);
  assert.ok(trajectory.progressDelta > 120);
});

test("逆方向の移動軌跡を前進証拠として採用しない", () => {
  const trajectory = summarizeRouteTrajectory(
    [
      sample(35.0013, 135.75, 20000),
      sample(35.0008, 135.75, 10000),
      sample(35.0002, 135.75, 0),
    ],
    route,
    now,
  );
  assert.equal(trajectory.direction, "reverse");
});

test("停車中のGPS揺れだけでは方向確定しない", () => {
  const trajectory = summarizeRouteTrajectory(
    [
      sample(35.0, 135.75, 20000, 20),
      sample(35.00002, 135.75001, 10000, 20),
      sample(35.00001, 135.75, 0, 20),
    ],
    route,
    now,
  );
  assert.equal(trajectory.direction, "neutral");
});

test("加速度・速度・軌跡・現在位置が揃った鉄道移動を強い証拠にする", () => {
  const trajectory = summarizeRouteTrajectory(
    [
      sample(35.00002, 135.75, 20000),
      sample(35.0007, 135.75, 10000),
      sample(35.0015, 135.75, 0),
    ],
    route,
    now,
  );
  const fused = fuseBoardingSignals(
    trajectory,
    {
      speed: 8,
      sensorSamples: 20,
      activeRatio: 0.6,
      rms: 0.3,
      acceleration: 0.2,
      peakAcceleration: 0.5,
      pattern: "stop-acceleration",
      walkingLikely: false,
    },
    "subway",
  );
  assert.equal(fused.directionVerified, true);
  assert.equal(fused.sensorBacked, true);
  assert.equal(fused.transportSpecific, true);
});

test("複数回一致するアナウンスは単発より強い証拠になる", () => {
  assert.ok(boostedAudioConfidence(0.9, 3, "confirmed") > 0.9);
});

test("強い鉄道モビリティでも安定時間を満たすまでは自動確定しない", () => {
  const ride = {
    operator: "subway",
    route: "K",
    serviceId: "svc",
    direction: "south",
    destination: "K15",
    depart: 600,
  };
  const engine = createTransitEvidenceEngine();
  engine.ingest({
    type: "timetable",
    candidate: ride,
    confidence: 0.7,
    observedAt: now,
  });
  engine.ingest({
    type: "gps",
    candidate: ride,
    confidence: 0.9,
    observedAt: now,
    metadata: {
      directionVerified: true,
      trajectoryAligned: true,
      trajectoryDirection: "forward",
      progressMeters: 160,
      transportSpecific: true,
    },
  });
  engine.ingest({
    type: "motion",
    candidate: ride,
    confidence: 0.8,
    observedAt: now,
    metadata: { sensorBacked: true },
  });
  assert.equal(engine.evaluate([{ ride, score: 70 }], now).confirmed, null);
  assert.ok(engine.evaluate([{ ride, score: 70 }], now + 13000).confirmed);
});

test("同一時刻の既存GPS証拠で軌跡メタデータが消えない", () => {
  const ride = {
    operator: "subway",
    route: "K",
    serviceId: "svc2",
    direction: "south",
    destination: "K15",
    depart: 610,
  };
  const engine = createTransitEvidenceEngine();
  engine.ingest({
    type: "gps",
    candidate: ride,
    confidence: 0.9,
    observedAt: now,
    metadata: {
      directionVerified: true,
      trajectoryAligned: true,
      trajectoryDirection: "forward",
      progressMeters: 150,
      transportSpecific: true,
    },
  });
  engine.ingest({
    type: "gps",
    candidate: ride,
    confidence: 0.65,
    observedAt: now,
    metadata: { walkingLikely: false },
  });
  engine.ingest({
    type: "timetable",
    candidate: ride,
    confidence: 0.7,
    observedAt: now,
  });
  engine.ingest({
    type: "motion",
    candidate: ride,
    confidence: 0.8,
    observedAt: now,
    metadata: { sensorBacked: true },
  });
  engine.evaluate([{ ride, score: 70 }], now);
  assert.ok(engine.evaluate([{ ride, score: 70 }], now + 13000).confirmed);
});
