import test from "node:test";
import assert from "node:assert/strict";
import { parseAnnouncement } from "../public/js/announcement-parser.js";
import { SUBWAY_NAMES, KINTETSU_NAMES, subwayIds, kintetsuIds } from "../public/js/network.js";

const stops = [
  ...subwayIds.map((id, i) => ({ id, name: SUBWAY_NAMES[i], type: "subway" })),
  ...kintetsuIds.map((id, i) => ({ id, name: KINTETSU_NAMES[i], type: "kintetsu" })),
];

test("烏丸線の次駅放送：次は四条、四条です／乗換案内つき", () => {
  const p = parseAnnouncement("次は四条、四条です。阪急線はお乗り換えです。この電車は国際会館行きです。", stops);
  assert.equal(p.nextStop, "K09");
  assert.equal(p.destination, "K01");
});

test("到着放送：駅名を2回言って「です」は到着駅", () => {
  const p = parseAnnouncement("竹田、竹田です。京都方面へは4番のりばの電車にお乗り換えです", stops);
  assert.equal(p.arrival, "K15");
  assert.ok(p.nextStopIds.includes("K15"));
});

test("近鉄京都線：地下鉄線を通り国際会館行き・ひらがな認識も読む", () => {
  const p = parseAnnouncement("この電車は地下鉄線を通り国際会館行きです。次はももやまごりょうまえです", stops);
  assert.equal(p.destination, "K01");
  assert.equal(p.nextStop, "B08");
});

test("英語放送の駅番号：The next stop is Shijo, station number K zero-nine", () => {
  assert.equal(parseAnnouncement("The next stop is Shijo, station number K zero-nine.", stops).nextStop, "K09");
  assert.equal(parseAnnouncement("station number K eleven", stops).nextStop, "K11");
  assert.equal(parseAnnouncement("The next stop is Takeda, station number B05", stops).nextStop, "K15");
});

test("地下・GPS精度低では同名のバス停より駅を選ぶ", async () => {
  const { announcementStop } = await import("../public/js/vnext-detect.js");
  const network = { stops: new Map([
    ["bus-1", { id: "bus-1", name: "竹田", type: "citybus" }],
    ["K15", { id: "K15", name: "竹田", type: "subway" }],
  ]) };
  const parsed = { nextStop: "bus-1", nextStopIds: ["bus-1", "K15"] };
  assert.equal(announcementStop(parsed, network, true).id, "K15");
  assert.equal(announcementStop(parsed, network, false).id, "bus-1");
  assert.equal(announcementStop({ arrival: "K15", nextStop: "K15" }, network, true).id, "K15");
});

test("聞こえた駅をまだ通っていない列車だけを候補にする", async () => {
  const { heardOnRide } = await import("../public/js/vnext-detect.js");
  const ride = (times) => ({ officialStops: [["K08", times[0]], ["K07", times[1]], ["K06", times[2]]].map(([id, time]) => ({ id, time })) });
  assert.equal(heardOnRide(ride([598, 600, 602]), "K07", 600), true);
  assert.equal(heardOnRide(ride([590, 592, 594]), "K07", 600), false);
  assert.equal(heardOnRide({ officialStops: [{ id: "K06", time: 595 }, { id: "K05", time: 597 }] }, "K07", 600), false);
});
