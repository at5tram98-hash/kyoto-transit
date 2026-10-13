import test from "node:test";
import assert from "node:assert/strict";
import { summarizeVehicleMotion } from "../public/js/motion-assist.js";

const now = 1_800_000;
function gps(speeds) {
  return speeds.map((speed, index) => ({
    lat: 35.01 + index * 0.00005,
    lng: 135.75,
    accuracy: 10,
    speed,
    timestamp: now - (speeds.length - 1 - index) * 2000,
  }));
}
function sensor(values) {
  return values.map((magnitude, index) => ({
    at: now - (values.length - 1 - index) * 900,
    magnitude,
  }));
}

test("加速度は移動中だけ乗車候補の補助証拠になる", () => {
  const active = summarizeVehicleMotion(
    sensor([0.05, 0.32, 0.08, 0.41, 0.12, 0.36, 0.07, 0.3]),
    gps([2.8, 3.5, 4.6, 5.4]),
    now,
  );
  assert.ok(active.score >= 3);
  assert.match(active.reason, /加速度|加減速/);
  assert.ok(active.peakAcceleration > 0);

  const stopped = summarizeVehicleMotion(
    sensor([0.05, 0.32, 0.08, 0.41, 0.12, 0.36]),
    gps([0, 0, 0, 0]),
    now,
  );
  assert.equal(stopped.score, 0);
});

test("一定速度では加減速を捏造せずセンサー振動を弱い補助に留める", () => {
  const result = summarizeVehicleMotion(
    sensor([0.04, 0.25, 0.05, 0.28, 0.06, 0.24]),
    gps([5, 5, 5, 5]),
    now,
  );
  assert.equal(result.peakAcceleration, 0);
  assert.ok(result.score >= 1 && result.score <= 3);
});

test("古い加速度サンプルは乗車根拠に使わない", () => {
  const result = summarizeVehicleMotion(
    [{ at: now - 60000, magnitude: 1.2 }],
    gps([3, 4, 5, 6]),
    now,
  );
  assert.equal(result.sensorSamples, 0);
  assert.ok(result.score <= 3);
});
