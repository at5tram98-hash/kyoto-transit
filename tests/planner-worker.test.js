import test from 'node:test';
import assert from 'node:assert/strict';
import {createNetwork} from '../public/js/network.js';
import {planWorkerJob} from '../public/js/planner-worker.js';

test('Web Worker用探索は静的feedを統合して経路を返す',()=>{
  const network=createNetwork({});network.services=[];
  const feed={validDates:['2026-10-10'],meta:{operator:'subway',stale:false},stops:[{id:'K01',name:'国際会館'},{id:'K02',name:'松ヶ崎'}],services:[{id:'s',operator:'subway',label:'地下鉄烏丸線',category:'local',stops:['K01','K02'],trips:[{id:'t',date:'2026-10-10',arrivals:[600,602],departures:[600,602],headsign:'松ヶ崎'}]}]};
  const {planned,feedMeta}=planWorkerJob({base:{...network,services:[],mode:'timetable'},feeds:[feed],request:{from:'K01',to:'K02',date:'2026-10-10',start:599,timeMode:'departure',via:[],buffer:3,maxWalk:20,trainType:'all'},passes:{citybus:false,kyotobus:false,subway:false}});
  assert.equal(planned.length,1);assert.equal(planned[0].time,602);assert.equal(planned[0].legs[0].operator,'subway');assert.equal(feedMeta[0].operator,'subway');
});
