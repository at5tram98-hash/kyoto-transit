import test from "node:test";
import assert from "node:assert/strict";
import { railDestinationName } from "../public/js/rail-names.js";
import {
  stationTimetableRows,
  railPositionNames,
  buildRailArrivalRows,
} from "../public/js/rail-arrivals-core.js";
import {
  officialFetcher,
  parseKintetsuBoard,
  readTimetable,
} from "../worker/timetables.js";

test("official Kintetsu abbreviations expand without altering full or unknown names", () => {
  assert.deepEqual(
    ["西", "奈", "橿", "京都", "国際会館", "未確認"].map(railDestinationName),
    ["大和西大寺", "近鉄奈良", "橿原神宮前", "京都", "国際会館", "未確認"],
  );
});
test("Takeda uses Kintetsu axis for near Kyoto and preserves one through trip", () => {
  const feed = {
    meta: { operator: "kintetsu" },
    services: [
      {
        id: "through",
        operator: "through",
        category: "local",
        stops: ["B07", "K15", "K07", "K01"],
        trips: [
          {
            id: "a",
            date: "2026-10-19",
            headsign: "国際会館",
            departures: [600, 610, 625, 640],
          },
        ],
      },
    ],
  };
  const rows = stationTimetableRows(feed, "K15", {
    date: "2026-10-19",
    minute: 607,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tripId, "a");
  assert.equal(rows[0].operator, "kintetsu");
  assert.equal(rows[0].direction, "north");
  assert.ok(Math.abs(rows[0].stationsAway - 0.6) < 0.0001);
  assert.deepEqual(railPositionNames(rows[0]), ["伏見", "竹田"]);
});
test("position descriptions follow travel direction and never invent unknown positions", () => {
  assert.deepEqual(
    railPositionNames({
      operator: "subway",
      railPosition: 9.5,
      direction: "north",
    }),
    ["京都", "五条"],
  );
  assert.deepEqual(
    railPositionNames({
      operator: "subway",
      railPosition: 9.5,
      direction: "south",
    }),
    ["五条", "京都"],
  );
  assert.equal(
    railPositionNames({ operator: "subway", railPosition: null }),
    null,
  );
  assert.equal(
    railPositionNames({ operator: "kintetsu", railPosition: 70 }),
    null,
  );
  assert.deepEqual(
    buildRailArrivalRows(
      { trains: [{ position: 5, dest: "奈", direction: "unknown" }] },
      null,
      "B07",
      600,
    ),
    [],
  );
});
const boot =
  '<script>const SCHEDULE_BOOT = {"master_current":{"stop_id":"7475_1"}};</script>';
test("Kyoto Bus complete official HTML succeeds even when Browser Run is unavailable", async () => {
  let calls = 0;
  const fetcher = officialFetcher(
    {
      BROWSER: {
        quickAction() {
          calls++;
          throw Error("Unavailable");
        },
      },
    },
    { direct: async () => new Response(boot) },
  );
  const response = await fetcher(
    "https://www.kyotobus.jp/route/timetable/schedule.html?stop_id=7475_1",
  );
  assert.match(await response.text(), /SCHEDULE_BOOT/);
  assert.equal(calls, 0);
});
test("Kyoto Bus interstitial falls back to browser and validates content", async () => {
  let calls = 0;
  const fetcher = officialFetcher(
    {
      BROWSER: {
        async quickAction() {
          calls++;
          return new Response(boot);
        },
      },
    },
    { direct: async () => new Response("<html>challenge</html>") },
  );
  assert.match(
    await (
      await fetcher(
        "https://www.kyotobus.jp/route/timetable/schedule.html?stop_id=7475_1",
      )
    ).text(),
    /SCHEDULE_BOOT/,
  );
  assert.equal(calls, 1);
});
test("Kyoto Bus both failed acquisition paths fail visibly rather than inventing a timetable", async () => {
  const fetcher = officialFetcher(
    {
      BROWSER: {
        async quickAction() {
          return new Response("unavailable", { status: 502 });
        },
      },
    },
    { direct: async () => new Response("unavailable", { status: 503 }) },
  );
  await assert.rejects(
    fetcher(
      "https://www.kyotobus.jp/route/timetable/schedule.html?stop_id=7475_1",
    ),
    /取得できません/,
  );
});

test("Kyoto Bus embedded platform array selects only the requested stop name and supported routes", async () => {
  const { parseKyotoPlatforms, jsonConstant } = await import(
    "../worker/timetables.js"
  );
  const rows = [
    {
      stop_id: "7475_1",
      stop_name: "京都産業大学前",
      routes: [{ route_short_name: "４０", stop_headsign: "国際会館駅前" }],
    },
    {
      stop_id: "7475_3",
      stop_name: "京都産業大学前",
      routes: [{ route_short_name: "４０", stop_headsign: "市原" }],
    },
    {
      stop_id: "91_1",
      stop_name: "国際会館駅前",
      routes: [{ route_short_name: "４０", stop_headsign: "京都産業大学前" }],
    },
  ];
  const html = `<script>const STOP_ROUTE = ${JSON.stringify(rows)};</script>`;
  assert.equal(jsonConstant(html, "STOP_ROUTE").length, 3);
  assert.deepEqual(
    parseKyotoPlatforms(html, "7475_1").map((b) => b.key),
    ["7475_1", "7475_3"],
  );
  assert.deepEqual(parseKyotoPlatforms(html, "unknown"), []);
});

test('manual refresh joins an in-flight warm request, but invalidates a fulfilled cached feed',async()=>{
 const {getStaticFeed}=await import('../public/js/fast-data.js');
 const prior=globalThis.fetch;let calls=0,release;
 const wait=new Promise(resolve=>release=resolve);
 globalThis.fetch=async()=>{calls++;await wait;return new Response(JSON.stringify({services:[],revision:calls}),{headers:{'Content-Type':'application/json'}});};
 try {
  const first=getStaticFeed('audit-subway','2026-10-19');
  const second=getStaticFeed('audit-subway','2026-10-19',{force:true});
  assert.equal(calls,1);release();
  assert.equal(await first,await second);
  await getStaticFeed('audit-subway','2026-10-19');assert.equal(calls,1);
  await getStaticFeed('audit-subway','2026-10-19',{force:true});assert.equal(calls,2);
 }finally{globalThis.fetch=prior;}
});

test('bus absolute arrival time remains anchored to observed time and never converts stops to minutes',async()=>{
 const {busArrivalEpoch}=await import('../public/js/arrival-stability.js');
 const at=Date.parse('2026-10-19T01:00:00Z');
 assert.equal(busArrivalEpoch({minutes:5,asOf:at}),at+300000);
 assert.equal(busArrivalEpoch({minutes:2,asOf:at,eta:at+300000}),at+300000);
 assert.equal(busArrivalEpoch({stopsAway:2,asOf:at}),null);
 assert.equal(busArrivalEpoch({minutes:5}),null);
});

test("Kyoto Bus retries the official origin once after a transient browser failure", async () => {
  let calls = 0;
  const fetcher = officialFetcher(
    {
      BROWSER: {
        quickAction: async () => new Response("busy", { status: 429 }),
      },
    },
    {
      direct: async () =>
        ++calls === 1
          ? new Response("busy", { status: 503 })
          : new Response(boot),
    },
  );
  assert.match(
    await (
      await fetcher(
        "https://www.kyotobus.jp/route/timetable/schedule.html?stop_id=7475_1",
      )
    ).text(),
    /SCHEDULE_BOOT/,
  );
  assert.equal(calls, 2);
});
