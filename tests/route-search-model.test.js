import test from "node:test";
import assert from "node:assert/strict";
import { createNetwork } from "../public/js/network.js";
import {
  stopSuggestions,
  resolveStop,
  sortedRouteIndexes,
  nextDepartureInput,
  previousDepartureInput,
  validSearchInput,
  searchShareURL,
  readSharedSearch,
} from "../public/js/route-search-model.js";
import {
  saveSearchPair,
  readSearchPairs,
  removeSearchPair,
} from "../public/js/search-history.js";
const network = createNetwork({});
const input = {
  from: "丸太町",
  fromId: "K07",
  to: "京都",
  toId: "K11",
  date: "2026-10-13",
  time: "10:00",
  timeMode: "departure",
  trainType: "all",
  buffer: "3",
  maxWalk: "20",
  via: [],
};
test("同名の駅は勝手に選ばず交通機関の ID で確定する", () => {
  assert.equal(resolveStop(network, "京都").ambiguous, true);
  assert.equal(resolveStop(network, "京都", "B01").stop.id, "B01");
  assert.equal(resolveStop(network, "京都", "K11").stop.id, "K11");
  assert.equal(resolveStop(network, "丸太町", "K11").stop.id, "K07");
  assert.equal(resolveStop(network, "Ｋ０７").stop.id, "K07");
});
test("名称・別名・駅番号・英語で候補を検索し、入力に最も近い地点を先頭にする", () => {
  assert.equal(stopSuggestions(network, "Marutamachi")[0].id, "K07");
  assert.equal(stopSuggestions(network, "K11")[0].id, "K11");
  assert.equal(stopSuggestions(network, "丹波橋")[0].id, "B07");
  assert.ok(stopSuggestions(network, "京都").some((s) => s.id === "K11"));
  assert.ok(stopSuggestions(network, "京都").some((s) => s.id === "B01"));
  assert.equal(stopSuggestions(network, "存在しない地点").length, 0);
  assert.equal(stopSuggestions(network, "").length, 0);
});
test("比較順は元の経路 index を保持し入力データを変更しない", () => {
  const routes = [
    { time: 620, transfers: 2, fare: { additional: 400 } },
    { time: 640, transfers: 1, fare: { additional: 100 } },
    { time: 630, transfers: 0, fare: { additional: 300 } },
  ];
  assert.deepEqual(sortedRouteIndexes(routes, "arrival"), [0, 2, 1]);
  assert.deepEqual(sortedRouteIndexes(routes, "fare"), [1, 2, 0]);
  assert.deepEqual(sortedRouteIndexes(routes, "transfers"), [2, 1, 0]);
  assert.equal(routes[0].time, 620);
});
test("次の出発は最初の実便を越える時刻を検索し、先行徒歩と翌日を考慮する", () => {
  assert.equal(
    nextDepartureInput(input, [{ legs: [{ kind: "ride", depart: 605 }] }]).time,
    "10:06",
  );
  assert.equal(
    nextDepartureInput(input, [
      {
        legs: [
          { kind: "walk", depart: 600, minutes: 3 },
          { kind: "ride", depart: 605 },
        ],
      },
    ]).time,
    "10:03",
  );
  const next = nextDepartureInput(input, [
    { legs: [{ kind: "ride", depart: 1439 }] },
  ]);
  assert.equal(next.date, "2026-10-14");
  assert.equal(next.time, "00:00");
  assert.equal(nextDepartureInput(input, []), null);
});
test("共有条件は表示中の検索から作成し、ID・経由地・条件を安全に復元する", () => {
  const via = { ...input, via: [{ name: "北大路", id: "K04", dwell: 10 }] };
  const url = searchShareURL(
    "https://example.test/kyoto-transit/?private=1#/now/route",
    via,
  );
  assert.ok(url.startsWith("https://example.test/kyoto-transit/?routeSearch="));
  assert.ok(!url.includes("private="));
  assert.deepEqual(readSharedSearch(url, network), via);
  assert.equal(
    readSharedSearch("https://example.test/?routeSearch=%7Bbad", network),
    null,
  );
  assert.equal(
    readSharedSearch(
      searchShareURL("https://example.test", {
        ...input,
        to: "存在しない停留所",
      }),
      network,
    ),
    null,
  );
  for (const bad of [
    { date: "2026-02-30" },
    { time: "25:00" },
    { via: [{ name: "北大路", id: "K04", dwell: -1 }] },
    { buffer: 99 },
    { via: Array(4).fill({ name: "北大路", id: "K04", dwell: 0 }) },
  ])
    assert.equal(validSearchInput({ ...input, ...bad }), false);
});
test("保存を削除しても別の交通機関、履歴、既存形式の保存は維持する", () => {
  let text = null;
  const storage = { getItem: () => text, setItem: (_, s) => (text = s) };
  saveSearchPair(storage, input, { favorite: true });
  saveSearchPair(storage, { ...input, toId: "B01" }, { favorite: true });
  saveSearchPair(storage, { from: "丸太町", to: "国際会館" });
  assert.equal(readSearchPairs(storage).favorites.length, 2);
  removeSearchPair(storage, input);
  assert.equal(readSearchPairs(storage).favorites.length, 1);
  assert.equal(readSearchPairs(storage).favorites[0].toId, "B01");
  assert.equal(readSearchPairs(storage).history.length, 1);
  assert.deepEqual(readSearchPairs(storage).history[0], {
    from: "丸太町",
    to: "国際会館",
  });
});

test("1本前の条件は初発便・前日の徒歩開始を扱い検索モードを維持する", () => {
  const routes = [
      {
        legs: [
          { kind: "walk", minutes: 5 },
          { kind: "ride", depart: 5 },
        ],
      },
    ],
    before = previousDepartureInput(input, routes);
  assert.equal(before.date, "2026-10-12");
  assert.equal(before.time, "23:59");
  assert.equal(before.timeMode, "departure");
  assert.equal(input.time, "10:00");
});
