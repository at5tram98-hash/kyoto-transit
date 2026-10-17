import test from "node:test";
import assert from "node:assert/strict";
import ja from "../public/js/locale-ui-ja.js";
import en from "../public/js/locale-ui-en.js";
import { ui, setAppLocale, liveClock } from "../public/js/locale.js";
const slots = (text) =>
  [...text.matchAll(/\{(\d+)\}/g)]
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
test("English catalog preserves every message, placeholder, and action attribute", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ja).sort());
  for (const key of Object.keys(ja)) {
    assert.deepEqual(slots(en[key]), slots(ja[key]), key);
    const attributes = (html) =>
      [...html.matchAll(/(?:data-[\w-]+|name|id|value|form|class)="[^"]*"/g)]
        .map((m) => m[0])
        .sort();
    assert.deepEqual(attributes(en[key]), attributes(ja[key]), key);
    assert.equal(/\b(?:undefined|null)\b/.test(en[key]), false, key);
  }
});
test("locale changes preserve substitution values and service identity", () => {
  setAppLocale("en");
  assert.equal(ui("vnext_002"), "Search");
  assert.equal(ui("timetable_ui_005"), "北3");
  assert.equal(ui("timetable_ui_007"), "北大路バスターミナル");
  const a = ui("now_model_028", [5]);
  assert.match(a, /5 min/);
  assert.equal(ui("vnext_view_050", ["$&"]), " · Departs $&");
  setAppLocale("ja");
  assert.equal(ui("vnext_002"), "検索");
  assert.match(ui("now_model_028", [5]), /5分/);
});
test("the transit clock uses Japan time across locale and date boundaries", () => {
  assert.equal(
    liveClock(new Date("2026-10-16T15:03:04Z"), { locale: "en", hour12: false })
      .time,
    "00:03:04",
  );
});

test("English station aliases retain official Japanese identity and distinguish operators", async () => {
  const { createNetwork, searchStops } =
    await import("../public/js/network.js");
  const { resolveStop } = await import("../public/js/route-search-model.js");
  const network = createNetwork({});
  assert.equal(resolveStop(network, "Marutamachi Station").stop.id, "K07");
  assert.equal(resolveStop(network, "Kintetsu-Nara").stop.id, "A28");
  assert.ok(searchStops(network, "Kyoto").some((stop) => stop.id === "K11"));
  assert.ok(searchStops(network, "Kyoto").some((stop) => stop.id === "B01"));
  assert.equal(network.stops.get("K07").name, "丸太町");
});
