import test from "node:test";
import assert from "node:assert/strict";
import {
  navigationState,
  navigationTransition as move,
  restoreNavigation,
  currentRoute,
  swipeDecision,
} from "../public/js/navigation-core.js";
test("tab stacks retain separate paths, Back reaches the logical parent", () => {
  let s = move(navigationState(), { type: "push", screen: "stops" });
  s = move(s, { type: "push", screen: "station", params: { stopId: "K09" } });
  const station = currentRoute(s);
  s = move(s, { type: "tab", tab: "timetable" });
  s = move(s, { type: "push", screen: "search" });
  s = move(s, { type: "tab", tab: "now" });
  assert.deepEqual(currentRoute(s), station);
  s = move(s, { type: "pop" });
  assert.equal(currentRoute(s).type, "stops");
  assert.equal(s.stacks.timetable[0].type, "search");
  s = move(s, { type: "root" });
  assert.equal(currentRoute(s).type, "root");
  assert.equal(s.stacks.timetable.length, 1);
});
test("restoration rejects untrusted routes and parameters and repairs key sequence", () => {
  const s = restoreNavigation({
    version: 1,
    tab: "now",
    sequence: 0,
    stacks: {
      now: [
        {
          key: "now:91",
          type: "station",
          params: JSON.parse(
            '{"stopId":"K09","__proto__":{"polluted":true},"constructor":"bad"}',
          ),
        },
        { key: "now:92", type: "unsupported" },
      ],
    },
  });
  assert.equal(s.stacks.now.length, 1);
  assert.deepEqual(currentRoute(s).params, { stopId: "K09" });
  assert.equal(s.sequence, 91);
  assert.equal(
    move(s, { type: "push", screen: "map" }).stacks.now.at(-1).key,
    "now:92",
  );
  assert.equal({}.polluted, undefined);
});
test("depth is bounded and repeated current selection does not duplicate History", () => {
  let s = navigationState();
  for (let i = 0; i < 15; i++)
    s = move(s, {
      type: "push",
      screen: "station",
      params: { stopId: `K${i}` },
    });
  assert.equal(s.stacks.now.length, 8);
  const same = move(s, {
    type: "push",
    screen: "station",
    params: { stopId: "K7" },
  });
  assert.deepEqual(same, s);
  s = move(s, {
    type: "push",
    screen: "station",
    params: { stopId: "K02" },
    singleton: true,
  });
  assert.equal(s.stacks.now.length, 1);
});
test("interactive Pop uses distance and flick velocity and cancels vertical intent", () => {
  assert.equal(
    swipeDecision({ dx: 117, dy: 2, width: 390, velocity: 0.05 }),
    "cancel",
  );
  assert.equal(
    swipeDecision({ dx: 195, dy: 2, width: 390, velocity: 0.05 }),
    "pop",
  );
  assert.equal(
    swipeDecision({ dx: 45, dy: 2, width: 390, velocity: 0.8 }),
    "pop",
  );
  assert.equal(
    swipeDecision({ dx: 195, dy: 300, width: 390, velocity: 0.8 }),
    "cancel",
  );
  assert.equal(
    swipeDecision({ dx: -15, dy: 0, width: 390, velocity: 0.8 }),
    "cancel",
  );
});
