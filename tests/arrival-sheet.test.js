import test from "node:test";
import assert from "node:assert/strict";
import { arrivedHome, departuresFrom, stationsNear } from "../public/js/arrival-sheet.js";

test("自宅の近く（400m以内）に着いたら自宅到着とし、乗り継ぎは出さない", () => {
  const home = { lat: 35.0, lng: 135.76 };
  assert.equal(arrivedHome({ lat: 35.002, lng: 135.76 }, home), true);
  assert.equal(arrivedHome({ lat: 35.02, lng: 135.76 }, home), false);
  assert.equal(arrivedHome({ lat: 35.02, lng: 135.76 }, home, { lat: 35.0005, lng: 135.76 }), true);
  assert.equal(arrivedHome({ lat: 35.0, lng: 135.76 }, null), false);
});

test("近くの駅からの次の発車を行先ごとに2本まで、時刻表どおりに出す", () => {
  const feed = { services: [
    { id: "s-n", operator: "subway", stops: ["K09", "K08", "K07"], trips: [600, 606, 612, 640, 700].map((t, i) => ({ id: `n${i}`, departures: [t, t + 2, t + 4], headsign: "国際会館" })) },
    { id: "s-s", operator: "subway", stops: ["K09", "K10", "K11"], trips: [603, 609].map((t, i) => ({ id: `s${i}`, departures: [t, t + 2, t + 4], headsign: "竹田" })) },
    { id: "end", operator: "subway", stops: ["K08", "K09"], trips: [{ id: "x", departures: [601, 603] }] },
  ] };
  const rows = departuresFrom(feed, "K09", { minute: 601, network: null });
  assert.deepEqual(rows.map((r) => [r.depart, r.destination]), [[603, "竹田"], [606, "国際会館"], [609, "竹田"], [612, "国際会館"]]);
  assert.equal(rows[0].officialStops[0].id, "K09");
  assert.equal(rows[0].from, "K09");
  // 600 already left; a station that is a trip's terminus has no departure.
  assert.ok(!rows.some((r) => r.depart === 600 || r.tripId === "x"));
});

test("徒歩圏（600m）の地下鉄・近鉄駅だけを近い順に", () => {
  const geo = { stops: [{ id: "K09", lat: 35.0039, lng: 135.7598 }, { id: "B01", lat: 34.985, lng: 135.758 }, { id: "bus", lat: 35.004, lng: 135.76 }] };
  const network = { stops: new Map([["K09", { id: "K09", type: "subway" }], ["B01", { id: "B01", type: "kintetsu" }], ["bus", { id: "bus", type: "citybus" }]]) };
  assert.deepEqual(stationsNear({ lat: 35.004, lng: 135.76 }, geo, network).map((r) => r.stop.id), ["K09"]);
});
