import test from "node:test";
import assert from "node:assert/strict";
import { cityBusLegRealtime, rowServesLeg } from "../public/js/bus-live-leg.js";
import { realtimeDelayForLeg } from "../public/js/search-core.js";

const network = {
  stops: new Map([["a", { name: "四条烏丸" }], ["b", { name: "烏丸御池" }], ["c", { name: "四条河原町" }], ["d", { name: "京都駅前" }]]),
  services: [{ id: "s", stops: ["a", "b", "c", "d"], trips: [{ id: "t1", departures: [600, 604, 610, 618] }, { id: "t2", departures: [615, 619, 625, 633] }] }],
};
const leg = { kind: "ride", operator: "citybus", route: "5", from: "c", to: "d", depart: 610, serviceId: "s", tripId: "t1" };
const data = (rows) => ({ source: "live", stale: false, asOf: new Date(0).toISOString(), results: rows });

test("乗車停留所の接近情報（何停前）と便の区間時間から到着見込みを出す", () => {
  // At 606 the bus is 1 stop away (b → c takes 6 min): here at 612, 2 min late.
  const r = cityBusLegRealtime(leg, data([{ route: "5", dest: "京都駅前", stopsAway: 1 }]), { network, nowMinute: 606 });
  assert.equal(r.eta, 612);
  assert.equal(r.delay, 2);
  assert.equal(r.source, "prediction");
  assert.equal(r.exact, false);
});

test("系統違い・逆方向・時刻が離れたバスは使わない", () => {
  assert.equal(cityBusLegRealtime(leg, data([{ route: "4", dest: "京都駅前", stopsAway: 1 }]), { network, nowMinute: 606 }), null);
  assert.equal(cityBusLegRealtime(leg, data([{ route: "5", dest: "北大路バスターミナル", stopsAway: 1 }]), { network, nowMinute: 606 }), null);
  assert.equal(rowServesLeg({ dest: "四条河原町・京都駅" }, ["京都駅前"]), true);
  // 40 minutes ahead is not this leg's bus.
  assert.equal(cityBusLegRealtime(leg, data([{ route: "5", dest: "京都駅前", minutes: 40 }]), { network, nowMinute: 606 }), null);
});

test("古い・時刻表由来の接近情報は使わない", () => {
  assert.equal(cityBusLegRealtime(leg, { ...data([{ route: "5", dest: "京都駅前", stopsAway: 1 }]), stale: true }, { network, nowMinute: 606 }), null);
  assert.equal(cityBusLegRealtime(leg, { ...data([{ route: "5", dest: "京都駅前", stopsAway: 1 }]), source: "schedule" }, { network, nowMinute: 606 }), null);
});

test("経路検索の実時刻反映は区間ごとの乗車停留所のデータで照合する", () => {
  const r = realtimeDelayForLeg(leg, { citybusByStop: { c: data([{ route: "5", dest: "京都駅", stopsAway: 1, asOf: new Date().toISOString() }]) } }, { network, nowMinute: 606 });
  assert.equal(r?.delay, 2);
  assert.equal(realtimeDelayForLeg(leg, { citybusByStop: {} }, { network, nowMinute: 606 }), null);
});
