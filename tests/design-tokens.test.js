import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
const directory = new URL("../public/", import.meta.url);
test("screen styles use shared geometry, elevation and color tokens", () => {
  for (const file of readdirSync(directory).filter((f) => f.endsWith(".css"))) {
    const css = readFileSync(new URL(file, directory), "utf8");
    for (const match of css.matchAll(
      /(?<![\w-])(border-radius|box-shadow):\s*([^;]+);/g,
    )) {
      const value = match[2].trim();
      assert.ok(
        value === "0" ||
          value === "none" ||
          value === "inherit" ||
          value.includes("var("),
        `${file}: ${match[0]}`,
      );
      assert.equal(
        /(?<![\w.-])\d+(?:px|%)/.test(value),
        false,
        `${file}: ${match[0]}`,
      );
    }
    if (file !== "vnext.css")
      assert.equal(
        /#[\da-f]{3,8}\b|rgba?\(\s*\d/i.test(css),
        false,
        `${file}: screen-owned color literal`,
      );
  }
});
