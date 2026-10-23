import test from "node:test";
import assert from "node:assert/strict";
import { transferSteps, planMinute } from "../public/js/transfer-guide.js";

const plan = (phase, legIndex) => ({
  phase,
  legIndex,
  input: { date: "2026-10-21" },
  route: {
    start: 600,
    legs: [
      { kind: "ride", operator: "subway", from: "K11", to: "K07", depart: 602, arrive: 610 },
      { kind: "walk", from: "K07", to: "bus:A", minutes: 4, depart: 610, arrive: 614 },
      { kind: "ride", operator: "citybus", route: "204", from: "bus:A", to: "bus:B", depart: 627, arrive: 649 },
    ],
  },
});

test("transfer steps list the walk and the remaining wait before the next ride", () => {
  const steps = transferSteps(plan("transfer", 2));
  assert.equal(steps.between.length, 1);
  assert.equal(steps.between[0].kind, "walk");
  assert.equal(steps.wait, 13);
  assert.equal(steps.next.route, "204");
  assert.deepEqual([steps.number, steps.total], [2, 2]);
});

test("transfer steps only exist between rides", () => {
  assert.equal(transferSteps(plan("riding", 0)), null);
  assert.equal(transferSteps(plan("transfer", 1)), null);
  assert.equal(transferSteps(null), null);
});

test("the plan minute counts past midnight on the service day", () => {
  const p = plan("transfer", 2);
  assert.equal(planMinute(p, { date: "2026-10-21", minute: 615 }), 615);
  assert.equal(planMinute(p, { date: "2026-10-22", minute: 10 }), 1450);
});
