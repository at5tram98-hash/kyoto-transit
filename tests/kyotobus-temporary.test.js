import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../public/data/bus-catalog.json' with {type:'json'};
import {createNetwork} from '../public/js/network.js';
import {kyotoDayKey,officialFetcher} from '../worker/timetables.js';
import {offsetTrips} from '../worker/official-static-fallback.js';

const network=createNetwork(catalog);

test('京都バス臨時は川端丸太町〜嵯峨瀬戸川町の公式停留所順をすべて持つ',()=>{
  const down=network.services.find(s=>s.id==='kyotobus-marutamachi-temp-down'),up=network.services.find(s=>s.id==='kyotobus-marutamachi-temp-up');
  const names=down.stops.map(id=>network.stops.get(id).name);
  assert.equal(names[0],'川端丸太町');
  assert.equal(names.at(-1),'嵯峨瀬戸川町');
  for(const name of ['烏丸丸太町','文化庁前・府庁前','千本丸太町','西ノ京円町','花園駅前','嵯峨嵐山駅前'])assert.ok(names.includes(name),name);
  assert.equal(down.stops.length,26);
  assert.deepEqual(up.stops,[...down.stops].reverse());
  assert.ok(down.stops.every(id=>network.stops.get(id).officialId),'各停留所に公式停留所IDがあり時刻表を開ける');
  assert.ok(down.offsets.every((v,i)=>!i||v>down.offsets[i-1]),'所要分は単調増加');
});

test('臨時の時刻表はweekday、40系統は大学カレンダーの曜日キーで引く',()=>{
  const temporary={weekday:[],saturday:[],sunday:[]},route40={weekday_a:[],weekday_b:[],weekday_wa:[],saturday:[],sunday:[]};
  assert.equal(kyotoDayKey(temporary,'weekday_a'),'weekday','40系統の暦でも臨時は平日ダイヤ');
  assert.equal(kyotoDayKey(temporary,'wednesday_a'),'weekday');
  assert.equal(kyotoDayKey(route40,'weekday_a'),'weekday_a');
  assert.equal(kyotoDayKey(route40,'wednesday_a'),'weekday_wa','平日A水曜は公式の水曜Aダイヤ');
  assert.equal(kyotoDayKey(route40,'weekday'),null,'40系統の平日は種類の選択が必要');
  assert.equal(kyotoDayKey(temporary,'holiday'),'sunday');
  assert.equal(kyotoDayKey(temporary,'saturday'),'saturday');
});

test('公式時刻表の発車時刻は、その乗り場の停留所を基準に前後の停留所へ補完する',()=>{
  const service={id:'x',stops:['a','b','c','d'],offsets:[0,3,5,9]};
  const [trip]=offsetTrips([{depart:600,destination:'d'}],service,'2026-10-22',2);
  assert.deepEqual(trip.departures,[595,598,600,604]);
});

test('公式ページが取得できない時は保存済みの公式ページを返し、無い時は失敗を伝える',async()=>{
  const store=new Map();
  const env={LIVE_KV:{get:async k=>store.get(k)??null,put:async(k,v)=>store.set(k,v)},BROWSER:{quickAction:async()=>new Response('limited',{status:429})}};
  const page='<script>const SCHEDULE_BOOT = {"master_current":{"stop_id":"1"}};</script>';
  const url='https://www.kyotobus.jp/route/timetable/schedule.html?stop_id=51_2';
  let online=true;
  const direct=async()=>online?new Response(page,{status:200}):new Response('down',{status:503});
  const fetcher=officialFetcher(env,{direct});
  assert.equal(await (await fetcher(url)).text(),page);
  online=false;
  const saved=await fetcher(url);
  assert.equal(await saved.text(),page);
  assert.ok(saved.headers.get('X-Official-Captured-At'));
  store.clear();
  await assert.rejects(fetcher(url),/HTTP 429/);
});
