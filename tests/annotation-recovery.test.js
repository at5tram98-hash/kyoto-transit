import test from "node:test";
import assert from "node:assert/strict";
import { durationLabel, setAppLocale } from "../public/js/locale.js";
import {
  createTransitEvidenceEngine,
  shouldOfferRideConfirmation,
} from "../public/js/transit-evidence.js";
import {
  stationTimetableRows,
  buildRailArrivalRows,
} from "../public/js/rail-arrivals-core.js";
import { busServiceKey } from "../public/js/arrival-stability.js";
import { parseOperation, operationInformation } from "../worker/operations.js";

test("elapsed durations preserve minutes and show complete hour/minute values in both locales", () => {
  setAppLocale("ja");
  assert.deepEqual([40, 59, 60, 61, 120].map(durationLabel), [
    "40分",
    "59分",
    "1時間0分",
    "1時間1分",
    "2時間0分",
  ]);
  assert.equal(durationLabel(NaN), "—");
  setAppLocale("en");
  assert.equal(durationLabel(61), "1 hr 1 min");
  setAppLocale("ja");
});
test("standing near an arriving bus does not solicit a boarding confirmation", () => {
  const candidate = { ride: { operator: "citybus", route: "204" } };
  assert.equal(
    shouldOfferRideConfirmation(candidate, { sources: ["gps", "realtime"] }),
    false,
  );
  assert.equal(
    shouldOfferRideConfirmation(candidate, { sources: ["motion"] }),
    false,
  );
  assert.equal(
    shouldOfferRideConfirmation(candidate, { sources: ["audio"] }),
    false,
  );
  assert.equal(
    shouldOfferRideConfirmation(candidate, { routeProgress: true }),
    true,
  );
  assert.equal(
    shouldOfferRideConfirmation(candidate, { sources: ["audio", "motion"] }),
    true,
  );
  assert.equal(
    shouldOfferRideConfirmation(
      { ...candidate, directionRejected: true },
      { routeProgress: true },
    ),
    false,
  );
});
test("route progress support expires and repeated station GPS fixes do not become route movement", () => {
  const engine = createTransitEvidenceEngine(),
    ride = { operator: "subway", route: "K" },
    now = 100000;
  for (let i = 0; i < 5; i++)
    engine.ingest({
      type: "gps",
      candidate: ride,
      confidence: 0.9,
      observedAt: now + i,
      metadata: { directionVerified: true },
    });
  assert.equal(engine.support(ride, now + 10).routeProgress, false);
  engine.ingest({
    type: "gps",
    candidate: ride,
    confidence: 0.9,
    observedAt: now + 20,
    metadata: { directionVerified: true, routeTrajectory: true },
  });
  assert.equal(engine.support(ride, now + 21).routeProgress, true);
  assert.equal(engine.support(ride, now + 50000).routeProgress, false);
});
test("service detail identity distinguishes opposite destinations and boarding platforms", () => {
  const row = { route: "北3", dest: "北大路バスターミナル", boarding: "A" };
  assert.notEqual(
    busServiceKey(row),
    busServiceKey({ ...row, dest: "京都産大前" }),
  );
  assert.notEqual(busServiceKey(row), busServiceKey({ ...row, boarding: "B" }));
});
test("station animations use actual dated timetable trips and never move a train before departure", () => {
  const date = "2026-10-18",
    feed = {
      services: [
        {
          id: "k",
          operator: "subway",
          stops: ["K07", "K08", "K09"],
          trips: [
            { id: "one", date, headsign: "竹田", departures: [600, 602, 604] },
            {
              id: "yesterday",
              date: "2026-10-17",
              departures: [600, 602, 604],
            },
          ],
        },
      ],
    };
  let rows = stationTimetableRows(feed, "K09", { date, minute: 599 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stationsAway, null);
  assert.equal(rows[0].minutes, 5);
  rows = stationTimetableRows(feed, "K09", { date, minute: 601 });
  assert.equal(rows[0].source, "schedule");
  assert.equal(rows[0].stationsAway, 1.5);
  assert.deepEqual(
    stationTimetableRows(feed, "K09", { date, minute: 605 }),
    [],
  );
});
test("observed train positions without a matching official trip keep unknown ETA", () => {
  const rows = buildRailArrivalRows(
    {
      trains: [
        {
          direction: "south",
          position: 3,
          category: "local",
          dest: "近鉄奈良",
        },
      ],
    },
    null,
    "B07",
    600,
  );
  assert.ok(rows.length);
  assert.equal(rows[0].minutes, null);
  assert.equal(rows[0].source, "live");
  assert.ok(Number.isFinite(rows[0].stationsAway));
});
test("Kintetsu fifteen-minute official threshold is recognized without inventing on-time guarantees", () => {
  const source = {
    id: "kintetsu",
    url: "https://www.kintetsu.jp/unkou/unkou.html",
  };
  const normal = parseOperation(
    "<body>現在は１５分以上の列車の遅れはございません。近鉄列車運行情報について 15分以上の遅れが発生した場合</body>",
    source,
  );
  assert.equal(normal.status, "normal");
  assert.match(normal.summary, /15分未満は対象外/);
  const unknown = parseOperation(
    "<body>近鉄列車運行情報について 遅れが発生した場合はお知らせします。運転見合わせ</body>",
    source,
  );
  assert.equal(unknown.status, "unconfirmed");
  assert.equal(
    parseOperation(
      '<body><font size="+1">京都線で運転を見合わせています。</font>近鉄列車運行情報について</body>',
      source,
    ).status,
    "suspended",
  );
});
test("operation fetch uses current official Kyoto URLs and returns notices without misclassifying them as live disruptions", async () => {
  const seen = [];
  const result = await operationInformation(async (url) => {
    seen.push(url);
    return new Response(
      '<html><body><a href="/kotsu/page/123.html">時代祭に伴う臨時経路変更について</a></body></html>',
      { headers: { "content-type": "text/html;charset=utf-8" } },
    );
  });
  assert.ok(
    seen.includes(
      "https://www.city.kyoto.lg.jp/kotsu/category/165-2-0-0-0-0-0-0-0-0.html",
    ),
  );
  const bus = result.lines.find((l) => l.id === "citybus");
  assert.equal(bus.status, "unconfirmed");
  assert.ok(bus.fetchedAt);
  assert.match(bus.notices[0].title, /臨時経路変更/);
});

test("station arrivals exclude trains terminating before the station and known non-stop patterns", () => {
  const train = {
    direction: "south",
    position: 3,
    category: "express",
    dest: "大和西大寺",
  };
  assert.deepEqual(
    buildRailArrivalRows({ trains: [train] }, null, "A28", 600),
    [],
  );
  const feed = {
    services: [
      {
        category: "express",
        stops: ["B01", "K15", "B07"],
        trips: [{ headsign: "大和西大寺" }],
      },
    ],
  };
  assert.deepEqual(
    buildRailArrivalRows({ trains: [train] }, feed, "B06", 600),
    [],
  );
  assert.deepEqual(
    buildRailArrivalRows(
      { trains: [{ ...train, position: null }] },
      null,
      "B07",
      600,
    ),
    [],
  );
});
