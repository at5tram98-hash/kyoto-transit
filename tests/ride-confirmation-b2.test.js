import test from "node:test";
import assert from "node:assert/strict";
import { rideConfirmationFacts } from "../public/js/ride-confirmation-facts.js";

const stops = [
 {id:"K09",name:"四条",arrival:600,departure:600},
 {id:"K10",name:"五条",arrival:602,departure:602},
 {id:"K11",name:"京都",arrival:604,departure:604},
];
const ride={operator:"subway",from:"K09",to:"K11",depart:600,destination:"竹田",officialStops:stops};
test("B-2: boarding and service terminus must not infer alighting",()=>{
 const f=rideConfirmationFacts({ride,score:79,source:"schedule"},{vehicleMoving:true});
 assert.equal(f.boarding,"四条");
 assert.equal(f.destination,"竹田");
 assert.equal(f.alighting,null);
 assert.equal(f.stage,"motion");
 assert.equal(f.manualRequired,true);
});
test("B-2: preserve explicitly selected stop without mixing up service destination",()=>{
 const f=rideConfirmationFacts({ride:{...ride,userDestination:{id:"K10"}},score:55},{routeProgress:true,vehicleMoving:true});
 assert.equal(f.alighting,"五条");
 assert.equal(f.destination,"竹田");
 assert.equal(f.stage,"route-verified");
});
test("B-2: do not report score as probability or synthesize departure",()=>{
 const f=rideConfirmationFacts({ride:{...ride,depart:null,officialStops:[]},score:180});
 assert.equal(f.departure,null);
 assert.equal(f.score,100);
 assert.equal(f.stage,"not-verified");
});
