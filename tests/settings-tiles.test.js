import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../public/${path}`, import.meta.url), "utf8");
const js = read("js/vnext-network-view.js");
const sheets = read("vnext-sheets.css");
const tokens = read("vnext.css");

test("settings menu uses colour-coded iOS-style icon tiles", () => {
  const block = js.match(/const tiles = \{([\s\S]*?)\};/);
  assert.ok(block, "tiles map exists");
  const used = new Set([...block[1].matchAll(/:\s*"(\w+)"/g)].map((m) => m[1]));
  used.add("purple"); // saved routes
  assert.ok(used.size >= 6, "categories are not all one colour");
  const dark = tokens.slice(tokens.indexOf("@media (prefers-color-scheme: dark)"));
  for (const name of used) {
    assert.match(tokens, new RegExp(`--tile-${name}:`), `light token ${name}`);
    assert.match(dark, new RegExp(`--tile-${name}:`), `dark token ${name}`);
    if (name !== "gray")
      assert.match(sheets, new RegExp(`\\[data-tile="${name}"\\]`), `rule ${name}`);
  }
  assert.match(js, /settings-menu-symbol icon-filled" data-tile=/);
});

test("settings tile press motion respects reduced motion", () => {
  const reduce = sheets.slice(sheets.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduce, /\.settings-menu-symbol/);
  assert.match(sheets, /\.settings-menu-row \+ \.settings-menu-row::before/);
});
