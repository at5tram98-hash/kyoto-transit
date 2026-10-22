import test from "node:test";
import assert from "node:assert/strict";
import { joinThroughFromFeeds, throughContinuations } from "../public/js/through-continuity.js";

const network = { stops: new Map([["K13", "十条"], ["K14", "くいな橋"], ["K15", "竹田"], ["B06", "伏見"], ["B07", "近鉄丹波橋"], ["B08", "桃山御陵前"]].map(([id, name]) => [id, { name }])) };
// Kintetsu lists the northbound through train only up to Fushimi (B06).
const kintetsuNorth = {
  operator: "kintetsu", serviceDate: "2026-10-22", destination: "国際会館",
  officialStops: [{ id: "B07", time: 600 }, { id: "B06", time: 603, departure: 603 }],
};
const subwayFeed = { services: [{ id: "n", stops: ["K15", "K14", "K13"], trips: [
  { id: "x", date: "2026-10-22", arrivals: [606, 608, 610], departures: [606, 608, 610], headsign: "国際会館" },
  { id: "y", date: "2026-10-22", arrivals: [612, 614, 616], departures: [612, 614, 616], headsign: "国際会館" },
] }] };

test("近鉄の国際会館行きは公式の竹田発時刻、無ければ唯一の候補で地下鉄へ通しでつなぐ", () => {
  const exact = joinThroughFromFeeds(kintetsuNorth, { subwayFeed, network, takedaDeparture: 612 });
  assert.equal(exact.continuationTripId, "y");
  assert.equal(exact.throughContinuation, "official-trip");
  const ride = joinThroughFromFeeds(kintetsuNorth, { subwayFeed, network });
  assert.equal(ride.operator, "through");
  assert.deepEqual(ride.officialStops.map((s) => s.id), ["B07", "B06", "K15", "K14", "K13"]);
  assert.equal(ride.officialStops[2].departure, 606);
});

test("行先が違う・候補が複数・こちら側で降りる場合はつながない", () => {
  assert.equal(joinThroughFromFeeds({ ...kintetsuNorth, destination: "京都" }, { subwayFeed, network }), null);
  const twin = { services: [{ ...subwayFeed.services[0], trips: [subwayFeed.services[0].trips[0], { ...subwayFeed.services[0].trips[0], id: "z", departures: [607, 609, 611] }] }] };
  assert.equal(joinThroughFromFeeds(kintetsuNorth, { subwayFeed: twin, network }), null);
  assert.equal(joinThroughFromFeeds({ ...kintetsuNorth, userDestination: { id: "B06" } }, { subwayFeed, network }), null);
});

const subwaySouth = { operator: "subway", serviceDate: "2026-10-22", destination: "竹田",
  officialStops: [{ id: "K13", time: 700 }, { id: "K14", time: 702 }, { id: "K15", time: 704 }] };
const kintetsuFeed = { services: [{ id: "s", stops: ["K15", "B06", "B07", "B08"], trips: [
  { id: "k", date: "2026-10-22", arrivals: [706, 708, 711, 713], departures: [706, 708, 711, 713], headsign: "近鉄丹波橋" },
] }] };

test("地下鉄の竹田行きは、アナウンスの行先か近鉄側の降車駅があるときだけ近鉄へつなぐ", () => {
  assert.equal(joinThroughFromFeeds(subwaySouth, { kintetsuFeed, network }), null, "時刻だけでは直通と断定しない");
  assert.equal(throughContinuations(subwaySouth, { kintetsuFeed }).length, 1, "確認候補としては出す");
  const heard = joinThroughFromFeeds(subwaySouth, { kintetsuFeed, network, heardDestinations: ["B07"] });
  assert.deepEqual(heard.officialStops.map((s) => s.id), ["K13", "K14", "K15", "B06", "B07", "B08"]);
  assert.equal(heard.officialStops[2].departure, 706);
  const chosen = joinThroughFromFeeds({ ...subwaySouth, userDestination: { id: "B08" } }, { kintetsuFeed, network });
  assert.equal(chosen.throughContinuation, "selected-destination");
});
