import test from "node:test";
import assert from "node:assert/strict";
import {
  foldbackMeetingPoints,
  nextFoldbackStop,
} from "../public/js/foldback-meetings.js";

test("次駅折り返しは停車中の現在駅を飛ばし、終点や未取得の次駅を推測しない", () => {
  const items = [{ id: "K07" }, { id: "K08" }];
  const hero = { phase: "STOPPED", nextStation: items[0], nextNext: items[1] };
  assert.equal(nextFoldbackStop(items, hero), items[1]);
  assert.equal(
    nextFoldbackStop(items, { ...hero, phase: "APPROACHING" }),
    items[0],
  );
  assert.equal(
    nextFoldbackStop(items, { ...hero, trainState: "LINE_BOUNDARY" }),
    items[1],
  );
  assert.equal(nextFoldbackStop(items, { ...hero, nextNext: null }), null);
  assert.equal(
    nextFoldbackStop(items, { ...hero, routeUnavailable: true }),
    null,
  );
  assert.equal(nextFoldbackStop(items, null), null);
});
const own = {
  officialStops: [
    { id: "A", name: "A", time: 600 },
    { id: "B", name: "B", time: 605 },
    { id: "C", name: "C", time: 610 },
  ],
};
test("指定した反対列車の全停車時刻から、移動時間を確保できる共通駅だけを返す", () => {
  const reverse = {
    fullOfficialStops: [
      { id: "C", departure: 612 },
      { id: "B", departure: 617 },
      { id: "A", departure: 622 },
    ],
    officialStops: [{ id: "A", departure: 622 }],
  };
  const rows = foldbackMeetingPoints(own, reverse, {
    minute: 604,
    shift: 2,
    buffer: 3,
  });
  assert.deepEqual(
    rows.map((r) => r.stopId),
    ["B"],
  );
  assert.equal(rows[0].assessment.arrival, 607);
  assert.equal(rows[0].assessment.slack, 7);
});
test("未取得時刻・複数出現・通過済みの駅を推測して追加しない", () => {
  const reverse = {
    officialStops: [
      { id: "A", departure: 620 },
      { id: "B", departure: null },
      { id: "C", departure: 625 },
      { id: "C", departure: 627 },
    ],
  };
  assert.deepEqual(
    foldbackMeetingPoints(own, reverse, { minute: 603, buffer: 3 }),
    [],
  );
});
test("翌日運行の反対列車を元旅程の絶対分へ戻して比較する", () => {
  const ride = { officialStops: [{ id: "X", name: "X", time: 1441 }] },
    reverse = { officialStops: [{ id: "X", departure: 8 }] };
  const rows = foldbackMeetingPoints(ride, reverse, {
    minute: 1439,
    buffer: 3,
    offset: 1440,
  });
  assert.equal(rows[0].depart, 1448);
  assert.equal(rows[0].serviceDepart, 8);
  assert.equal(rows[0].assessment.slack, 4);
});
