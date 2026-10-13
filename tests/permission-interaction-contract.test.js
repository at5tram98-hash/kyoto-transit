import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("自動アナウンス補助はマイク許可ダイアログを起動しない", () => {
  const source = read("../public/js/motion-assist.js");
  assert.match(source, /permissions\.query\(\{ name: "microphone" \}\)/);
  assert.match(source, /status\.state === "granted"/);
  assert.doesNotMatch(source, /getUserMedia\s*\(/);
  assert.doesNotMatch(source, /requestPermission\s*\(/);
  assert.doesNotMatch(source, /Notification\.requestPermission\s*\(/);
});

test("通知権限を自動要求するコードを公開JSに持たない", () => {
  const files = [
    "../public/js/vnext.js",
    "../public/js/app-enhancements.js",
    "../public/js/motion-assist.js",
    "../public/js/vnext-detect.js",
  ];
  for (const file of files)
    assert.doesNotMatch(read(file), /Notification\.requestPermission\s*\(/, file);
});

test("地図以外はピンチズームと長押し選択を抑え、入力と地図は例外にする", () => {
  const css = read("../public/interaction-guard.css"),
    js = read("../public/js/interaction-guard.js");
  assert.match(css, /\.app-shell[\s\S]*touch-action:\s*manipulation/);
  assert.match(css, /\.app-shell[\s\S]*user-select:\s*none/);
  assert.match(css, /input,[\s\S]*user-select:\s*text/);
  assert.match(css, /\.route-map-host[\s\S]*pinch-zoom/);
  assert.match(js, /gesturestart/);
  assert.match(js, /if \(!isMapTarget\(event\.target\)\) event\.preventDefault\(\)/);
});
