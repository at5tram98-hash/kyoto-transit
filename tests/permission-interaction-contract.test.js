import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const executableSource = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("マイク（音声認識）はGPS精度が低いときだけ起動し、録音APIは使わない", () => {
  const assist = executableSource(read("../public/js/motion-assist.js")),
    supervisor = executableSource(read("../public/js/smartlive-supervisor.js")),
    executable = assist + supervisor + executableSource(read("../public/js/audio-window.js"));
  // Every recognition start and continuation is gated by mic-policy.
  for (const source of [assist, supervisor]) {
    assert.match(source, /micAllowed\(\)/);
    assert.doesNotMatch(source, /microphoneAlreadyGranted/);
  }
  assert.equal((assist.match(/\.start\(\)/g) ?? []).length, 1);
  assert.equal((supervisor.match(/\.start\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(executable, /getUserMedia\s*\(/);
  assert.doesNotMatch(executable, /requestPermission\s*\(/);
  assert.doesNotMatch(executable, /Notification\.requestPermission\s*\(/);
});

test("通知権限を自動要求するコードを公開JSに持たない", () => {
  const files = [
    "../public/js/vnext.js",
    "../public/js/app-enhancements.js",
    "../public/js/motion-assist.js",
    "../public/js/vnext-detect.js",
  ];
  for (const file of files)
    assert.doesNotMatch(
      executableSource(read(file)),
      /Notification\.requestPermission\s*\(/,
      file,
    );
});

test("地図以外はピンチズームと長押し選択を抑え、入力と地図は例外にする", () => {
  const css = read("../public/interaction-guard.css"),
    js = read("../public/js/interaction-guard.js");
  assert.match(css, /\.app-shell[\s\S]*touch-action:\s*manipulation/);
  assert.match(css, /\.app-shell[\s\S]*user-select:\s*none/);
  assert.match(css, /input,[\s\S]*user-select:\s*text/);
  assert.match(css, /\.route-map-host[\s\S]*pinch-zoom/);
  assert.match(js, /gesturestart/);
  assert.match(
    js,
    /if \(!isMapTarget\(event\.target\)\) event\.preventDefault\(\)/,
  );
});
