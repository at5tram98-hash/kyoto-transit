import test from "node:test";
import assert from "node:assert/strict";
import { approachStops } from "../public/js/approach-stops.js";

const stops = new Map(
  ["a", "b", "c", "d", "e", "f"].map((id) => [id, { id, name: `${id.toUpperCase()}停留所` }]),
);
stops.set("f", { id: "f", name: "銀閣寺道" });
stops.set("a", { id: "a", name: "京都駅前" });
const network = {
  stops,
  services: [
    { operator: "citybus", route: "5", stops: ["a", "b", "c", "d", "e", "f"] },
    { operator: "citybus", route: "5", stops: ["f", "e", "d", "c", "b", "a"] },
  ],
};

test("行先の文字から方向を決め、手前の停留所を遠い順に返す", () => {
  const list = approachStops(network, "d", "5", "岩倉・銀閣寺", 2);
  assert.deepEqual(list.map((s) => [s.id, s.away]), [["b", 2], ["c", 1], ["d", 0]]);
  const back = approachStops(network, "d", "5", "京都駅", 2);
  assert.deepEqual(back.map((s) => s.id), ["f", "e", "d"]);
});

test("方向が決まらない・系統が無いときは停留所名を推測しない", () => {
  assert.equal(approachStops(network, "d", "5", "不明な行先"), null);
  assert.equal(approachStops(network, "d", "999", "銀閣寺"), null);
  assert.equal(approachStops(network, "a", "5", "銀閣寺"), null, "始発の停留所には手前が無い");
  assert.deepEqual(approachStops(network, "a", "5", "京都駅", 1).map((s) => s.id), ["b", "a"]);
});
