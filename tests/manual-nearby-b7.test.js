import test from "node:test";
import assert from "node:assert/strict";
import {manualNearbyRows, manualReferenceOptions} from "../public/js/manual-nearby-b7.js";
const network={stops:new Map([
 ["K01",{id:"K01",name:"国際会館",type:"subway"}],
 ["K02",{id:"K02",name:"松ヶ崎",type:"subway"}],
 ["bus-1",{id:"bus-1",name:"国際会館駅前",type:"citybus"}],
])};
const geo={stops:[
 {id:"K01",lat:35.064,lng:135.784},
 {id:"K02",lat:35.055,lng:135.780},
 {id:"bus-1",lat:35.0641,lng:135.7841},
]};
test("B-7: manual reference works without GPS and retains all operators",()=>{
 const rows=manualNearbyRows("K01",network,geo);
 assert.deepEqual(rows.map(x=>x.id),["K01","bus-1","K02"]);
 assert.equal(rows.every(r=>r.manualReference),true);
});
test("B-7: invalid reference never fabricates coordinates",()=>{
 assert.deepEqual(manualNearbyRows("missing",network,geo),[]);
 assert.deepEqual(manualNearbyRows("K01",network,null),[]);
});
test("B-7: searchable locations come from current catalog and geometry",()=>{
 assert.deepEqual(manualReferenceOptions(network,geo,"国際会館").map(x=>x.id),["K01","bus-1"]);
 assert.deepEqual(manualReferenceOptions(network,geo,"K02").map(x=>x.id),["K02"]);
});
