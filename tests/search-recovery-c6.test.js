import test from "node:test";
import assert from "node:assert/strict";
import {searchRecoveryOptions,recoveryAction} from "../public/js/search-recovery-c6.js";
test("C-6: no-result recovery presents time and filter choices without changing query",()=>{
 const input={from:"K07",to:"K01",via:[],buffer:3,maxWalk:10};
 const before=structuredClone(input),options=searchRecoveryOptions(input);
 assert.deepEqual(options.map(x=>x.id),["date","filters"]);
 assert.deepEqual(input,before);
});
test("C-6: via stop correction is offered only if rider added vias",()=>{
 assert.deepEqual(searchRecoveryOptions({via:[{stop:"K09"}]}).map(x=>x.id),["date","filters","via"]);
 assert.deepEqual(searchRecoveryOptions(null),[]);
});
test("C-6: unknown recovery operations are rejected",()=>{
 assert.equal(recoveryAction("date"),"date");
 assert.equal(recoveryAction("filters"),"filters");
 assert.equal(recoveryAction("via"),"search");
 assert.equal(recoveryAction("unexpected"),null);
});
test("深夜（終電・終バス後）は翌朝の始発で検索する選択肢を出す",async()=>{
 const {firstServiceInput,lateNight}=await import("../public/js/search-recovery-c6.js");
 assert.deepEqual(searchRecoveryOptions({date:"2026-10-25",time:"23:40",via:[]}).map(x=>x.id),["first","date","filters"]);
 assert.equal(lateNight({time:"12:00"}),false);
 assert.equal(lateNight({time:"23:40",timeMode:"arrival"}),false);
 assert.deepEqual(firstServiceInput({date:"2026-10-25",time:"23:40"}),{date:"2026-10-26",time:"05:00",timeMode:"departure"});
 assert.deepEqual(firstServiceInput({date:"2026-10-26",time:"01:10"}),{date:"2026-10-26",time:"05:00",timeMode:"departure"});
 assert.equal(recoveryAction("first"),"first");
});
