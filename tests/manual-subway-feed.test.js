import test from 'node:test';
import assert from 'node:assert/strict';
import {subwayIds} from '../public/js/network.js';
import {compileSubwayDirection,compileSubwayBoards} from '../worker/manual-subway-feed.js';
import {readStatic} from '../worker/static-refresh.js';

const entries=(offset,count=16)=>Array.from({length:count},(_,i)=>({depart:360+i*8+offset}));
function directionBoards(ids){const map=new Map();ids.slice(0,-1).forEach((id,index)=>map.set(id,entries(index*2)));return map;}
const date='2026-10-10';

test('地下鉄公式駅時刻表を全駅の連続した便へ統合する',()=>{
  const south=compileSubwayDirection(directionBoards(subwayIds),{direction:'south',date});
  assert.equal(south.completeCount,16);assert.equal(south.services.length,1);const trip=south.services[0].trips[0];
  assert.equal(south.services[0].stops[0],'K01');assert.equal(south.services[0].stops.at(-1),'K15');assert.equal(trip.departures[0],360);assert.equal(trip.arrivals.at(-1),388);
});

test('北行きも竹田から国際会館まで同一JSONスキーマにする',()=>{
  const northIds=[...subwayIds].reverse(),north=compileSubwayDirection(directionBoards(northIds),{direction:'north',date});
  assert.equal(north.completeCount,16);assert.equal(north.services[0].stops[0],'K15');assert.equal(north.services[0].stops.at(-1),'K01');
});

test('公式時刻表fallbackは改正日・確認日・終点だけ導出したことを保持する',()=>{
  const feed=compileSubwayBoards({south:directionBoards(subwayIds),north:directionBoards([...subwayIds].reverse())},{date,day:'saturday',checkedAt:'2026-10-10T12:00:00Z'});
  assert.equal(feed.revisionDate,'2025-02-22');assert.equal(feed.meta.method,'official-station-timetable-json');assert.equal(feed.meta.terminalArrivalDerived,true);assert.equal(feed.validDates[0],date);assert.ok(feed.services.length>=2);
});

test('ODPT地下鉄GTFSが期限外なら保存版を使わず公式時刻表fallbackへ切り替える',async()=>{
  const manual=compileSubwayBoards({south:directionBoards(subwayIds),north:directionBoards([...subwayIds].reverse())},{date,day:'saturday',checkedAt:new Date().toISOString()});
  const staleGtfs={schemaVersion:2,operator:'subway',revisionDate:'2026-08-01',lastUpdated:'2026-08-01T00:00:00Z',validFrom:'2026-08-01',validTo:'2026-09-30',stops:[],routes:[],trips:[],calendar:[],calendarDates:[],shapes:[]};
  const values=new Map([['static:subway',JSON.stringify(staleGtfs)],['manual:subway:weekend',JSON.stringify(manual)]]),env={LIVE_KV:{get:async key=>values.get(key)??null}};
  const feed=await readStatic(env,'subway',date);assert.equal(feed.meta.method,'official-station-timetable-json');assert.equal(feed.meta.stale,false);assert.ok(feed.services.length>=2);
});

test('駅間の対応が崩れた場合は完全なfallbackを作ったことにしない',()=>{
  const boards=directionBoards(subwayIds);boards.set('K08',[]);assert.throws(()=>compileSubwayDirection(boards,{direction:'south',date}),/十分に照合できません/);
});
