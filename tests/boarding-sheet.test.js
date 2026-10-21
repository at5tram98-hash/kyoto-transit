import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { swipeOutcome, snoozeBoarding, boardingSnoozed } from "../public/js/boarding-sheet.js";

test("上へのスワイプは距離か速さが十分な時だけ乗車案内を開始し、少しの移動は元に戻す", () => {
  assert.equal(swipeOutcome(-120, 0), "confirm");
  assert.equal(swipeOutcome(-40, -0.9), "confirm", "素早い上方向のフリック");
  assert.equal(swipeOutcome(-40, -0.1), "settle");
  assert.equal(swipeOutcome(-10, -2), "settle", "わずかな誤操作では確定しない");
  assert.equal(swipeOutcome(90, 0), "dismiss");
  assert.equal(swipeOutcome(30, 0.8), "dismiss");
  assert.equal(swipeOutcome(30, 0.1), "settle");
});

test("あとで・乗っていないは同じ候補を一定時間だけ再表示しない", () => {
  const now = 1_000_000;
  snoozeBoarding("a", 3, now);
  assert.equal(boardingSnoozed("a", now + 60_000), true);
  assert.equal(boardingSnoozed("a", now + 181_000), false);
  assert.equal(boardingSnoozed("b", now), false);
});

test("乗車確認シートは確定に明示のスワイプかボタンを要し、乗車中・別タブでは閉じる", () => {
  const sheet = readFileSync(new URL("../public/js/boarding-sheet.js", import.meta.url), "utf8"),
    view = readFileSync(new URL("../public/js/vnext-view.js", import.meta.url), "utf8");
  assert.match(sheet, /sheet\.show\(\)/, "非モーダルで表示し、画面操作を塞がない");
  assert.doesNotMatch(sheet, /showModal\(\)/);
  assert.match(sheet, /if \(outcome === "confirm"\) confirm\(\)/);
  assert.match(sheet, /data-boarding-confirm/, "スワイプできない利用者向けの確定ボタン");
  assert.match(view, /if \(state\.tab !== "now"\) return closeBoarding\(\);/);
  assert.match(view, /if \(state\.ride\) \{\n    closeBoarding\(\);/);
});
