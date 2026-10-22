import test from "node:test";
import assert from "node:assert/strict";
import { railMotionSummary, classifyBins, binMotion } from "../public/js/rail-motion.js";

const t0 = 1_800_000_000_000;
// 10 samples per second.
function series(parts) {
  const out = [];
  let at = t0;
  for (const [seconds, fn] of parts)
    for (let i = 0; i < seconds * 10; i++, at += 100) out.push({ at, magnitude: fn(i) });
  return { samples: out, end: at };
}
const still = () => 0.03,
  train = (i) => 0.25 + 0.15 * Math.sin(i / 3),
  walk = (i) => (i % 5 === 0 ? 2.4 : 0.4);

test("歩行の周期的なピークと電車の連続的な揺れを見分ける", () => {
  const { samples, end } = series([[20, walk], [20, train]]);
  const bins = classifyBins(binMotion(samples, end));
  assert.equal(bins.slice(2, 15).every((b) => b.kind === "walking"), true);
  assert.equal(bins.slice(25, 38).every((b) => b.kind === "vehicle"), true);
});

test("駅間の走行と停車を数え、走行中は乗車中と判定する", () => {
  const { samples, end } = series([[30, still], [80, train], [25, still], [90, train], [20, still], [40, train]]);
  const summary = railMotionSummary(samples, { now: end });
  assert.equal(summary.riding, true);
  assert.equal(summary.runs, 3);
  assert.equal(summary.completedRuns, 2, "走行中の3本目はまだ数えない");
});

test("ホームで立って待つ・歩くだけでは乗車と判定しない", () => {
  const a = series([[60, still]]);
  assert.equal(railMotionSummary(a.samples, { now: a.end }).riding, false);
  const b = series([[60, walk]]);
  const s = railMotionSummary(b.samples, { now: b.end });
  assert.equal(s.riding, false);
  assert.equal(s.walking, true);
});
