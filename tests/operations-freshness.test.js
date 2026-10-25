import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { operationsFreshness } from "../public/js/operation-status.js";

const now = Date.parse("2026-10-26T05:51:00+09:00");

test("official status shows when it was retrieved", () => {
  const fresh = operationsFreshness(
    { fetchedAt: "2026-10-25T20:49:30Z", lines: [] },
    { now },
  );
  assert.equal(fresh.time, "05:49");
  assert.equal(fresh.stale, false);
  assert.equal(fresh.label, "05:49 時点");
});

test("an old cached snapshot is called out by its age", () => {
  assert.equal(
    operationsFreshness({ fetchedAt: "2026-10-25T20:26:00Z" }, { now }).label,
    "25分前の情報",
  );
  const hours = operationsFreshness({ fetchedAt: "2026-10-25T17:40:00Z" }, { now });
  assert.equal(hours.stale, true);
  assert.equal(hours.label, "3時間前の情報");
});

test("falls back to the newest line time and ignores missing times", () => {
  const fresh = operationsFreshness(
    {
      lines: [
        { fetchedAt: null },
        { fetchedAt: "2026-10-25T20:40:00Z" },
        { fetchedAt: "2026-10-25T20:48:00Z" },
      ],
    },
    { now },
  );
  assert.equal(fresh.time, "05:48");
  assert.equal(operationsFreshness({ lines: [{ fetchedAt: null }] }, { now }), null);
  assert.equal(operationsFreshness(null, { now }), null);
});

test("overview header carries the freshness and a busy refresh button", () => {
  const js = readFileSync(new URL("../public/js/timetable-ui.js", import.meta.url), "utf8");
  assert.match(js, /freshnessHTML\(\),\n\s*\]\),/);
  assert.match(js, /setRefreshing\(true\)/);
  assert.match(js, /setRefreshing\(false\)/);
  for (const locale of ["ja", "en"]) {
    const text = readFileSync(new URL(`../public/js/locale-ui-${locale}.js`, import.meta.url), "utf8");
    assert.match(text, /\{10\}<\/span><button class="plain-action" data-operations-refresh>/);
    for (const key of ["operations_as_of", "operations_stale_age", "operations_stale_hours", "operations_refreshing"])
      assert.match(text, new RegExp(`${key}:`));
  }
});
