import test from 'node:test';
import assert from 'node:assert/strict';
import {compileKintetsuTrips,compileKintetsuBoards,tasksFor,boardURL} from '../worker/manual-rail-feed.js';

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

const board=(stop,index,direction,entries)=>({stop,index,direction,effective:'2026年3月14日現在',entries});
const entry=(tripId,depart,category='local',destination='橿')=>({tripId,depart,category,destination});

test('各駅発車表の同じtxを結合して1本の列車にする',()=>{
  const boards=[
    board('B01',0,'south',[entry('t1',600)]),
    board('B02',1,'south',[entry('t1',602)]),
    board('K15',4,'south',[entry('t1',607)]),
    board('B07',6,'south',[entry('t1',611)]),
    board('B24',23,'south',[entry('t1',636)]),
    board('B26',25,'south',[entry('t1',642)])
  ];
  const feed=compileKintetsuBoards(boards,{date:'2026-10-13',revision:'2026-03-14',checkedAt:'2026-10-10T12:00:00Z'}),service=feed.services[0];
  assert.equal(feed.meta.method,'official-board-tx-join');assert.equal(feed.meta.boardCount,6);assert.equal(feed.meta.tripCount,1);
  assert.deepEqual(service.stops,['B01','B02','K15','B07','B24','B26']);assert.deepEqual(service.trips[0].departures,[600,602,607,611,636,642]);
});

test('終着駅に発車表がない短距離便だけ、同種別の駅間中央値で終着時刻を補う',()=>{
  const boards=[
    board('B14',13,'south',[entry('through',600,'local','橿'),entry('short',620,'local','新田辺')]),
    board('B15',14,'south',[entry('through',602,'local','橿'),entry('short',622,'local','新田辺')]),
    board('B16',15,'south',[entry('through',604,'local','橿')])
  ];
  const feed=compileKintetsuBoards(boards,{date:'2026-10-13'}),short=feed.services.flatMap(s=>s.trips.map(t=>({service:s,trip:t}))).find(x=>x.trip.id==='short');
  assert.ok(short);assert.equal(short.service.stops.at(-1),'B16');assert.equal(short.trip.arrivals.at(-1),624);assert.equal(feed.meta.terminalDerived,1);
});

test('同じ便IDでも上下方向は混ぜない',()=>{
  const boards=[board('B07',6,'south',[entry('same',700)]),board('B08',7,'south',[entry('same',702)]),board('B08',7,'north',[entry('same',800,'express','京都')]),board('B07',6,'north',[entry('same',803,'express','京都')])];
  const feed=compileKintetsuBoards(boards,{date:'2026-10-13'});assert.equal(feed.services.length,2);assert.equal(feed.meta.tripCount,2);
});

test('終端駅の先へ向かう発車表を取得対象にしない',()=>{
  const south=tasksFor('south'),north=tasksFor('north');
  assert.equal(south.length,25);assert.equal(north.length,25);
  assert.equal(south[0].stop,'B01');assert.equal(south.at(-1).stop,'B25');
  assert.equal(north[0].stop,'B02');assert.equal(north.at(-1).stop,'B26');
  assert.equal(boardURL(25,'south','weekday'),null);assert.equal(boardURL(0,'north','weekday'),null);
});
