import test from "node:test";
import assert from "node:assert/strict";
import { lowAccuracyReason } from "../public/js/mic-policy.js";

const now = 1_000_000_000;
const fix = (accuracy, age = 0, extra = {}) => ({ lat: 35.0039, lng: 135.7598, accuracy, timestamp: now - age, ...extra });

test("GPS精度が低い（50m超）ときだけマイクを使う", () => {
  assert.equal(lowAccuracyReason({ status: "active", fix: fix(20), now }), null);
  assert.equal(lowAccuracyReason({ status: "active", fix: fix(50), now }), null);
  assert.equal(lowAccuracyReason({ status: "active", fix: fix(180), now }), "coarse");
});

test("位置が取れない・拒否は使わない。ただし地下鉄駅の直後にGPSが消えたら地下とみなす", () => {
  assert.equal(lowAccuracyReason({ status: "denied", fix: null, now }), null);
  assert.equal(lowAccuracyReason({ status: "active", fix: fix(10, 120000), now }), null);
  assert.equal(lowAccuracyReason({ status: "active", fix: fix(10, 120000), now, subwayStationAt: now - 5 * 60000 }), "underground");
  assert.equal(lowAccuracyReason({ status: "active", fix: fix(10, 120000), now, subwayStationAt: now - 30 * 60000 }), null);
});

test("自宅では精度が低くてもマイクを使わない", () => {
  const home = { lat: 35.0039, lng: 135.7598 };
  assert.equal(lowAccuracyReason({ status: "active", fix: fix(90), now, home }), null);
  assert.equal(lowAccuracyReason({ status: "active", fix: fix(90), now, home: { lat: 35.02, lng: 135.76 } }), "coarse");
});
