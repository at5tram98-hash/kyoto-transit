import test from 'node:test';
import assert from 'node:assert/strict';
import {matchBoard,anchorTrips,stopBoards} from '../worker/citybus-boards.js';
import {offsetTrips} from '../worker/official-static-fallback.js';

test('停留所時刻表の発車時刻を便の順に許容差内で対応づける',()=>{
  assert.deepEqual(matchBoard([480,490,500],[478,489,503]),[478,489,503]);
  // A board time far from every trip is not taken.
  assert.deepEqual(matchBoard([480,490],[481,520]),[481,null]);
  // The next trip keeps the board time that is closer to it.
  assert.deepEqual(matchBoard([480,486],[482,486]),[482,486]);
  // Never earlier than the time the bus left the previous stop.
  assert.deepEqual(matchBoard([480],[477],7,[479]),[null]);
});

test('途中停留所は公式時刻表の時刻に置き換え、間の停留所だけ区間所要で配分する',()=>{
  const service={id:'bus-1-down',offsets:[0,2,4,6,8],stops:['a','b','c','d','e']};
  const trips=offsetTrips([{depart:480},{depart:500},{depart:520}],service,'2026-10-24');
  const boards={c:{weekday:[487,506,527]},d:{weekday:[]}};
  const read=anchorTrips(trips,service,k=>boards[service.stops[k]]?[boards[service.stops[k]]]:[],'weekday');
  assert.deepEqual(read,[0,2]);
  assert.deepEqual(trips[0].departures,[480,484,487,489,491]);
  assert.deepEqual(trips[1].departures,[500,503,506,508,510]);
  assert.deepEqual(trips[1].arrivals,trips[1].departures);
});

test('合わない時刻表しかない停留所は推定のまま残す',()=>{
  const service={id:'bus-1-down',offsets:[0,2,4],stops:['a','b','c']};
  const trips=offsetTrips([{depart:480},{depart:500}],service,'2026-10-24');
  const read=anchorTrips(trips,service,()=>[{weekday:[600,700]}],'weekday');
  assert.deepEqual(read,[0]);
  assert.deepEqual(trips[0].departures,[480,482,484]);
});

test('停留所の時刻表は先の停留所を行先に含む方面だけを使う',()=>{
  const names={a:'九条車庫前',b:'京都駅前',c:'四条河原町'};
  const service={stops:['a','b','c']};
  const rows=[{name:'京都駅前',boards:[{label:'九条車庫行き',sourceURL:'x'},{label:'四条河原町・北大路バスターミナル行き',sourceURL:'y'}]}];
  const record={boards:{x:{days:{weekday:[1]}},y:{days:{weekday:[2]}}}};
  assert.deepEqual(stopBoards(service,rows,record,id=>names[id])(1),[{weekday:[2]}]);
});

test('停留所時刻表は1回の実行で1系統だけ取得・保存し、揃ったら当日の系統データを作り直す',async()=>{
  const {fillCityBusBoards,readRouteBoards}=await import('../worker/citybus-boards.js');
  const store=new Map(),deleted=[];
  const env={LIVE_KV:{get:async k=>store.get(k)??null,put:async(k,v)=>{store.set(k,v);},delete:async k=>{deleted.push(k);}}};
  const catalogPage='<div class="panel"><h2 id="bs1">甲</h2><a href="../hyperdia/1.htm">乙行き</a><a href="../hyperdia/2.htm">丙行き</a></div>';
  const board='<div id="wek"><span data-tt-time="0805"><span class="data-tt-dest">乙</span></span></div>';
  const fetcher=async url=>new Response(String(url).includes('hyperdia')?board:catalogPage,{headers:{'content-type':'text/html;charset=utf-8'}});
  const result=await fillCityBusBoards(env,fetcher,{routes:['205','10'],budget:10,now:Date.parse('2026-10-24T03:00:00Z')});
  assert.equal(result.routes.length,1);
  assert.deepEqual(result.routes[0].stored,2);
  const record=await readRouteBoards(env,result.routes[0].route);
  assert.deepEqual(Object.values(record.boards)[0].days.weekday,[485]);
  assert.ok(deleted.includes(`static:fallback:citybus-route:${result.routes[0].route}:2026-10-24`));
});
