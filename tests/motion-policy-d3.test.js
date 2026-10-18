import test from "node:test";
import assert from "node:assert/strict";
import { motionPolicy, navigationTravel } from "../public/js/motion-policy-d3.js";
import { motionTokens } from "../public/js/navigation-motion.js";
test("D-3: reduced-motion removes animations rather than flashing for 90ms",()=>{
 assert.equal(motionPolicy({reduced:true,duration:320}).animate,false);
 assert.equal(motionPolicy({hidden:true,duration:320}).animate,false);
 assert.equal(motionPolicy({duration:220}).animate,true);
});
test("D-3: safe and bounded distances and durations",()=>{
 assert.equal(navigationTravel(undefined),390);
 assert.equal(navigationTravel(NaN),390);
 assert.equal(navigationTravel(99999),1600);
 assert.equal(motionPolicy({duration:1000}).duration,500);
 assert.ok(motionTokens.navigation<=500);
});
