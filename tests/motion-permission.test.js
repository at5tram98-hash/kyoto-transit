import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const executable = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("モーション許可はNowの明示ボタンからだけ要求し、自動では求めない", () => {
  const app = read("../public/js/vnext.js");
  assert.match(app, /data-enable-motion[\s\S]{0,80}requestMotionPermission\(\)/);
  for (const file of ["../public/js/motion-assist.js", "../public/js/vnext-detect.js", "../public/js/vnext-view.js"])
    assert.doesNotMatch(executable(read(file)), /requestPermission\s*\(/, file);
});

test("一度許可した端末だけ、次のタップで許可を再有効化し、失敗しても不許可に書き換えない", async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  let requests = 0, answer = "granted", throws = false;
  globalThis.DeviceMotionEvent = { requestPermission: async () => { requests++; if (throws) throw Object.assign(Error("gesture"), { name: "NotAllowedError" }); return answer; } };
  const listeners = new Map();
  const target = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  const m = await import(`../public/js/motion-permission.js?case=${Date.now()}`);
  assert.equal(m.motionPermissionState(), "prompt");
  m.restoreMotionPermission(target);
  assert.equal(listeners.size, 0, "未許可の端末ではタップを待ち受けない");
  assert.equal(await m.requestMotionPermission(), "granted");
  assert.equal(requests, 1);
  assert.equal(store.get("mymap-motion-permission"), "granted");
  // New page session: the grant is not active yet.
  const fresh = await import(`../public/js/motion-permission.js?case=${Date.now()}-2`);
  assert.equal(fresh.motionPermissionState(), "restoring");
  throws = true;
  fresh.restoreMotionPermission(target);
  assert.ok(listeners.has("click") && listeners.has("touchend"), "click/touchendで再有効化する（pointerupは使わない）");
  listeners.get("click")();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(store.get("mymap-motion-permission"), "granted", "失敗した再有効化は不許可として保存しない");
  assert.equal(fresh.motionPermissionState(), "restoring");
  throws = false;
  listeners.get("touchend")();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fresh.motionPermissionState(), "granted");
  assert.equal(listeners.has("click"), false, "許可後は待ち受けを外す");
  // Only an explicit answer to the rider's tap records denial.
  const third = await import(`../public/js/motion-permission.js?case=${Date.now()}-3`);
  answer = "denied";
  assert.equal(await third.requestMotionPermission(), "denied");
  assert.equal(store.get("mymap-motion-permission"), "denied");
  delete globalThis.DeviceMotionEvent;
  delete globalThis.localStorage;
});

test("乗り物の速度で移動中の時刻表・公式実測候補は確認を提示するが、自動確定はしない", async () => {
  const { shouldOfferRideConfirmation, createTransitEvidenceEngine } = await import("../public/js/transit-evidence.js");
  const candidate = { ride: { operator: "subway", tripId: "t1", direction: "south" }, score: 80 };
  assert.equal(shouldOfferRideConfirmation(candidate, { vehicleMoving: true, contextual: true, sources: ["gps"] }), true);
  assert.equal(shouldOfferRideConfirmation(candidate, { vehicleMoving: true, walkingLikely: true, contextual: true, sources: ["gps"] }), false, "徒歩の移動では尋ねない");
  assert.equal(shouldOfferRideConfirmation(candidate, { vehicleMoving: true, sources: ["gps", "motion"] }), false, "移動だけでは便を示さない");
  assert.equal(shouldOfferRideConfirmation(candidate, { vehicleMoving: false, contextual: true, sources: ["realtime"] }), false, "停留所で待つだけでは尋ねない");
  assert.equal(shouldOfferRideConfirmation({ ...candidate, directionRejected: true }, { vehicleMoving: true, contextual: true, sources: ["gps"] }), false);
  const { transitCandidateKey } = await import("../public/js/transit-evidence.js");
  const engine = createTransitEvidenceEngine(), now = 1_000_000, key = transitCandidateKey(candidate.ride);
  for (const [type, metadata] of [["timetable", {}], ["gps", { vehicleMoving: true }]])
    engine.ingest({ type, candidate: key, confidence: 0.65, observedAt: now, metadata });
  assert.equal(shouldOfferRideConfirmation(candidate, engine.support(candidate.ride, now)), true);
  assert.equal(engine.evaluate([candidate], now + 20000).confirmed, null, "提示は確定ではない");
});

test("時刻のないバスは確認中と表示し続けず、時刻のある便は降車地未設定でも終点の到着見込みを出す", async () => {
  const { nextStationHero } = await import("../public/js/now-components.js");
  const stops = [
    { id: "a", name: "北大路バスターミナル" },
    { id: "b", name: "北大路新町" },
    { id: "c", name: "建勲神社前" },
  ];
  const base = {
    bus: true, lineId: "bus", nextStation: { id: "b", name: "北大路新町" }, index: 1,
    userDestination: null, remainingStops: 0, phase: "MOVING", trainState: "MOVING",
    label: "次の停留所", confidence: "estimated", destination: "建勲神社前",
    terminal: { id: "c", name: "建勲神社前" },
  };
  const ride = { operator: "citybus", route: "204", officialStops: stops };
  const progress = { stops };
  const untimed = nextStationHero({ ...base, minutes: null, timesPublished: false, terminalArrival: null }, ride, progress);
  assert.match(untimed, /時刻データなし/);
  assert.doesNotMatch(untimed, /到着時刻を確認中/);
  const timed = nextStationHero({ ...base, minutes: 4, timesPublished: true, terminalArrival: 619, delayMinutes: 2 }, ride, progress);
  assert.match(timed, /終点「建勲神社前」10:19着（推定）/);
  const official = nextStationHero({ ...base, minutes: 4, timesPublished: true, terminalArrival: 619, officialPrediction: true }, ride, progress);
  assert.match(official, /公式予測/);
});
