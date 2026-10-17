import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeVehicleMotion,
  announcementContradictsRide,
  shouldReleaseRideContradictions,
} from "../public/js/motion-assist.js";

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

test("現在便と矛盾する具体的な次駅アナウンスを検出する", () => {
  const ride = {
    operator: "subway",
    direction: "north",
    category: "local",
    officialStops: [
      { id: "K07", name: "丸太町", time: 600 },
      { id: "K06", name: "今出川", time: 603 },
      { id: "K05", name: "鞍馬口", time: 605 },
    ],
  };
  assert.equal(
    announcementContradictsRide(
      {
        line: null,
        route: null,
        destination: null,
        nextStop: "K06",
        trainType: null,
      },
      ride,
      601,
    ),
    false,
  );
  assert.equal(
    announcementContradictsRide(
      {
        line: null,
        route: null,
        destination: null,
        nextStop: "K08",
        trainType: null,
      },
      ride,
      600,
    ),
    true,
  );
});

test("単発ノイズでは解除せず、独立矛盾または時間を隔てた音声矛盾で再確認する", () => {
  assert.equal(
    shouldReleaseRideContradictions(
      [{ source: "audio", confidence: 0.9, at: now, signature: "A" }],
      now,
    ),
    false,
  );
  assert.equal(
    shouldReleaseRideContradictions(
      [
        { source: "audio", confidence: 0.9, at: now - 5000, signature: "A" },
        { source: "audio", confidence: 0.9, at: now, signature: "B" },
      ],
      now,
    ),
    true,
  );
  assert.equal(
    shouldReleaseRideContradictions(
      [
        {
          source: "pattern",
          confidence: 0.95,
          at: now - 1000,
          signature: "A>B",
        },
        { source: "audio", confidence: 0.9, at: now, signature: "X" },
      ],
      now,
    ),
    true,
  );
});

test("walking classification needs real sensor cadence as well as walking-speed fixes", () => {
  const sensor = Array.from({ length: 121 }, (_, i) => ({
    at: now - 12000 + i * 100,
    magnitude: i % 5 === 0 ? 0.9 : 0.05,
  }));
  assert.equal(
    summarizeVehicleMotion(sensor, gps([1.2, 1.3, 1.4, 1.4]), now)
      .walkingLikely,
    true,
  );
  assert.equal(
    summarizeVehicleMotion([], gps([1.2, 1.3, 1.4, 1.4]), now).walkingLikely,
    false,
  );
  assert.equal(
    summarizeVehicleMotion(sensor, gps([5, 5, 5, 5]), now).walkingLikely,
    false,
  );
});
