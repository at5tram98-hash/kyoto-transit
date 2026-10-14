import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizedBusSources,
  busPreviewRows,
  busDirectionLabel,
  busServiceLabel,
  groupCityBusRows,
  busArrivalText,
  busCongestionText,
  normalizeCongestion,
  shouldShowKintetsuArrival,
  relevantMissingOperators,
} from "../public/js/arrival-stability.js";

test("204は方面ごとに明確な系統名へ分ける", () => {
  assert.equal(busDirectionLabel("204", "銀閣寺・高野"), "高野・銀閣寺方面");
  assert.equal(busDirectionLabel("204", "円町・金閣寺"), "金閣寺方面");
  assert.equal(
    busServiceLabel({
      route: "204",
      dest: "銀閣寺・高野",
      boarding: "Aのりば",
    }),
    "204（高野・銀閣寺方面） Aのりば",
  );
});

test("同じ系統・方面・のりばの複数接近車は1行へまとめる", () => {
  const rows = groupCityBusRows([
      {
        key: "a:0",
        route: "204",
        dest: "銀閣寺・高野",
        boarding: "Aのりば",
        minutes: 3,
        source: "live",
        congestion: "空席あり",
      },
      {
        key: "a:1",
        route: "204",
        dest: "銀閣寺・高野",
        boarding: "Aのりば",
        minutes: 11,
        source: "live",
        congestion: "混雑",
      },
      {
        key: "b:0",
        route: "204",
        dest: "円町・金閣寺",
        boarding: "Bのりば",
        stopsAway: 2,
        source: "live",
        congestion: "ゆったり立てる",
      },
    ]),
    ginkaku = rows.find((r) => r.dest === "銀閣寺・高野"),
    kinkaku = rows.find((r) => r.dest === "円町・金閣寺");
  assert.equal(rows.length, 2);
  assert.equal(ginkaku.arrivals.length, 2);
  assert.equal(busArrivalText(ginkaku), "あと3分・あと11分");
  assert.equal(busArrivalText(kinkaku), "2停留所前");
  assert.equal(busCongestionText(kinkaku), "ゆったり立てる");
});

test("停留所数しかない実測から架空の分数へ変換しない", () => {
  const [row] = groupCityBusRows([
    {
      key: "x",
      route: "10",
      dest: "四条河原町",
      stopsAway: 4,
      minutes: null,
      source: "live",
      confidence: 0.72,
    },
  ]);
  assert.equal(row.source, "live");
  assert.equal(busArrivalText(row), "4停留所前");
});

test("公式混雑度の表現を正規化する", () => {
  assert.equal(normalizeCongestion("大変混雑しています"), "大変混雑");
  assert.equal(normalizeCongestion("ゆったり立てます"), "ゆったり立てる");
  assert.equal(normalizeCongestion("空席があります"), "空席あり");
});

test("近鉄接近情報は近鉄線付近または乗車中だけ表示する", () => {
  assert.equal(
    shouldShowKintetsuArrival({ locationStatus: "bus", kintetsuMeters: 120 }),
    false,
  );
  assert.equal(
    shouldShowKintetsuArrival({ locationStatus: "rail", kintetsuMeters: 900 }),
    false,
  );
  assert.equal(
    shouldShowKintetsuArrival({ locationStatus: "rail", kintetsuMeters: 220 }),
    true,
  );
  assert.equal(
    shouldShowKintetsuArrival({
      locationStatus: "outside",
      rideOperator: "through",
      kintetsuMeters: 5000,
    }),
    true,
  );
});

test("経路で使わない事業者の未準備警告は出さない", () => {
  const missing = [{ operator: "citybus" }, { operator: "kyotobus" }],
    planned = [{ legs: [{ kind: "ride", operator: "subway" }] }];
  assert.deepEqual(
    relevantMissingOperators(
      missing,
      planned,
      "subway",
      "subway",
      "K07",
      "K01",
    ),
    [],
  );
  assert.deepEqual(
    relevantMissingOperators(
      [{ operator: "kyotobus" }],
      [],
      "subway",
      "kyotobus",
      "K01",
      "ksu",
    ).map((x) => x.operator),
    ["kyotobus"],
  );
});

test("各行の更新時刻を評価し古い実測だけを予測へ切り替える", () => {
  const now = Date.parse("2026-10-14T00:00:00Z"),
    data = {
      asOf: now,
      results: [
        { route: "10", source: "live", asOf: now - 91000, stopsAway: 1 },
        { route: "204", source: "live", asOf: now, minutes: 3 },
        { route: "205", source: "schedule", minutes: 12 },
      ],
    };
  const rows = normalizedBusSources(data, { now });
  assert.deepEqual(
    rows.map((r) => r.source),
    ["prediction", "live", "schedule"],
  );
  assert.equal(rows[0].minutes, undefined);
  assert.equal(rows[0].asOf, now - 91000);
});
test("地点プレビューは実測を優先し未確認行を除いて最大3便を表示する", () => {
  const now = Date.parse("2026-10-14T00:00:00Z"),
    data = {
      asOf: now,
      results: [
        { route: "10", source: "schedule", status: "時刻未確認" },
        { route: "204", source: "live", stopsAway: 4 },
        { route: "205", source: "live", minutes: 3 },
        { route: "206", source: "live", minutes: 1 },
        { route: "93", source: "prediction", minutes: 2 },
      ],
    };
  const rows = busPreviewRows(data, 3, { now });
  assert.deepEqual(
    rows.map((r) => r.route),
    ["206", "205", "204"],
  );
  assert.equal(rows[2].minutes, undefined);
  assert.equal(rows[2].stopsAway, 4);
});
test("保存・通信失敗時はプレビューの実測表示を継続しない", () => {
  const now = Date.parse("2026-10-14T00:00:00Z");
  assert.equal(
    busPreviewRows(
      {
        asOf: now,
        stale: true,
        results: [{ route: "204", source: "live", minutes: 1 }],
      },
      3,
      { now },
    )[0].source,
    "prediction",
  );
});

test("保存した予測便が新しい1停留所前の実測を隠さない", () => {
  const [group] = groupCityBusRows([
    {
      key: "old",
      route: "204",
      dest: "銀閣寺",
      source: "prediction",
      minutes: 1,
    },
    {
      key: "live",
      route: "204",
      dest: "銀閣寺",
      source: "live",
      minutes: null,
      stopsAway: 1,
    },
  ]);
  assert.equal(group.arrivals[0].key, "live");
  assert.equal(group.arrivals[0].stopsAway, 1);
  assert.equal(group.arrivals[1].key, "old");
});
test("分数と停留所前が混在しても実測のまもなくの便を優先する", () => {
  const [group] = groupCityBusRows([
    {
      key: "minutes",
      route: "204",
      dest: "銀閣寺",
      source: "live",
      minutes: 5,
    },
    {
      key: "near",
      route: "204",
      dest: "銀閣寺",
      source: "live",
      minutes: null,
      stopsAway: 1,
    },
  ]);
  assert.equal(group.arrivals[0].key, "near");
  assert.equal(group.arrivals.length, 2);
});
