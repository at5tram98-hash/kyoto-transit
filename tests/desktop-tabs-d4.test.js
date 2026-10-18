import test from "node:test";
import assert from "node:assert/strict";
import {nextSidebarTabIndex} from "../public/js/desktop-tabs-d4.js";
test("D-4: Up/Down wraps, Home/End choose first and last",()=>{
 assert.equal(nextSidebarTabIndex("ArrowDown",4,5),0);
 assert.equal(nextSidebarTabIndex("ArrowUp",0,5),4);
 assert.equal(nextSidebarTabIndex("Home",3,5),0);
 assert.equal(nextSidebarTabIndex("End",0,5),4);
});
test("D-4: ordinary typing and invalid focus never trigger navigation",()=>{
 for (const key of ["ArrowLeft","ArrowRight","Enter"," ","a","Tab"]) {
  assert.equal(nextSidebarTabIndex(key,2,5),null);
 }
 assert.equal(nextSidebarTabIndex("ArrowDown",-1,5),null);
 assert.equal(nextSidebarTabIndex("ArrowDown",3,0),null);
});
