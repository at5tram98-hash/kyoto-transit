import test from "node:test";
import assert from "node:assert/strict";
import {routeFacts,routeComparison,transferRisk} from "../public/js/route-comparison-c2-c5.js";
import {sortedRouteIndexes} from "../public/js/route-search-model.js";
const ride=(depart,arrive)=>({kind:"ride",depart,arrive});
const walk=(minutes)=>({kind:"walk",minutes});
const route=(start,time,transfers,fare,legs)=>({start,time,transfers,fare:{additional:fare,normal:fare},legs});
test("C-2: derive genuine duration, walk, transfers without fabricating missing fares",()=>{
 const r=route(600,630,1,null,[ride(600,610),walk(5),ride(620,630)]);
 const f=routeFacts(r);
 assert.deepEqual([f.duration,f.walking,f.transfers,f.fare],[30,5,1,null]);
});
test("C-2/C-4: fastest and cheapest comparisons respect independent metrics",()=>{
 const routes=[
  route(600,625,1,300,[ride(600,625)]),
  route(600,630,0,200,[ride(600,630)]),
  route(600,640,0,null,[ride(600,640)]),
 ];
 const c=routeComparison(routes);
 assert.equal(c[0].fastest,true);
 assert.equal(c[1].cheapest,true);
 assert.equal(c[2].cheapest,false);
 assert.equal(c[1].fewestTransfers,true);
});
test("C-3: transfer margin uses real schedule and flags tight connections",()=>{
 const r=route(600,640,1,300,[ride(600,615),ride(616,640)]);
 assert.equal(transferRisk(r,3).critical,true);
 assert.equal(transferRisk(r,1).critical,false);
 assert.equal(transferRisk(route(600,620,0,200,[ride(600,620)])).hasTransfer,false);
});
test("C-5: walking sort retains original indexes and zero-walk routes first",()=>{
 const routes=[
  route(600,630,0,100,[walk(8),ride(608,630)]),
  route(600,635,1,200,[ride(600,635)]),
  route(600,625,0,250,[walk(2),ride(602,625)]),
 ];
 assert.deepEqual(sortedRouteIndexes(routes,"walking"),[1,2,0]);
 assert.deepEqual(sortedRouteIndexes(routes,"fare"),[0,1,2]);
});
