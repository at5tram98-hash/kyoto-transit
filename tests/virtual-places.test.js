import test from "node:test";
import assert from "node:assert/strict";
import { placeWalks, setVirtualPlace, refreshVirtualPlaces, HERE_ID, HOME_ID, PLACE_RADIUS } from "../public/js/virtual-places.js";

const geo = { stops: [
  { id: "a", lat: 35.0, lng: 135.76 },
  { id: "b", lat: 35.005, lng: 135.76 },
  { id: "far", lat: 35.05, lng: 135.76 },
] };
const network = () => ({ stops: new Map(geo.stops.map((s) => [s.id, { id: s.id, name: s.id }])), walks: [] });

test("現在地は徒歩圏の駅・停留所と双方向の徒歩でつながる", () => {
  const walks = placeWalks(HERE_ID, { lat: 35.0, lng: 135.76 }, geo.stops);
  assert.deepEqual(new Set(walks.map((w) => (w.from === HERE_ID ? w.to : w.from))), new Set(["a", "b"]));
  // 556 m away at 80 m/min with a 1.3 detour: 10 minutes.
  assert.equal(walks.find((w) => w.from === HERE_ID && w.to === "b").minutes, 10);
  assert.ok(PLACE_RADIUS < 5000);
});

test("場所を更新すると前の徒歩は置き換わり、位置が無ければ取り除かれる", () => {
  const n = network();
  setVirtualPlace(n, HERE_ID, { lat: 35.0, lng: 135.76 }, geo.stops);
  setVirtualPlace(n, HERE_ID, { lat: 35.005, lng: 135.76 }, geo.stops);
  assert.equal(n.walks.filter((w) => w.from === HERE_ID).length, 2);
  assert.equal(n.stops.get(HERE_ID).virtual, true);
  setVirtualPlace(n, HERE_ID, null, geo.stops);
  assert.equal(n.stops.has(HERE_ID), false);
  assert.equal(n.walks.length, 0);
});

test("古い・粗い現在地は使わず、自宅は保存した地点を使う", () => {
  const n = network(), now = Date.parse("2026-10-24T01:00:00Z");
  const old = refreshVirtualPlaces(n, { fix: { lat: 35, lng: 135.76, accuracy: 10, timestamp: now - 600000 }, geo, home: { lat: 35.005, lng: 135.76 }, now });
  assert.equal(old.here, null);
  assert.equal(old.home.id, HOME_ID);
  const coarse = refreshVirtualPlaces(n, { fix: { lat: 35, lng: 135.76, accuracy: 900, timestamp: now }, geo, now });
  assert.equal(coarse.here, null);
  assert.equal(coarse.home, null);
});
