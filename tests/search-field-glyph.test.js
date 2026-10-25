import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");

test("filled search fields share the line magnifier of the Now search", () => {
  const css = read("vnext-ui.css");
  assert.match(css, /\.native-search > span:first-child \{[^}]*mask: var\(--search-glyph\)/);
  assert.match(css, /--search-glyph: url\("data:image\/svg\+xml,/);
  assert.match(css, /forced-colors: active[\s\S]*?\.native-search > span:first-child/);
  for (const locale of ["ja", "en"]) {
    const text = read(`js/locale-ui-${locale}.js`);
    assert.equal(
      (text.match(/<div class="native-search"><span>/g) ?? []).length,
      0,
      `${locale}: decorative glyph is hidden from assistive technology`,
    );
  }
});

test("manual stop picker is spaced and shaped like the cards around it", () => {
  const css = read("route-search.css");
  const rule = css.match(/\.manual-nearby-picker \{([^}]*)\}/)[1];
  assert.match(rule, /margin:0 0 12px/);
  assert.match(rule, /border-radius:var\(--radius-inset\)/);
});
