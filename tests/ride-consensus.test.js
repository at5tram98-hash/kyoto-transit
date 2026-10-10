import test from 'node:test';
import assert from 'node:assert/strict';
import {createNetwork} from '../public/js/network.js';
import {matchMeasuredVehicles,createRideConsensus,gpsAccuracyWeight} from '../public/js/riding.js';
import catalog from '../public/data/bus-catalog.json' with {type:'json'};

const network=createNetwork(catalog),now=Date.parse('2026-10-10T13:30:00Z');
const ride={kind:'ride',operator:'kyotobus',route:'40',label:'京都バス40系統',destination:'京都産業大学前',from:'kyotobus-kokusai',to:'ksu',depart:1340,arrive:1355,officialStops:[{id:'kyotobus-kokusai',time:1340},{id:'ksu',time:1355}]};
const sample=(accuracy=10,timestamp=now)=>({lat:35.0582,lng:135.7912,accuracy,timestamp,speed:8,heading:350});
const vehicle={id:'v1',trip:'trip-40',route:'40',lat:35.05825,lon:135.79125,bearing:352,speed:8.5,timestamp:Math.floor(now/1000),stop:'91_1',delay:1};

test('京都バス実測車両は位置・速度・方位・停留所を別々に採点する',()=>{
  const rows=matchMeasuredVehicles(ride,[vehicle],{network,samples:[sample(10,now-15000),sample(10,now)],now});
  assert.equal(rows.length,1);assert.equal(rows[0].vehicle.id,'v1');assert.ok(rows[0].score>=70);assert.ok(rows[0].evidence.some(e=>e.reason==='端末と車両の位置'));assert.ok(rows[0].evidence.some(e=>e.reason==='進行方向'));assert.ok(rows[0].evidence.some(e=>e.reason==='予定停留所と車両位置が一致'));
});

test('GPS精度が悪い時は車両との位置一致の重みだけを下げる',()=>{
  const good=matchMeasuredVehicles(ride,[vehicle],{network,samples:[sample(10)],now})[0],poor=matchMeasuredVehicles(ride,[vehicle],{network,samples:[sample(95)],now})[0];
  assert.ok(gpsAccuracyWeight(10)>gpsAccuracyWeight(95));assert.ok(good.score>poor.score);
});

test('90秒を超えた実測車両と別系統は候補にしない',()=>{
  assert.equal(matchMeasuredVehicles(ride,[{...vehicle,timestamp:Math.floor((now-91000)/1000)}],{network,samples:[sample()],now}).length,0);
  assert.equal(matchMeasuredVehicles(ride,[{...vehicle,route:'特40'}],{network,samples:[sample()],now}).length,0);
});

test('同じ便が異なるGPS更新で3回連続1位になった時だけ自動確定する',()=>{
  const consensus=createRideConsensus({required:3,minScore:55,minMargin:8}),candidate={ride,score:82};
  let r=consensus.update([candidate],1000);assert.equal(r.confirmed,null);assert.equal(r.count,1);
  r=consensus.update([candidate],1000);assert.equal(r.confirmed,null);assert.equal(r.count,1);
  r=consensus.update([candidate],2000);assert.equal(r.confirmed,null);assert.equal(r.count,2);
  r=consensus.update([candidate],3000);assert.equal(r.confirmed,ride);assert.equal(r.count,3);
});

test('1位が入れ替わると連続回数をリセットする',()=>{
  const other={...ride,route:'特40',label:'京都バス特40',depart:1342},consensus=createRideConsensus({required:3});
  assert.equal(consensus.update([{ride,score:80}],1000).count,1);
  assert.equal(consensus.update([{ride:other,score:80}],2000).count,1);
  assert.equal(consensus.update([{ride:other,score:80}],3000).count,2);
});

test('上位2便の差が小さい時は2〜3候補を返して自動確定しない',()=>{
  const other={...ride,route:'特40',label:'京都バス特40',depart:1342},consensus=createRideConsensus({required:3,minScore:55,minMargin:8}),r=consensus.update([{ride,score:74},{ride:other,score:69}],1000);
  assert.equal(r.confirmed,null);assert.equal(r.ambiguous,true);assert.equal(r.candidates.length,2);assert.equal(r.count,0);
});
