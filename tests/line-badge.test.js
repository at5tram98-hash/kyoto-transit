import test from "node:test";
import assert from "node:assert/strict";
import { isLoopRoute, lineKind, lineBadge } from "../public/js/line-badge.js";

test("市バスの循環系統（200番台）は橙、その他は青の系統板", () => {
  for (const r of ["202", "204", "205", "206", "208", "２０６系統"])
    assert.equal(lineKind({ operator: "citybus", route: r }), "citybus-loop", r);
  for (const r of ["10", "13", "43", "46", "78", "93", "北3", "特205"])
    assert.equal(lineKind({ operator: "citybus", route: r }), "citybus", r);
  assert.equal(isLoopRoute("200"), false);
  assert.equal(isLoopRoute("209"), false);
});

test("京都バス・烏丸線・近鉄線・直通を見分ける", () => {
  assert.equal(lineKind({ operator: "kyotobus", route: "40" }), "kyotobus");
  assert.equal(lineKind({ operator: "kyotobus", route: "特40" }), "kyotobus-express");
  assert.equal(lineKind({ operator: "kyotobus", route: "臨時" }), "kyotobus-temp");
  assert.equal(lineKind({ operator: "bus", operatingCompany: "kyotobus", route: "40" }), "kyotobus");
  assert.equal(lineKind({ operator: "subway" }), "subway");
  assert.equal(lineKind({ operator: "kintetsu" }), "kintetsu");
  assert.equal(lineKind({ operator: "through", operatingCompany: "subway" }), "through");
});

test("系統板は番号、鉄道は路線記号と路線名を表示する", () => {
  const bus = lineBadge({ operator: "citybus", route: "205" });
  assert.match(bus, /data-line="citybus-loop"/);
  assert.match(bus, />205</);
  const rail = lineBadge({ operator: "subway" });
  assert.match(rail, /<i aria-hidden="true">K<\/i>/);
  assert.match(rail, /烏丸線/);
  assert.match(lineBadge({ operator: "kintetsu" }, { name: false }), /class="sr-only">近鉄京都線/);
  assert.match(lineBadge({ operator: "citybus", route: "<b>" }), /&lt;b&gt;/);
});
