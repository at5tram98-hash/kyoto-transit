import test from "node:test";
import assert from "node:assert/strict";
import { classifyScene } from "../public/js/ats-scene.js";
import { atsChosenLevel, atsLevel, atsModeCap, syncAtsDetection, readHome, saveHome } from "../public/js/ats.js";

const now = Date.parse("2026-10-24T01:00:00Z");
const fix = (lat, lng, accuracy = 10) => ({ lat, lng, accuracy, timestamp: now - 2000 });
const row = (id, type, meters, name = id) => ({ id, meters, stop: { id, type, name } });

test("ATSの段階は動作モードで上限が決まる", () => {
  assert.equal(atsChosenLevel({}), 3);
  assert.equal(atsChosenLevel({ autoDetect: false }), 1);
  assert.equal(atsChosenLevel({ atsLevel: 4 }), 4);
  // LV.5 is in development and cannot be chosen.
  assert.equal(atsChosenLevel({ atsLevel: 5 }), 3);
  assert.equal(atsLevel({ atsLevel: 4, runMode: "auto" }), 2);
  assert.equal(atsLevel({ atsLevel: 4, runMode: "lowpower" }), 1);
  assert.deepEqual(["fullauto", "auto", "lowpower"].map((m) => atsModeCap(m)), [4, 2, 1]);
});

test("乗車の判定はLV.2から動き、LV.1以下では止まる", () => {
  const a = { atsLevel: 2, runMode: "auto" };
  assert.equal(syncAtsDetection(a), true);
  const b = { atsLevel: 4, runMode: "lowpower" };
  assert.equal(syncAtsDetection(b), false);
  assert.equal(b.autoDetect, false);
});

test("場面：乗車中・位置なし・乗り物の速度", () => {
  assert.equal(classifyScene({ ride: { operator: "citybus" }, now }).scene, "riding_bus");
  assert.equal(classifyScene({ ride: { operator: "subway" }, now }).scene, "riding_train");
  assert.equal(classifyScene({ fix: null, now }).scene, "unknown");
  assert.equal(classifyScene({ fix: { ...fix(35, 135.7), timestamp: now - 120000 }, now }).scene, "unknown");
  assert.equal(classifyScene({ fix: fix(35, 135.7), speed: 9, now }).scene, "vehicle");
});

test("場面：自宅・バス停・駅・徒歩", () => {
  const home = { lat: 35, lng: 135.7 };
  assert.equal(classifyScene({ fix: fix(35.0003, 135.7), speed: 0, home, now }).scene, "home");
  // Travelling past home is not being at home.
  assert.notEqual(classifyScene({ fix: fix(35.0003, 135.7), speed: 9, home, now }).scene, "home");
  const stop = classifyScene({ fix: fix(35.01, 135.7), speed: 0, nearby: [row("s", "citybus", 18, "京都駅前")], now });
  assert.equal(stop.scene, "at_stop");
  assert.equal(stop.place.id, "s");
  assert.ok(stop.evidence.some((e) => e.key === "place" && e.value === 18));
  assert.equal(classifyScene({ fix: fix(35.01, 135.7), speed: 0, nearby: [row("K11", "subway", 90)], now }).scene, "at_station");
  assert.equal(classifyScene({ fix: fix(35.01, 135.7), speed: 1.3, nearby: [row("s", "citybus", 18)], now }).scene, "walking");
  assert.equal(classifyScene({ fix: fix(35.01, 135.7), speed: 0, nearby: [row("s", "citybus", 300)], now }).scene, "nearby");
});

test("自宅は約10m単位でこの端末だけに保存する", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  assert.equal(readHome(storage), null);
  assert.equal(saveHome({ lat: 35.0123456, lng: 135.7654321 }, storage), true);
  assert.deepEqual(readHome(storage), { lat: 35.0123, lng: 135.7654 });
});
