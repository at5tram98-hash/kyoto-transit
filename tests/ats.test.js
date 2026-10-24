import test from "node:test";
import assert from "node:assert/strict";
import { classifyScene, assessScene } from "../public/js/ats-scene.js";
import { fuseSnapshot, motionActivity } from "../public/js/ats-sensors.js";
import { predictDestination, pilotSteps } from "../public/js/ats-pilot.js";
import { atsChosenLevel, atsLevel, atsModeCap, syncAtsDetection, readHome, saveHome } from "../public/js/ats.js";

const now = Date.parse("2026-10-24T01:00:00Z");
const fix = (lat, lng, accuracy = 10) => ({ lat, lng, accuracy, timestamp: now - 2000 });
const row = (id, type, meters, name = id) => ({ id, meters, stop: { id, type, name } });

test("ATSの段階は動作モードで上限が決まる", () => {
  assert.equal(atsChosenLevel({}), 3);
  assert.equal(atsChosenLevel({ autoDetect: false }), 1);
  assert.equal(atsChosenLevel({ atsLevel: 4 }), 4);
  assert.equal(atsChosenLevel({ atsLevel: 5 }), 5);
  assert.equal(atsLevel({ atsLevel: 5, runMode: "fullauto" }), 5);
  assert.equal(atsLevel({ atsLevel: 4, runMode: "auto" }), 2);
  assert.equal(atsLevel({ atsLevel: 4, runMode: "lowpower" }), 1);
  assert.deepEqual(["fullauto", "auto", "lowpower"].map((m) => atsModeCap(m)), [5, 2, 1]);
});

test("乗車の判定はLV.2から動き、LV.1以下では止まる", () => {
  const a = { atsLevel: 2, runMode: "auto" };
  assert.equal(syncAtsDetection(a), true);
  const b = { atsLevel: 4, runMode: "lowpower" };
  assert.equal(syncAtsDetection(b), false);
  assert.equal(b.autoDetect, false);
});

const snap = (over = {}) =>
  fuseSnapshot({ now, locationStatus: "active", fix: fix(35.01, 135.7), ...over });

test("センサー集約：位置の品質と速度の出どころ", () => {
  assert.equal(snap().location.quality, "precise");
  assert.equal(snap({ fix: fix(35, 135.7, 120) }).location.quality, "coarse");
  assert.equal(snap({ fix: { ...fix(35, 135.7), timestamp: now - 60000 } }).location.quality, "stale");
  assert.equal(snap({ locationStatus: "denied", fix: null }).location.quality, "denied");
  assert.equal(snap({ fix: { ...fix(35, 135.7), speed: 3 } }).speed.source, "gps");
  assert.equal(snap({ track: { speed: 2, span: 20 } }).speed.source, "track");
  assert.equal(snap().speed.value, null);
  // A sensor with no reading is "unknown", never "still".
  assert.equal(motionActivity(null, "granted"), "unknown");
  assert.equal(motionActivity({ sensorSamples: 20, rms: 0.02, activeRatio: 0.05 }, "granted"), "still");
  assert.equal(motionActivity({ sensorSamples: 20, rms: 0.3, activeRatio: 0.6, speed: 8 }, "granted"), "vehicle");
});

test("場面：乗車中・位置なし・乗り物・地下（GPSなし）", () => {
  assert.equal(classifyScene(snap({ ride: { operator: "citybus" } })).scene, "riding_bus");
  assert.equal(classifyScene(snap({ ride: { operator: "subway" } })).scene, "riding_train");
  assert.equal(classifyScene(snap({ fix: null, locationStatus: "loading" })).scene, "unknown");
  assert.equal(classifyScene(snap({ fix: { ...fix(35, 135.7), speed: 9 } })).scene, "vehicle");
  const underground = snap({ fix: null, motion: { sensorSamples: 20, rms: 0.3, activeRatio: 0.6, speed: 8 }, permission: "granted" });
  assert.equal(classifyScene(underground).scene, "vehicle");
});

test("場面：自宅・バス停・駅・徒歩", () => {
  const home = { lat: 35, lng: 135.7 };
  assert.equal(classifyScene(snap({ fix: { ...fix(35.0003, 135.7), speed: 0 }, home })).scene, "home");
  assert.notEqual(classifyScene(snap({ fix: { ...fix(35.0003, 135.7), speed: 9 }, home })).scene, "home");
  const stop = classifyScene(snap({ fix: { ...fix(35.01, 135.7), speed: 0 }, nearby: [row("s", "citybus", 18, "京都駅前")] }));
  assert.equal(stop.scene, "at_stop");
  assert.equal(stop.place.id, "s");
  assert.equal(classifyScene(snap({ nearby: [row("K11", "subway", 90)] })).scene, "at_station");
  assert.equal(classifyScene(snap({ fix: { ...fix(35.01, 135.7), speed: 1.3 }, nearby: [row("s", "citybus", 18)] })).scene, "walking");
  assert.equal(classifyScene(snap({ nearby: [row("s", "citybus", 300)] })).scene, "nearby");
});

test("場面は短いゆらぎでは切り替わらず、続いたら切り替わる", () => {
  const atStop = (at, meters) => fuseSnapshot({ now: at, locationStatus: "active", fix: { ...fix(35.01, 135.7, 30), timestamp: at - 1000, speed: 0 }, nearby: [row("s", "citybus", meters)] });
  let a = assessScene(atStop(now, 30));
  assert.equal(a.scene, "at_stop");
  // One fix 300 m off the stop: still shown at the stop.
  a = assessScene(atStop(now + 2000, 300), a.memory);
  assert.equal(a.scene, "at_stop");
  assert.equal(a.pending, "nearby");
  a = assessScene(atStop(now + 14000, 300), a.memory);
  assert.equal(a.scene, "nearby");
  // A ride takes effect at once.
  const riding = fuseSnapshot({ now: now + 15000, ride: { operator: "citybus" } });
  assert.equal(assessScene(riding, a.memory).scene, "riding_bus");
});

test("LV.5：降車予測は検索履歴→保存した場所の順で、この先の停留所だけ", () => {
  const ride = { from: "a", officialStops: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }] };
  assert.deepEqual(predictDestination(ride, { pairs: [{ fromId: "x", toId: "a" }, { fromId: "a", toId: "c" }] }), { id: "c", name: "C", source: "history" });
  assert.deepEqual(predictDestination(ride, { pairs: [], saved: ["b"] }), { id: "b", name: "B", source: "saved" });
  assert.equal(predictDestination(ride, { pairs: [{ toId: "a" }], saved: ["z"] }), null);
});

test("LV.5：候補が1便に絞られ一定時間続いたときだけ自動で乗車する", () => {
  const candidate = { ride: { serviceId: "s1", depart: 600 }, score: 70 };
  const scene = { scene: "vehicle", since: now - 40000 };
  assert.equal(pilotSteps({ level: 4, scene, candidates: [candidate], now }).length, 0);
  assert.equal(pilotSteps({ level: 5, scene, candidates: [candidate], now })[0].type, "board");
  assert.equal(pilotSteps({ level: 5, scene: { ...scene, since: now - 5000 }, candidates: [candidate], now }).length, 0);
  assert.equal(pilotSteps({ level: 5, scene, candidates: [candidate, candidate], now }).length, 0);
  assert.equal(pilotSteps({ level: 5, scene, candidates: [{ ...candidate, directionRejected: true }], now }).length, 0);
});

test("自宅は約10m単位でこの端末だけに保存する", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  assert.equal(readHome(storage), null);
  assert.equal(saveHome({ lat: 35.0123456, lng: 135.7654321 }, storage), true);
  assert.deepEqual(readHome(storage), { lat: 35.0123, lng: 135.7654 });
});
