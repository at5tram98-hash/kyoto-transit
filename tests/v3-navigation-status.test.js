import test from "node:test";
import assert from "node:assert/strict";
import {
  navigationState,
  navigationTransition,
  restoreNavigation,
} from "../public/js/navigation-core.js";
import {
  operationStatus,
  journeyOperationStatus,
} from "../public/js/operation-status.js";
import {
  readSavedPlaces,
  toggleSavedPlace,
} from "../public/js/saved-places.js";

test("v3 Search keeps its independent stack across timetable and browser restoration", () => {
  let s = navigationState("search");
  s = navigationTransition(s, {
    type: "push",
    screen: "results",
    params: { revision: 1 },
  });
  s = navigationTransition(s, {
    type: "push",
    screen: "route",
    params: { revision: 1, index: 0 },
  });
  s = navigationTransition(s, { type: "tab", tab: "timetable" });
  s = navigationTransition(s, {
    type: "push",
    screen: "board",
    params: { stopId: "K07" },
  });
  s = restoreNavigation(JSON.parse(JSON.stringify(s)));
  s = navigationTransition(s, { type: "tab", tab: "search" });
  assert.equal(s.stacks.search.at(-1).type, "route");
  assert.equal(s.stacks.timetable.at(-1).type, "board");
  s = navigationTransition(s, { type: "pop" });
  assert.equal(s.stacks.search.at(-1).type, "results");
});
test("official normal is not inferred from unknown or missing line data", () => {
  const normal = {
    id: "kintetsu",
    status: "normal",
    fetchedAt: new Date().toISOString(),
  };
  assert.equal(operationStatus(normal).kind, "success");
  assert.equal(
    operationStatus({
      ...normal,
      fetchedAt: new Date(Date.now() - 301000).toISOString(),
    }).kind,
    "unknown",
  );
  assert.equal(operationStatus(normal, { online: false }).kind, "unknown");
  assert.equal(
    operationStatus({ ...normal, status: "unconfirmed" }).kind,
    "unknown",
  );
  assert.equal(journeyOperationStatus([normal], ["through"]).kind, "unknown");
  assert.equal(
    journeyOperationStatus([normal], ["kintetsu"]).title,
    "影響なし",
  );
  assert.equal(
    journeyOperationStatus(
      [
        normal,
        { id: "subway", status: "suspended", fetchedAt: normal.fetchedAt },
      ],
      ["through"],
    ).kind,
    "danger",
  );
});
test("saved places deduplicate, remove and recover malformed storage without changing route pairs", () => {
  const values = new Map([["mymap-search-pairs-v1", "keep"]]);
  const storage = {
    getItem: (k) => values.get(k),
    setItem: (k, v) => values.set(k, v),
  };
  assert.equal(toggleSavedPlace("K07", storage), true);
  assert.deepEqual(readSavedPlaces(storage), ["K07"]);
  assert.equal(toggleSavedPlace("K07", storage), false);
  assert.deepEqual(readSavedPlaces(storage), []);
  values.set("mymap-saved-places-v1", "{");
  assert.deepEqual(readSavedPlaces(storage), []);
  assert.equal(values.get("mymap-search-pairs-v1"), "keep");
});
