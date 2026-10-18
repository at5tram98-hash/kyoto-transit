import test from "node:test";
import assert from "node:assert/strict";
import { orderNearbyPlaces } from "../public/js/nearby-sort-b6.js";
const a = {name:"A",meters:10,rows:[{id:"K01",stop:{type:"subway"}}]};
const b = {name:"B",meters:20,rows:[{id:"bus-1",stop:{type:"citybus"}}]};
const c = {name:"C",meters:30,rows:[{id:"B01",stop:{type:"kintetsu"}}]};
test("B-6: sort modes keep all stops and default to distance",()=>{
 assert.deepEqual(orderNearbyPlaces([c,b,a]).map(x=>x.name),["A","B","C"]);
 assert.deepEqual(orderNearbyPlaces([c,b,a],"invalid").map(x=>x.name),["A","B","C"]);
 assert.deepEqual(orderNearbyPlaces([b,c,a],"operator").map(x=>x.name),["A","C","B"]);
});
test("B-6: departure mode uses actual next scheduled departure; unknown lasts",()=>{
 const times={K01:640,"bus-1":610,B01:630};
 assert.deepEqual(orderNearbyPlaces([a,c,b],"departure",{nextDeparture:r=>times[r.id]}).map(x=>x.name),["B","C","A"]);
 assert.deepEqual(orderNearbyPlaces([a,b],"departure",{nextDeparture:r=>r.id==="K01"?640:Infinity}).map(x=>x.name),["A","B"]);
});
test("B-6: sorting doesn't mutate source array or hide bus actions",()=>{
 const places=[b,a],out=orderNearbyPlaces(places,"operator");
 assert.equal(places[0],b);assert.equal(out.length,2);assert.equal(out[1].rows[0].id,"bus-1");
});
