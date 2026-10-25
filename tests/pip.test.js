import test from "node:test";
import assert from "node:assert/strict";
import { pipContent } from "../public/js/pip.js";
import { state } from "../public/js/vnext-state.js";

test("PiPの残り分数は到着見込み時刻から数え、再描画がなくても進む", () => {
  globalThis.getComputedStyle ??= () => ({ getPropertyValue: () => "" });
  globalThis.document ??= { documentElement: {} };
  state.ride = { operator: "subway", destination: "国際会館" };
  state.heroModel = { lineId: "K", nextStation: { name: "四条" }, arrivalEstimate: 605, minutes: 5, nextIsDestination: false };
  const at600 = pipContent({ minute: 600 }), at603 = pipContent({ minute: 603 });
  assert.match(at600.detail, /5/);
  assert.match(at603.detail, /2/);
  assert.equal(at603.clock, "10:03");
  state.ride = null;
  state.heroModel = null;
});
