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
