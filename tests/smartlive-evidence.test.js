import test from "node:test";
import assert from "node:assert/strict";
import {
  tenSecondMovement,
  movementAgainstStops,
  routeTrajectoryEvidence,
  mergeAnnouncementWindow,
  contradictionDecision,
  specificAnnouncement,
} from "../public/js/smartlive-evidence.js";

const now = 2_000_000;
const sample = (lat, lng, ageMs, accuracy = 8) => ({
  lat,
  lng,
  accuracy,
  timestamp: now - ageMs,
});

test("10秒間の実移動から端末方位ではなく移動方位を求める", () => {
  const movement = tenSecondMovement(
    [
      sample(35.0, 135.75, 10000),
      sample(35.00045, 135.75, 5000),
      sample(35.0009, 135.75, 0),
    ],
    now,
  );
  assert.ok(Number.isFinite(movement.heading));
  assert.ok(movement.heading < 20 || movement.heading > 340);
  assert.ok(movement.meters > 80);
  assert.ok(movement.spanMs >= 9000);
});

test("停車中のGPS揺れを進行方向として採用しない", () => {
  const movement = tenSecondMovement(
    [sample(35.0, 135.75, 10000, 20), sample(35.00003, 135.75001, 0, 20)],
    now,
  );
  assert.equal(movement.heading, null);
  assert.equal(movement.confidence, 0);
});

test("次停留所へ近づく移動と反対方向を区別する", () => {
  const north = tenSecondMovement(
    [sample(35.0, 135.75, 10000), sample(35.0009, 135.75, 0)],
    now,
  );
  const supportive = movementAgainstStops(
    north,
    { lat: 35.0015, lng: 135.75 },
    { lat: 34.9995, lng: 135.75 },
  );
  assert.equal(supportive.status, "supportive");

  const south = tenSecondMovement(
    [sample(35.0009, 135.75, 10000), sample(35.0, 135.75, 0)],
    now,
  );
  const contradictory = movementAgainstStops(
    south,
    { lat: 35.0015, lng: 135.75 },
    { lat: 34.9995, lng: 135.75 },
  );
  assert.equal(contradictory.status, "contradictory");
});

test("複数GPS点の軌跡が次駅方向へ連続して進むと支持Evidenceになる", () => {
  const result = routeTrajectoryEvidence(
    [
      sample(35.0, 135.75, 22000),
      sample(35.00035, 135.75, 15000),
      sample(35.00075, 135.75, 7000),
      sample(35.00105, 135.75, 0),
    ],
    { lat: 35.0017, lng: 135.75 },
    { lat: 34.9996, lng: 135.75 },
    now,
  );
  assert.equal(result.status, "supportive");
  assert.ok(result.consistency >= 0.6);
  assert.ok(result.meters > 100);
});

test("GPS軌跡が候補路線の逆方向へ進む場合は矛盾Evidenceになる", () => {
  const result = routeTrajectoryEvidence(
    [
      sample(35.00105, 135.75, 22000),
      sample(35.00075, 135.75, 15000),
      sample(35.00035, 135.75, 7000),
      sample(35.0, 135.75, 0),
    ],
    { lat: 35.0017, lng: 135.75 },
    { lat: 34.9996, lng: 135.75 },
    now,
  );
  assert.equal(result.status, "contradictory");
});

test("約1分の音声窓で断片アナウンスを統合し全文は保持しない", () => {
  let window = mergeAnnouncementWindow(
    null,
    { line: "subway", nextStop: "K09" },
    now - 50000,
  );
  window = mergeAnnouncementWindow(
    window,
    { destination: "K15", trainType: "local" },
    now,
  );
  assert.equal(window.firstAt, now - 50000);
  assert.equal(window.hits, 2);
  assert.deepEqual(window.parsed, {
    line: "subway",
    nextStop: "K09",
    destination: "K15",
    trainType: "local",
  });
  assert.equal("transcript" in window, false);
});

test("矛盾する路線の音声は同一の1分窓へ混ぜない", () => {
  const first = mergeAnnouncementWindow(
    null,
    { line: "subway", nextStop: "K09" },
    now - 30000,
  );
  const second = mergeAnnouncementWindow(
    first,
    { line: "kintetsu", nextStop: "B07" },
    now,
  );
  assert.equal(second.firstAt, now);
  assert.equal(second.hits, 1);
  assert.equal(second.parsed.line, "kintetsu");
});

test("単発矛盾では解除せず独立ソースまたは時間差のある反復で解除する", () => {
  assert.equal(
    contradictionDecision(
      [{ source: "direction", confidence: 0.9, signature: "north", at: now }],
      now,
    ).release,
    false,
  );
  assert.equal(
    contradictionDecision(
      [
        {
          source: "direction",
          confidence: 0.9,
          signature: "north",
          at: now - 1000,
        },
        { source: "pattern", confidence: 0.95, signature: "A>B", at: now },
      ],
      now,
    ).release,
    false,
  );
  assert.equal(
    contradictionDecision(
      [
        { source: "audio", confidence: 0.9, signature: "K06", at: now - 6000 },
        { source: "audio", confidence: 0.9, signature: "K08", at: now },
      ],
      now,
    ).release,
    true,
  );
});

test("具体性のない音声は便判定Evidenceにしない", () => {
  assert.equal(
    specificAnnouncement({
      line: null,
      route: null,
      destination: null,
      nextStop: null,
      trainType: null,
    }),
    false,
  );
  assert.equal(
    specificAnnouncement({
      line: "subway",
      route: null,
      destination: null,
      nextStop: "K06",
      trainType: null,
    }),
    true,
  );
});
