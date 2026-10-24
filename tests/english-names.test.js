import test from "node:test";
import assert from "node:assert/strict";
import { englishNameReplacer } from "../public/js/english-names.js";

const replace = englishNameReplacer([
  ["丸太町", "Marutamachi"],
  ["京都", "Kyoto"],
  ["竹田", "Takeda"],
  ["国際会館", "Kokusaikaikan"],
]);

test("rail names standing alone become their English spelling", () => {
  assert.equal(replace("Near 丸太町"), "Near Marutamachi");
  assert.equal(replace("京都駅"), "Kyoto");
  assert.equal(replace("地下鉄烏丸線 国際会館行き"), "Karasuma Line to Kokusaikaikan");
  assert.equal(replace("竹田方面"), "towards Takeda");
  assert.equal(replace("京都・竹田"), "Kyoto · Takeda");
});

test("names inside longer Japanese names are left as published", () => {
  for (const name of ["烏丸丸太町", "京都駅前", "京都産大前"])
    assert.equal(replace(name), name);
});
