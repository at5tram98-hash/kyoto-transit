import test from "node:test";
import assert from "node:assert/strict";
import { busRowServesDirection } from "../public/js/vnext-detect.js";

const ride = (names) => ({ officialStops: names.map((name, i) => ({ id: `s${i}`, name })) });
const toKinkakuji = ride(["四条河原町", "四条烏丸", "西大路四条", "金閣寺道", "北大路バスターミナル（地下鉄北大路駅）"]);
const toKyotoStation = ride(["四条河原町", "四条烏丸", "烏丸七条", "京都駅前"]);

test("公式の行先表記は下流の停留所を含む方向だけを支持する", () => {
  const row = { route: "205", dest: "北大路バスターミナル・金閣寺" };
  assert.equal(busRowServesDirection(row, toKinkakuji), true);
  assert.equal(busRowServesDirection(row, toKyotoStation), false);
});

test("「まで」「（快速）」「（始発停留所）」の付いた行先も下流停留所と照合する", () => {
  assert.equal(busRowServesDirection({ dest: "京都駅まで" }, toKyotoStation), true);
  assert.equal(busRowServesDirection({ dest: "（快速）京都駅前" }, toKyotoStation), true);
  assert.equal(busRowServesDirection({ dest: "（始発停留所）金閣寺道" }, toKinkakuji), true);
});

test("現在の停留所名だけの一致や空の行先では方向を確定しない", () => {
  assert.equal(busRowServesDirection({ dest: "四条河原町" }, toKyotoStation), false);
  assert.equal(busRowServesDirection({ dest: "" }, toKyotoStation), false);
  assert.equal(busRowServesDirection(null, toKyotoStation), false);
});
