import test from "node:test";
import assert from "node:assert/strict";
import { routeFacts, routeComparison, transferRisk } from "../public/js/route-comparison-c2-c5.js";
import { sortedRouteIndexes } from "../public/js/route-search-model.js";
import { quickSearchStops } from "../public/js/search-shortcuts-c1.js";

function route(start, time, legs, fare = null, transfers = 0) {
 return { start, time, legs, transfers, fare: { additional: fare, normal: fare } };
}
test("C quality: fastest badge follows displayed first train departure", () => {
 const early = route(595, 630, [{kind:"ride",depart:610,arrive:630}],200);
 const late = route(600, 626, [{kind:"ride",depart:600,arrive:626}],220);
 assert.equal(routeFacts(early).duration,20);
 assert.deepEqual(routeComparison([early,late]).map(r=>r.fastest),[true,false]);
});
test("C quality: known zero additional fare is not mistaken for unavailable", () => {
 const free=route(600,625,[{kind:"ride",depart:600,arrive:625}],0);
 const unknown=route(600,620,[{kind:"ride",depart:600,arrive:620}],null);
 assert.equal(routeFacts(free).fare,0);
 assert.equal(routeFacts(unknown).fare,null);
 assert.deepEqual(routeComparison([free,unknown]).map(x=>x.cheapest),[true,false]);
 assert.deepEqual(sortedRouteIndexes([unknown,free],"fare"),[1,0]);
});
test("C quality: tight transfer includes walking and dwell; no phantom transfer for simple route",()=>{
 const r=route(600,630,[
  {kind:"ride",depart:600,arrive:610},
  {kind:"walk",depart:610,arrive:615,minutes:5},
  {kind:"dwell",depart:615,arrive:617,minutes:2},
  {kind:"ride",depart:619,arrive:630},
 ]);
 assert.equal(transferRisk(r,3).shortest,2);
 assert.equal(transferRisk(r,3).critical,true);
 assert.equal(transferRisk(route(600,620,[{kind:"ride",depart:600,arrive:620}])).shortest,null);
});
test("C quality: sort never mutates input itinerary array",()=>{
 const x=route(600,620,[{kind:"walk",minutes:8}]);
 const y=route(600,640,[{kind:"ride",depart:600,arrive:640}]);
 const rows=[x,y];
 assert.deepEqual(sortedRouteIndexes(rows,"walking"),[1,0]);
 assert.equal(rows[0],x);
});
test("C quality: unsupported shortcut station cannot be offered",()=>{
 assert.deepEqual(quickSearchStops({stops:new Map([["K01",{id:"K01",name:"国際会館"}]])}).map(s=>s.id),["K01"]);
});
