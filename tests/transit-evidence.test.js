import test from "node:test";
import assert from "node:assert/strict";
import {
  createTransitEvidenceEngine,
  orderedStopEvidence,
  transitCandidateKey,
} from "../public/js/transit-evidence.js";
import {
  parseAnnouncement,
  announcementMatch,
} from "../public/js/announcement-parser.js";
import { cityBusRideCandidates } from "../public/js/vnext-core.js";
import { createNetwork } from "../public/js/network.js";
import catalog from "../public/data/bus-catalog.json" with { type: "json" };
import { normalizedBusSources } from "../public/js/arrival-stability.js";
const now = 1800000;
test("通信断では取得直後の接近情報も最新の実測と表示しない", () => {
  const data = {
    asOf: new Date(now).toISOString(),
    results: [{ route: "204", source: "live", minutes: 2 }],
  };
  assert.equal(
    normalizedBusSources(data, { now, online: true })[0].source,
    "live",
  );
  assert.equal(
    normalizedBusSources(data, { now, online: false })[0].source,
    "prediction",
  );
});
const ride = {
  operator: "subway",
  tripId: "N1",
  serviceId: "north",
  direction: "north",
  destination: "国際会館",
  depart: 600,
  officialStops: [
    { id: "K07", name: "丸太町", time: 600 },
    { id: "K06", name: "今出川", time: 603 },
    { id: "K05", name: "鞍馬口", time: 605 },
  ],
};
const row = { ride, score: 65 };
const add = (engine, type, at = now, metadata = {}, r = ride) =>
  engine.ingest({
    type,
    candidate: r,
    confidence: 0.8,
    observedAt: at,
    metadata,
  });

test("再評価で音声の点数を重ねず、弱い元候補を自動確定しない", () => {
  const e = createTransitEvidenceEngine();
  add(e, "timetable");
  add(e, "audio", now, { directionVerified: true });
  add(e, "motion");
  const first = e.evaluate([{ ride, score: 30 }], now);
  const second = e.evaluate(first.candidates, now + 1000);
  assert.equal(first.candidates[0].score, second.candidates[0].score);
  assert.equal(second.confirmed, null);
});
test("歩行速度の軌跡と端末の揺れだけでは電車に自動確定しない", () => {
  const e = createTransitEvidenceEngine();
  add(e, "timetable");
  add(e, "gps", now, { directionVerified: true, walkingLikely: true });
  add(e, "motion");
  e.evaluate([row], now);
  assert.equal(e.evaluate([row], now + 13000).confirmed, null);
});
test("音声で順位を区別しても画面へ渡す一致度は100を超えない", () => {
  const e = createTransitEvidenceEngine();
  add(e, "timetable");
  add(e, "audio", now, { directionVerified: true });
  const result = e.evaluate([{ ride, score: 95 }], now);
  assert.equal(result.candidates[0].score, 100);
  assert.equal(result.candidates[0].evidenceScore, 95);
  assert.equal(
    e.evaluate(result.candidates, now + 1000).candidates[0].score,
    100,
  );
});
test("GPSを繰り返しても独立した3証拠にはならず自動確定しない", () => {
  const e = createTransitEvidenceEngine();
  add(e, "timetable");
  for (let i = 0; i < 8; i++) {
    add(e, "gps", now + i * 1000, { directionVerified: true });
    assert.equal(e.evaluate([row], now + i * 1000).confirmed, null);
  }
  assert.equal(e.evaluate([row], now + 8000).count, 1);
});
test("地下でGPSが消えても時刻表・音声・Motionで方向を照合できる", () => {
  const e = createTransitEvidenceEngine();
  add(e, "timetable");
  add(e, "motion");
  add(e, "audio", now, { directionVerified: true });
  assert.equal(e.evaluate([row], now).confirmed, ride);
});
test("停車中speed=0でも駅contextを保持するが期限切れで破棄する", () => {
  const e = createTransitEvidenceEngine(),
    station = { id: "K07", meters: 10 },
    fix = { timestamp: now, accuracy: 12, speed: 0 };
  e.observeStation(station, fix, now);
  assert.equal(e.stationContext(now + 60000).station.id, "K07");
  assert.equal(e.stationContext(now + 240001), null);
});
test("方向が曖昧・逆方向・Motion単独・古い実測では確定しない", () => {
  for (const type of ["motion", "realtime"]) {
    const e = createTransitEvidenceEngine();
    add(e, "timetable");
    add(e, type, now - 100000, { directionVerified: true });
    assert.equal(e.evaluate([row], now).confirmed, null);
  }
  const e = createTransitEvidenceEngine();
  add(e, "timetable");
  add(e, "gps", now, { directionVerified: true, rejected: true });
  add(e, "audio", now, { directionVerified: true });
  assert.equal(e.evaluate([row], now).confirmed, null);
  const a = createTransitEvidenceEngine();
  add(a, "timetable");
  add(a, "gps");
  add(a, "motion");
  assert.equal(a.evaluate([row], now + 13000).confirmed, null);
});
test("確定後の弱いGPSや別方向候補でroute flipしない", () => {
  const e = createTransitEvidenceEngine();
  e.lock(ride);
  const other = { ...ride, direction: "south" };
  add(e, "timetable", now, {}, other);
  add(e, "audio", now, { directionVerified: true }, other);
  add(e, "gps", now, { directionVerified: true }, other);
  assert.equal(e.evaluate([{ ride: other, score: 90 }], now).confirmed, null);
});
test("循環のcycle indexは終端を跨ぎ、逆順はrejectする", () => {
  assert.equal(
    orderedStopEvidence(["A", "B", "C", "D", "E", "F", "A"], ["F", "A", "B"], {
      circular: true,
    }).matched,
    true,
  );
  assert.equal(
    orderedStopEvidence(["A", "B", "C", "D", "E", "F", "A"], ["C", "B", "A"], {
      circular: true,
    }).rejected,
    true,
  );
  assert.equal(orderedStopEvidence(["A", "B", "C"], ["C", "B"]).rejected, true);
});
test("実catalogの204は系統番号だけでなく両方向patternを保持する", () => {
  const network = createNetwork(catalog),
    service = network.services.find((s) => s.id === "bus-204-down"),
    id = service.stops[3];
  const ambiguous = cityBusRideCandidates({
    route: "204",
    currentStopId: id,
    network,
    minute: 600,
  });
  assert.ok(ambiguous.length >= 2);
  assert.notEqual(
    transitCandidateKey(ambiguous[0]),
    transitCandidateKey(ambiguous[1]),
  );
  const trail = service.stops.slice(1, 4),
    matched = cityBusRideCandidates({
      route: "204",
      currentStopId: id,
      trail,
      network,
      minute: 600,
    });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].servicePatternId, service.id);
  assert.equal(matched[0].depart, null);
});
test("音声は次駅・行先・系統・種別を分離し、単なる駅名や逆の便を選ばない", () => {
  const parsed = parseAnnouncement(
    "次は今出川です。この電車は国際会館行きです",
    [...ride.officialStops, { id: "K01", name: "国際会館" }],
  );
  assert.equal(parsed.nextStop, "K06");
  assert.equal(parsed.destination, "K01");
  assert.equal(
    announcementMatch(
      parseAnnouncement("今出川", ride.officialStops),
      ride,
      600,
    ),
    null,
  );
  assert.ok(
    announcementMatch(
      parseAnnouncement("次は今出川", ride.officialStops),
      ride,
      600,
    ),
  );
  const p = parseAnnouncement("近鉄奈良行き急行 204系統", [
    { id: "B28", name: "近鉄奈良" },
  ]);
  assert.equal(p.line, "kintetsu");
  assert.equal(p.trainType, "express");
  assert.equal(p.route, "204");
  assert.equal(p.destination, "B28");
});

test("循環バス候補は現在停留所から一周を保持し、基点到達後の次停留所を失わない", () => {
  const stops = ["A", "B", "C", "D", "E", "F", "A"];
  const network = {
    stops: new Map(stops.map((id) => [id, { id, name: id }])),
    services: [{ id: "loop", operator: "citybus", route: "204", stops }],
  };
  const rides = cityBusRideCandidates({
    route: "204",
    currentStopId: "E",
    trail: ["C", "D", "E"],
    network,
    minute: 600,
  });
  assert.deepEqual(
    rides[0].officialStops.map((s) => s.id),
    ["E", "F", "A", "B", "C", "D", "E"],
  );
  assert.equal(rides[0].syntheticTimes, false);
});

test("路線上を走る車のGPSと端末振動だけでは便を確定しない", () => {
  const e = createTransitEvidenceEngine();
  add(e, "timetable");
  add(e, "gps", now, { directionVerified: true });
  add(e, "motion");
  e.evaluate([row], now);
  assert.equal(e.evaluate([row], now + 13000).confirmed, null);
});
