import test from "node:test";
import assert from "node:assert/strict";
import { boundedLive, resetBoundedLive } from "../public/js/vnext-detect.js";
import { kyotoBusStaticCandidates } from "../public/js/vnext-core.js";

test("遅い通信は短時間だけ待ち、届いたら再判定を促す", async () => {
  resetBoundedLive();
  let resolveSlow;
  const events = [];
  const listener = () => events.push("evidence");
  globalThis.document?.addEventListener?.("mymap-transit-evidence", listener);
  const started = Date.now();
  const first = await boundedLive(
    "slow",
    () => new Promise((resolve) => (resolveSlow = resolve)),
    { wait: 30 },
  );
  assert.equal(first, null, "待ち切れない場合は既知の値（なし）で続行");
  assert.ok(Date.now() - started < 500);
  resolveSlow({ ok: true });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(await boundedLive("slow", () => assert.fail("再取得しない"), { wait: 30 }), { ok: true });
  globalThis.document?.removeEventListener?.("mymap-transit-evidence", listener);
});

test("同じキーの取得は1本にまとめ、失敗は短い間隔で再試行する", async () => {
  resetBoundedLive();
  let calls = 0;
  const start = async () => {
    calls++;
    throw Error("down");
  };
  await Promise.all([boundedLive("k", start), boundedLive("k", start)]);
  assert.equal(calls, 1);
  await boundedLive("k", start);
  assert.equal(calls, 1, "失敗直後は再試行しない");
  await boundedLive("k", start, { now: Date.now() + 11000 });
  assert.equal(calls, 2);
});

test("京都バスの静的時刻表から乗車停留所の便を即座に候補化する", () => {
  const network = { stops: new Map([["a", { name: "国際会館駅前" }], ["b", { name: "京都産業大学前" }]]) };
  const feed = {
    services: [{
      id: "kyotobus-40-down", operator: "kyotobus", route: "40", label: "京都バス40系統",
      stops: ["a", "b"],
      trips: [
        { id: "t1", date: "2026-10-22", arrivals: [600, 615], departures: [600, 615], headsign: "京都産業大学前" },
        { id: "t2", date: "2026-10-22", arrivals: [640, 655], departures: [640, 655] },
      ],
    }],
  };
  const rows = kyotoBusStaticCandidates(feed, { fromId: "a", minute: 603, network });
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].operator, rows[0].route, rows[0].depart, rows[0].arrive, rows[0].to, rows[0].tripId],
    ["kyotobus", "40", 600, 615, "b", "t1"],
  );
  assert.equal(kyotoBusStaticCandidates(feed, { fromId: "b", minute: 616, network }).length, 0, "終点からは乗車候補にしない");
});
