import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/js/vnext.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("detected ride candidate requires an explicit second confirmation", () => {
  const selectionBranch = app.match(
    /else if \(b\.dataset\.rideCandidate !== undefined\) \{([\s\S]*?)\n    \} else if/,
  )?.[1];
  assert.ok(selectionBranch, "candidate selection branch should exist");
  assert.match(selectionBranch, /openRideCandidateConfirmation/);
  assert.doesNotMatch(selectionBranch, /confirmRideCandidate/);
  assert.match(app, /data-confirm-ride-candidate/);
  assert.match(app, /confirmRideCandidate\(index\)/);
});

test("ride confirmation is keyed to the selected service, not a stale array index", () => {
  assert.match(app, /const key = transitCandidateKey\(candidate\.ride\)/);
  assert.match(
    app,
    /transitCandidateKey\(candidate\.ride\) === b\.dataset\.confirmRideCandidate/,
  );
});

test("idle Now prioritizes nearby departures and search before diagnostic candidates", () => {
  const nearby = html.indexOf('id="nearby-panel"');
  const search = html.indexOf('id="now-search"');
  const vehicle = html.indexOf('id="vehicle-panel"');
  assert.ok(nearby >= 0 && search >= 0 && vehicle >= 0);
  assert.ok(nearby < search && search < vehicle);
});

test("primary Japanese surfaces use Now and Settings terminology", () => {
  assert.match(html, /data-view="now" aria-label="今"/);
  assert.match(html, /data-view="settings" aria-label="設定"/);
  assert.match(app, /if \(tab === "now"\) return english \? "Now" : "今"/);
  assert.match(
    app,
    /if \(tab === "settings"\) return english \? "Settings" : "設定"/,
  );
  assert.match(app, /mymap-navigation-change[\s\S]*syncPrimaryRootTitle\(\)/);
});

test("README matches the five-tab UI and two-step detected ride confirmation", () => {
  assert.match(readme, /「今」「検索」「時刻表」「運行情報」「設定」の5タブ/);
  assert.match(readme, /候補を1回タップしただけでは乗車状態へ移行しません/);
  assert.match(readme, /「設定 → 表示 \/ アクセシビリティ → 言語」/);
});
