import test from "node:test";
import assert from "node:assert/strict";
import { detectionDisplayState as state } from "../public/js/detection-status-b3.js";
test("B-3: denied location outranks available candidates",()=>{
 assert.equal(state({locationStatus:"denied",candidates:3}),"permission");
 assert.equal(state({locationStatus:"loading",candidates:3}),"locating");
});
test("B-3: disabled or hidden detection is not called searching",()=>{
 assert.equal(state({autoDetect:false,locationStatus:"active"}),"disabled");
 assert.equal(state({hidden:true,locationStatus:"active"}),"paused");
});
test("B-3: candidate, confirmation, movement and idle states stay distinct",()=>{
 const base={locationStatus:"active"};
 assert.equal(state({...base,candidates:2,phase:"confirming"}),"confirming");
 assert.equal(state({...base,candidates:2,phase:"candidate"}),"candidate");
 assert.equal(state({...base,phase:"rechecking"}),"rechecking");
 assert.equal(state({...base,moving:true}),"moving");
 assert.equal(state(base),"searching");
});
