import test from "node:test";
import assert from "node:assert/strict";
import { createNetwork } from "../public/js/network.js";
import { officialTripLeg } from "../public/js/vehicle.js";
import {
  kintetsuProbeStops,
  kintetsuStaticTrips,
  mergeKintetsuTrips,
} from "../public/js/kintetsu-candidates.js";
import catalog from "../public/data/bus-catalog.json" with { type: "json" };

const network = createNetwork(catalog);
const date = "2026-10-26";
const feed = {
  validDates: [date],
  services: [
    {
      id: "south-local",
      operator: "kintetsu",
      category: "local",
      label: "近鉄京都線",
      stops: ["B01", "B02", "B03", "B04", "K15"],
      trips: [
        { id: "1-1709", date, headsign: "大和西大寺", departures: [1055, 1057, 1059, 1065, 1069], arrivals: [1055, 1057, 1059, 1065, 1069] },
        { id: "1-1929", date, headsign: "近鉄宮津", departures: [1040, 1042, 1044, 1046, 1049], arrivals: [1040, 1042, 1044, 1046, 1049] },
        { id: "early", date, headsign: "新田辺", departures: [1000, 1002, 1004, 1006, 1009], arrivals: [1000, 1002, 1004, 1006, 1009] },
        { id: "later", date, headsign: "新田辺", departures: [1070, 1072, 1074, 1076, 1079], arrivals: [1070, 1072, 1074, 1076, 1079] },
      ],
    },
    {
      id: "north-express",
      operator: "kintetsu",
      category: "express",
      label: "近鉄京都線",
      stops: ["K15", "B02"],
      trips: [{ id: "1-1937", date, headsign: "京都", departures: [1050, 1054], arrivals: [1050, 1054] }],
    },
  ],
};

test("近鉄の駅と前後の駅を調べる（自駅が先）", () => {
  assert.deepEqual(kintetsuProbeStops("B03"), ["B03", "B02", "B04"]);
  assert.deepEqual(kintetsuProbeStops("B01"), ["B01", "B02"]);
});

test("静的時刻表から、今乗っている可能性のある便を公式便と同じ形で作る", () => {
  const trips = kintetsuStaticTrips(feed, "B03", { minute: 1061, date, network });
  const ids = trips.map((t) => t.tripId);
  // Within [minute − 25, minute + 2] only; one record per trip, own station
  // first. The express passes Jujo without stopping: boarded at Takeda.
  assert.deepEqual(ids, ["1-1709", "1-1937", "1-1929"]);
  const t = trips[0];
  assert.equal(t.boardStop, "B03");
  assert.equal(t.title, "普通 大和西大寺行き");
  assert.deepEqual(t.stops.map((s) => s.id), ["B03", "B04", "K15"]);
  const leg = officialTripLeg(t, network);
  assert.equal(leg.operator, "kintetsu");
  assert.equal(leg.from, "B03");
  assert.equal(leg.depart, 1059);
  assert.equal(leg.officialTrip.tripId, "1-1709");
});

test("通過駅（十条・上鳥羽口）の近くでも、急行は手前の停車駅から乗った便として入る", () => {
  for (const at of ["B03", "B04"]) {
    const trips = kintetsuStaticTrips(feed, at, { minute: 1052, date, network });
    const express = trips.find((t) => t.tripId === "1-1937");
    assert.ok(express, at);
    assert.equal(express.boardStop, "K15");
    assert.deepEqual(express.stops.map((s) => s.id), ["K15", "B02"]);
  }
  // At its last stop a trip has nowhere left to go.
  assert.ok(!kintetsuStaticTrips(feed, "B01", { minute: 1056, date, network }).some((t) => t.tripId === "1-1937"));
});

test("別の日の便・時刻表なしは何も作らない", () => {
  assert.deepEqual(kintetsuStaticTrips(feed, "B03", { minute: 1061, date: "2026-10-27", network }), []);
  assert.deepEqual(kintetsuStaticTrips(null, "B03", { minute: 1061, date, network }), []);
});

test("公式の便情報があれば同じ便番号の静的便より優先する", () => {
  const official = [{ tripId: "1-1709", source: "official" }];
  const merged = mergeKintetsuTrips(official, [{ tripId: "1-1709", source: "static" }, { tripId: "x", source: "static" }]);
  assert.deepEqual(merged.map((t) => [t.tripId, t.source]), [["1-1709", "official"], ["x", "static"]]);
});

test("公式の便詳細（曜日自動）は日付を受け取り、日付なしでは読まない", async () => {
  const { readOfficialTrip } = await import("../worker/timetables.js");
  const reached = Symbol("fetch");
  const fetcher = () => {
    throw reached;
  };
  await assert.rejects(() => readOfficialTrip("B03", "south", "auto", "1-1709", fetcher), /日付を確認/);
  // With the date the calendar is read and the official page is requested.
  await assert.rejects(
    () => readOfficialTrip("B03", "south", "auto", "1-1709", fetcher, "2026-10-26"),
    (e) => e === reached || !/日付を確認/.test(String(e?.message ?? e)),
  );
});
