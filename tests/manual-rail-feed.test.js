import test from 'node:test';
import assert from 'node:assert/strict';
import {compileKintetsuTrips} from '../worker/manual-rail-feed.js';

const trip=(tripId,category,destination,stops)=>({tripId,category,destination,stops});

test('近鉄公式便詳細を検索用JSONへ変換する',()=>{
  const feed=compileKintetsuTrips([
    trip('1-1960','local','橿原神宮前',[{name:'京都',departure:312},{name:'東寺',arrival:313,departure:314},{name:'竹田',arrival:319,departure:319},{name:'高の原',arrival:361,departure:361},{name:'大和西大寺',arrival:367,departure:368}]),
    trip('1-1935','express','天理',[{name:'京都',departure:478},{name:'東寺',arrival:480,departure:480},{name:'竹田',arrival:483,departure:484},{name:'近鉄丹波橋',arrival:486,departure:487},{name:'高の原',arrival:512,departure:512},{name:'大和西大寺',arrival:517,departure:518}])
  ],{date:'2026-10-09',revision:'2026-03-14',checkedAt:'2026-10-10T12:00:00Z'});
  assert.equal(feed.services.length,2);assert.equal(feed.validDates[0],'2026-10-09');assert.equal(feed.revisionDate,'2026-03-14');
  const local=feed.services.find(s=>s.category==='local');assert.deepEqual(local.stops,['B01','B02','K15','B24','B26']);assert.equal(local.trips[0].arrivals[3],361);
  const express=feed.services.find(s=>s.category==='express');assert.equal(express.trips[0].departures[0],478);assert.equal(express.operator,'kintetsu');
});

test('地下鉄直通便はthroughとして保持し未対応駅を捏造しない',()=>{
  const feed=compileKintetsuTrips([
    trip('through-1','express','国際会館',[{name:'大和西大寺',departure:600},{name:'高の原',arrival:605,departure:605},{name:'竹田',arrival:635,departure:636},{name:'くいな橋',arrival:638,departure:638},{name:'京都',arrival:650,departure:651},{name:'国際会館',arrival:672}]),
    trip('limited','other','京都',[{name:'高の原',departure:700},{name:'京都',arrival:725}])
  ],{date:'2026-10-10'});
  assert.equal(feed.services.length,1);assert.equal(feed.services[0].operator,'through');assert.ok(feed.services[0].stops.includes('K14'));assert.ok(feed.services[0].stops.includes('K01'));assert.ok(!feed.services.some(s=>s.category==='other'));
});
