import test from "node:test";
import assert from "node:assert/strict";
import { groupSettingsRows, settingsGroups } from "../public/js/settings-hierarchy-d1.js";
test("D-1: all existing Settings destinations have one owner and remain reachable",()=>{
 const keys=settingsGroups.flatMap(g=>g.rows);
 assert.equal(new Set(keys).size,keys.length);
 for(const key of ["pass","auto","notifications","location","display","routes","info","privacy","terms","advanced","permissions","saved-places","saved-routes"]) assert.ok(keys.includes(key));
 assert.deepEqual(settingsGroups.map(g=>g.id),["transit","experience","saved","about"]);
});
test("D-1: absent optional category isn't replaced with invented row",()=>{
 const groups=groupSettingsRows([["pass","<button>Pass</button>"],["privacy","<button>Privacy</button>"]]);
 assert.deepEqual(groups.map(g=>g.rows.length),[1,0,0,1]);
});
