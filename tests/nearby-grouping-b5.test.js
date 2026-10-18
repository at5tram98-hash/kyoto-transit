import test from "node:test";
import assert from "node:assert/strict";
import { groupNearbyPlaces } from "../public/js/transit-places.js";
const row=(id,name,type,meters=0)=>({id,meters,stop:{id,name,type}});
const geo={stops:[
 {id:"K11",lat:34.9850,lng:135.7580},
 {id:"bus1",lat:34.9852,lng:135.7580},
 {id:"bus2",lat:34.98525,lng:135.7580},
 {id:"B01",lat:34.9860,lng:135.7582},
 {id:"far",lat:35.1000,lng:135.7600},
 {id:"other",lat:34.9900,lng:135.7582},
 {id:"another",lat:34.9910,lng:135.7582},
 {id:"final",lat:34.9920,lng:135.7582},
]};
test("B-5: same nearby station groups distinct subway and bus stop actions",()=>{
 const groups=groupNearbyPlaces([
  row("K11","京都","subway",10),
  row("bus1","京都駅前","citybus",25),
  row("bus2","京都駅前","kyotobus",30),
 ],geo,{maxPlaces:4});
 assert.equal(groups.length,1);
 assert.equal(groups[0].name,"京都");
 assert.deepEqual(groups[0].rows.map(x=>x.id),["K11","bus1","bus2"]);
});
test("B-5: faraway same-named places must never be merged",()=>{
 const groups=groupNearbyPlaces([
  row("K11","京都","subway",10),
  row("far","京都駅前","citybus",11000),
 ],geo);
 assert.equal(groups.length,2);
});
test("B-5: cap places after grouping, not the first four operator rows",()=>{
 const groups=groupNearbyPlaces([
  row("K11","京都","subway",10),
  row("bus1","京都駅前","citybus",11),
  row("bus2","京都駅前","kyotobus",12),
  row("B01","近鉄京都","kintetsu",25),
  row("other","五条","subway",50),
  row("another","四条","subway",80),
  row("final","烏丸御池","subway",100),
 ],geo,{maxPlaces:4});
 assert.equal(groups.length,4);
 assert.equal(groups[0].rows.length,3);
 assert.ok(groups.some(g=>g.rows[0].id==="other"));
});
test("B-5: duplicate stop IDs are ignored without hiding different operators",()=>{
 const groups=groupNearbyPlaces([
  row("K11","京都","subway",10),
  row("K11","京都","subway",11),
  row("bus1","京都駅前","citybus",12),
 ],geo);
 assert.deepEqual(groups.flatMap(x=>x.rows.map(s=>s.id)),["K11","bus1"]);
});
test("B-5: missing GPS geometry does not merge coincidental station names",()=>{
 const g=groupNearbyPlaces([
  row("K11","京都","subway",15),
  row("bus1","京都駅前","citybus",17),
 ],null);
 assert.equal(g.length,2);
});
