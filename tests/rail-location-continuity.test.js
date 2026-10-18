import test from "node:test";
import assert from "node:assert/strict";
import {
  stabilizeRailObservation,
  RAIL_GPS_GRACE_MS,
} from "../public/js/rail-location-continuity.js";
import { heroModel, reduceTrainState } from "../public/js/now-model.js";
import { journeyProgress } from "../public/js/journey-core.js";
import { nextStationHero } from "../public/js/now-components.js";

const at = 1000000;
const stops = ["K07","K08","K09","K10","K11"].map((id, i) => ({
  id, name: ["丸太町","烏丸御池","四条","五条","京都"][i],
  time: 600+i*2, departure: 600+i*2,
}));
const ride = {
  operator:"subway", from:"K07", to:"K11",
  category:"local", destination:"竹田", officialStops:stops,
  userDestination:{id:"K11"},
};
function model(minute, opts={}) {
  const { previous, at:now=at, ...rest } = opts;
  return heroModel(
    ride,
    journeyProgress(ride,{minute,at:now,...rest}),
    {minute,at:now,previous,locationStatus:rest.fix?"active":"unavailable",...rest},
  );
}
test("tunnel outage does not claim a stop or approach based on the timetable alone",()=>{
  for(const time of [600.5,601.5,602]){
    const result=model(time);
    assert.equal(result.phase,"DEPARTED");
    assert.equal(result.estimatedWithoutGps,true);
    assert.equal(result.locationConfidence,"unavailable");
    assert.match(nextStationHero(result,ride,{stops}),/時刻表による推定/);
  }
});
test("a brief GPS dropout holds the previous station instead of skipping immediately",()=>{
  const original={key:"ride",index:1,state:"DEPARTED",since:at,lastGpsAt:at,lastFixTimestamp:at};
  const next={key:"ride",index:3,state:"STOPPED"};
  const during=stabilizeRailObservation(original,next,{at:at+25000});
  assert.equal(during.index,1);
  assert.equal(during.state,"DEPARTED");
  assert.equal(during.positionSource,"schedule");
  const beyond=stabilizeRailObservation(original,next,{at:at+RAIL_GPS_GRACE_MS+1});
  assert.equal(beyond.index,3);
  assert.equal(beyond.state,"DEPARTED");
});
test("repeating the same fix never confirms a sudden two-stop GPS leap",()=>{
  const old={key:"ride",index:1,state:"DEPARTED",since:at,lastGpsAt:at,lastFixTimestamp:at};
  const jumped={key:"ride",index:4,state:"STOPPED"};
  const first=stabilizeRailObservation(old,jumped,{at:at+3000,hasFreshFix:true,fixTimestamp:at+3000});
  assert.equal(first.index,1);
  assert.equal(first.positionSource,"recovering");
  const once=reduceTrainState(old,first,at+3000);
  const repeated=stabilizeRailObservation(once,jumped,{at:at+4000,hasFreshFix:true,fixTimestamp:at+3000});
  assert.equal(repeated.index,1);
  const next=stabilizeRailObservation(once,jumped,{at:at+5500,hasFreshFix:true,fixTimestamp:at+5500});
  assert.equal(next.index,4);
  assert.equal(next.positionSource,"location");
});
test("a single errant fix during recovery does not permanently poison progress",()=>{
  const prev={key:"ride",index:2,state:"DEPARTED",since:at,lastGpsAt:at,lastFixTimestamp:at};
  const first=stabilizeRailObservation(prev,{key:"ride",index:4,state:"STOPPED"},{at:at+2000,hasFreshFix:true,fixTimestamp:at+2000});
  const resumed=stabilizeRailObservation(first,{key:"ride",index:3,state:"DEPARTED"},{at:at+4200,hasFreshFix:true,fixTimestamp:at+4200});
  assert.equal(resumed.index,3);
  assert.equal(resumed.pendingIndex,null);
});
test("ride change resets continuity rather than borrowing previous rail station",()=>{
  const old={key:"old",index:4,state:"STOPPED",since:at,lastGpsAt:at,lastFixTimestamp:at};
  const next=stabilizeRailObservation(old,{key:"different",index:1,state:"STOPPED"},{at:at+1000});
  assert.equal(next.index,1);
  assert.equal(next.state,"DEPARTED");
  assert.equal(next.lastGpsAt,null);
});
