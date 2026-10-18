import test from "node:test";
import assert from "node:assert/strict";
import { assessBoardingMovement } from "../public/js/auto-boarding-evidence.js";
import { createTransitEvidenceEngine } from "../public/js/transit-evidence.js";

const now = 1800000000000;
const ride = {
  operator: "subway", direction: "south", serviceId: "K-south",
  tripId: "S1", serviceDate: "2026-10-18", depart: 600,
};
const evidence = [
  { reason: "20秒以上、路線に沿う軌跡", points: 10 },
  { reason: "次の停車地点へ進行", points: 15 },
];
const locations = [0, 12000, 25000].map((offset, i) => ({
  lat: 35.0 + i * 0.00042,
  lng: 135.75,
  accuracy: 9,
  timestamp: now - 25000 + offset,
  speed: 7,
}));
const add = (engine, type, metadata = {}, candidate = ride) =>
  engine.ingest({
    type, candidate, observedAt: now, confidence: 0.85, metadata,
  });

test("several distinct precise moving GPS fixes and aligned track prove trajectory", () => {
  const result = assessBoardingMovement(locations, evidence, now);
  assert.equal(result.moving, true);
  assert.equal(result.routeTrajectory, true);
  assert.ok(result.travel > 60);
});
test("platform waiting, a phone shake and one GPS fix cannot prove boarding", () => {
  const parked = locations.map((p) => ({ ...p, lat: 35.0, speed: 0 }));
  assert.equal(assessBoardingMovement(parked, evidence, now).moving, false);
  assert.equal(assessBoardingMovement([locations.at(-1)], evidence, now).moving, false);
  assert.equal(
    assessBoardingMovement(locations.map(p=>({...p,accuracy:95})),evidence,now).routeTrajectory,
    false,
  );
});
test("opposite-direction evidence rejects moving trajectory", () => {
  const result = assessBoardingMovement(locations, [
    ...evidence, { reason:"進行方向が逆", points:-30 },
  ], now);
  assert.equal(result.reversed, true);
  assert.equal(result.routeTrajectory, false);
});
test("passing train + timetable + platform audio + device vibration do not auto-board", () => {
  const engine = createTransitEvidenceEngine();
  add(engine, "timetable");
  add(engine, "audio", { directionVerified:true });
  add(engine, "realtime", { directionVerified:true });
  add(engine, "motion", { vehicleMoving:false });
  assert.equal(engine.evaluate([{ride,score:90}],now).confirmed,null);
});
test("matching audio and verified travel trajectory confirm correct direction", () => {
  const engine = createTransitEvidenceEngine();
  add(engine, "timetable");
  add(engine, "audio", {directionVerified:true});
  add(engine, "gps", {
    directionVerified:true, vehicleMoving:true,
    routeTrajectory:true, walkingLikely:false,
  });
  assert.equal(engine.evaluate([{ride,score:82}],now).confirmed,ride);
});
test("nearby live trip plus travel trajectory confirms, but motion+GPS alone do not", () => {
  const engine = createTransitEvidenceEngine();
  add(engine, "timetable");
  add(engine, "gps", {
    directionVerified:true,vehicleMoving:true,routeTrajectory:true,
  });
  add(engine, "motion", {vehicleMoving:true});
  assert.equal(engine.evaluate([{ride,score:80}],now).confirmed,null);
  add(engine, "realtime", {directionVerified:true});
  assert.equal(engine.evaluate([{ride,score:80}],now).confirmed,ride);
});
test("an unverified opposite direction remains a candidate and is not automatically selected", () => {
  const engine = createTransitEvidenceEngine();
  const opposite = {...ride,direction:"north",tripId:"N1"};
  for(const type of ["timetable","gps","audio"]){
    add(engine,type,type==="gps" ?
      {directionVerified:true,vehicleMoving:true,routeTrajectory:true,rejected:true}:
      type==="audio"?{directionVerified:true}: {},opposite);
  }
  assert.equal(engine.evaluate([{ride:opposite,score:95}],now).confirmed,null);
});
test("sequence of independent announcements with live bus identity and moving motion is sufficient", () => {
  const engine=createTransitEvidenceEngine();
  add(engine,"timetable");
  add(engine,"audio",{directionVerified:true,sequenceValidated:true});
  add(engine,"realtime",{directionVerified:true});
  add(engine,"motion",{vehicleMoving:true});
  assert.equal(engine.evaluate([{ride,score:90}],now).confirmed,ride);
});

test("motion-less repeated station audio never triggers unsolicited ride confirmation", async () => {
  const { shouldOfferRideConfirmation } = await import("../public/js/transit-evidence.js");
  const engine = createTransitEvidenceEngine();
  add(engine, "timetable");
  add(engine, "audio", {directionVerified:true,sequenceValidated:true});
  add(engine, "realtime", {directionVerified:true});
  add(engine, "motion", {vehicleMoving:false});
  assert.equal(
    shouldOfferRideConfirmation({ride,score:90},engine.support(ride,now)),false,
  );
  add(engine, "motion", {vehicleMoving:true});
  assert.equal(
    shouldOfferRideConfirmation({ride,score:90},engine.support(ride,now)),true,
  );
});
