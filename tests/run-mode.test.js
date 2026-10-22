import test from "node:test";
import assert from "node:assert/strict";
import { runMode, positionOptions, modeAllowsDetection, modeAllowsPip } from "../public/js/run-mode.js";

test("既存設定（自動乗車判定）からモードを引き継ぐ", () => {
  assert.equal(runMode({}), "fullauto");
  assert.equal(runMode({ autoDetect: false }), "auto");
  assert.equal(runMode({ runMode: "lowpower", autoDetect: true }), "lowpower");
});

test("モードごとの位置情報精度・自動判定・PiP", () => {
  assert.equal(positionOptions("lowpower").enableHighAccuracy, false);
  assert.ok(positionOptions("lowpower").maximumAge >= 60000);
  assert.equal(positionOptions("fullauto").enableHighAccuracy, true);
  assert.deepEqual(["fullauto", "auto", "lowpower"].map((m) => modeAllowsDetection(m)), [true, false, false]);
  assert.deepEqual(["fullauto", "auto", "lowpower"].map((m) => modeAllowsPip(m)), [true, true, false]);
});
