import test from "node:test";
import assert from "node:assert/strict";
import {quickSearchStops,chooseQuickSearchStop} from "../public/js/search-shortcuts-c1.js";
const network={stops:new Map([["K01",{name:"国際会館"}],["K11",{name:"京都"}]])};
test("C-1: shortcuts only contain stations supported by current catalog",()=>{
 assert.deepEqual(quickSearchStops(network).map(s=>s.id),["K01","K11"]);
});
test("C-1: invalid selection does not modify unrelated fields",()=>{
 assert.equal(chooseQuickSearchStop(null,null,"to"),false);
 assert.equal(chooseQuickSearchStop(null,{id:"K01",name:"国際会館"},"via"),false);
});
