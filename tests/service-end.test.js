import test from "node:test";
import assert from "node:assert/strict";
import { stopServiceDay, serviceEndState } from "../public/js/service-end.js";

const feed = { services: [{ stops: ["a", "b", "c"], trips: [
  { date: "2026-10-24", departures: [330, 335, 340] },
  { date: "2026-10-24", departures: [1400, 1405, 1410] },
  { date: "2026-10-25", departures: [1450, 1455, 1460] },
] }] };

test("停留所の始発・終発はその日の便から、終点は数えない", () => {
  assert.deepEqual(stopServiceDay([feed], "b", "2026-10-24"), { first: 335, last: 1405 });
  assert.equal(stopServiceDay([feed], "c", "2026-10-24"), null);
});

test("終発の後は運行終了、深夜1時以降の始発前も運行終了（始発つき）", () => {
  const day = { first: 335, last: 1405 };
  assert.equal(serviceEndState(day, 1406), "ended");
  assert.equal(serviceEndState(day, 1300), null);
  assert.equal(serviceEndState(day, 120), "before");
  // Before 01:00 the previous day's late trips may still run.
  assert.equal(serviceEndState(day, 30), null);
  // Shortly before the first departure it is no longer "ended".
  assert.equal(serviceEndState(day, 320), null);
  assert.equal(serviceEndState(null, 1406), null);
});
