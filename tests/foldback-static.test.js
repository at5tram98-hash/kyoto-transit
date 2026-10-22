import test from "node:test";
import assert from "node:assert/strict";
import { serviceDirectionAt, staticReverseEntries, staticFoldbackJourney } from "../public/js/foldback-static.js";

const subway = {
  services: [
    { id: "s-south", operator: "subway", category: "local", stops: ["K03", "K04", "K05"],
      trips: [{ id: "a", date: "2026-10-22", arrivals: [600, 602, 604], departures: [600, 602, 604], headsign: "竹田" }] },
    { id: "s-north", operator: "subway", category: "local", stops: ["K05", "K04", "K03"],
      trips: [
        { id: "b", date: "2026-10-22", arrivals: [610, 612, 614], departures: [610, 612, 614], headsign: "国際会館" },
        { id: "c", date: "2026-10-21", arrivals: [610, 612, 614], departures: [610, 612, 614], headsign: "国際会館" },
      ] },
  ],
};
const kintetsu = {
  services: [
    { id: "k-north", operator: "kintetsu", category: "express", stops: ["B07", "B06", "K15", "B04"],
      trips: [{ id: "1-100", date: "2026-10-22", arrivals: [620, 622, 625, 628], departures: [620, 622, 625, 628], headsign: "京都" }] },
  ],
};

test("路線の並びから発車方向を判定する（竹田は近鉄側の並びでも判定）", () => {
  assert.equal(serviceDirectionAt(["K03", "K04"], 0), "south");
  assert.equal(serviceDirectionAt(["K05", "K04"], 0), "north");
  assert.equal(serviceDirectionAt(["B06", "K15", "B04"], 1), "north");
  assert.equal(serviceDirectionAt(["K04"], 0), null);
});

test("端末内の時刻表から反対方向の列車を当日分だけ、終着を除いて並べる", () => {
  const rows = staticReverseEntries([subway, kintetsu], "K04", "north", "2026-10-22");
  assert.deepEqual(rows.map((r) => [r.depart, r.destination, r.tripId]), [[612, "国際会館", "b"]]);
  assert.deepEqual(staticReverseEntries([subway], "K03", "north", "2026-10-22"), [], "終着駅からは乗れない");
  const k = staticReverseEntries([subway, kintetsu], "K15", "north", "2026-10-22");
  assert.deepEqual(k.map((r) => [r.depart, r.category, r.source]), [[625, "express", "static"]]);
});

test("選んだ折り返し列車の全駅時刻を同じ時刻表から復元する", () => {
  const network = { stops: new Map(["K03", "K04", "K05"].map((id) => [id, { name: id }])) };
  const ride = staticFoldbackJourney([subway], { serviceId: "s-north", tripId: "b", stopId: "K04", date: "2026-10-22" }, network);
  assert.equal(ride.from, "K04");
  assert.deepEqual(ride.officialStops.map((s) => [s.id, s.departure]), [["K04", 612], ["K03", 614]]);
  assert.equal(staticFoldbackJourney([subway], { serviceId: "s-north", tripId: "zz", stopId: "K04", date: "2026-10-22" }, network), null);
});

test("おすすめは各駅で間に合う最初の反対列車と、通過駅へ戻る時刻の早い順", async () => {
  const { foldbackRecommendations } = await import("../public/js/foldback-static.js");
  const network = { stops: new Map(["K03", "K04", "K05"].map((id) => [id, { name: id }])) };
  const feed = {
    services: [
      { id: "n", operator: "subway", category: "local", stops: ["K05", "K04", "K03"],
        trips: [
          { id: "n1", date: "2026-10-22", arrivals: [600, 602, 604], departures: [600, 602, 604], headsign: "国際会館" },
          { id: "n2", date: "2026-10-22", arrivals: [610, 612, 614], departures: [610, 612, 614], headsign: "国際会館" },
        ] },
    ],
  };
  const ride = { officialStops: [{ id: "K03", name: "K03", time: 590 }, { id: "K04", name: "K04", time: 598 }, { id: "K05", name: "K05", time: 603 }] };
  const rows = foldbackRecommendations({
    ride, feeds: [feed], stops: ride.officialStops.slice(1), minute: 597, date: "2026-10-22", network,
    reverseOf: () => "north",
    assess: (stop, depart) => ({ slack: depart - Math.max(stop.time, 597) - 3, status: "possible" }),
  });
  // K04 着598 → 602発は余裕1分、K05 着603 → 610発。戻り先 K03 へは 604 / 614。
  assert.deepEqual(rows.map((r) => [r.stop.id, r.entry.depart, r.returnArrival]), [["K04", 602, 604], ["K05", 610, 614]]);
  assert.equal(rows[0].target.id, "K03");
});
