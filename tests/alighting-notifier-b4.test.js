import test from "node:test";
import assert from "node:assert/strict";
import { createAlightingNotifier } from "../public/js/alighting-notifier-b4.js";
const base = {
 key:"ride-1|K11", selectedStop:"K11", displayedStop:"K11",
 nextIsDestination:true, locationConfirmed:true, enabled:true,
};
test("B-4: prepare and arrived are separate one-time alerts",()=>{
 const a=createAlightingNotifier();
 assert.equal(a.evaluate(base),"prepare");
 assert.equal(a.evaluate(base),null);
 assert.equal(a.evaluate({...base,stopped:true}),"arrived");
 assert.equal(a.evaluate({...base,stopped:true}),null);
});
test("B-4: GPS loss, non-target, and disabled settings never notify",()=>{
 const a=createAlightingNotifier();
 for (const patch of [
  {locationConfirmed:false},{displayedStop:"K10"},{nextIsDestination:false},
  {selectedStop:null},{enabled:false},
 ]) assert.equal(a.evaluate({...base,...patch}),null);
 assert.equal(a.evaluate(base),"prepare");
});
test("B-4: another ride or selected alighting stop can notify",()=>{
 const a=createAlightingNotifier();
 assert.equal(a.evaluate(base),"prepare");
 assert.equal(a.evaluate({...base,key:"ride-2|K11"}),"prepare");
 assert.equal(a.evaluate({...base,key:"ride-1|K10",selectedStop:"K10",displayedStop:"K10"}),"prepare");
 a.reset();assert.equal(a.evaluate(base),"prepare");
});
test("B-4: arrival is possible without earlier prepare but never guesses",()=>{
 const a=createAlightingNotifier();
 assert.equal(a.evaluate({...base,stopped:true}),"arrived");
 assert.equal(a.evaluate({...base,stopped:true,locationConfirmed:false}),null);
});
