import test from 'node:test';
import assert from 'node:assert/strict';
import {applyRideMotionEvidence,createRideConsensus} from '../public/js/riding.js';
import {summarizeVehicleMotion} from '../public/js/motion-assist.js';

const now=1_800_000;
const ride={kind:'ride',operator:'citybus',route:'北3',from:'a',to:'b',depart:900,arrive:930,label:'北3',destination:'北大路'};
const samples=[-20000,-10000,0].map((offset,index)=>({lat:35.05+index*.00045,lng:135.75,accuracy:10,timestamp:now+offset,speed:5,heading:0}));
const sensor=[.05,.32,.08,.41,.12,.36,.07,.3].map((magnitude,index)=>({at:now-(7-index)*900,magnitude}));
const evidence=summarizeVehicleMotion(sensor,samples,now);
const candidate=(score=62,extra={})=>({ride,score,source:'停留所列＋現在地',evidence:[{reason:'路線の軌跡',points:25}],...extra});
const apply=(rows,summary=evidence,options={})=>applyRideMotionEvidence(rows,summary,{samples,now,...options});

test('20秒以上の移動にだけ最大6点の補助証拠を加え、元の根拠を保持する',()=>{
  const original=candidate(),[result]=apply([original],{...evidence,score:100});
  assert.equal(result.score,68);
  assert.equal(result.confirmationScore,62);
  assert.equal(result.evidence.at(-1).points,6);
  assert.equal(result.evidence[0],original.evidence[0]);
  assert.equal(original.score,62);
  assert.deepEqual(apply([result]),[result]);
});

test('歩行・停止・短時間・位置消失・低精度では加速度で候補を強めない',()=>{
  for(const trace of [[],samples.map(p=>({...p,speed:0,lat:35.05})),samples.map(p=>({...p,speed:1,lat:35.05})),samples.slice(1),samples.map(p=>({...p,accuracy:150}))]){
    const original=[candidate()];
    assert.equal(apply(original,evidence,{samples:trace}),original);
  }
});

test('古いGPSや古い加速度の要約を再利用しない',()=>{
  const original=[candidate()];
  assert.equal(apply(original,evidence,{now:now+16000}),original);
  assert.equal(apply(original,{...evidence,observedAt:now-16000}),original);
  assert.equal(apply(original,{...evidence,observedAt:now+5000}),original);
  assert.equal(apply(original,{...evidence,score:NaN}),original);
});

test('弱い候補と逆方向の根拠を加速度で押し上げない',()=>{
  const weak=candidate(54),reverse=candidate(62,{evidence:[{reason:'進行方向が逆',points:-30}]});
  const result=apply([weak,reverse]);
  assert.equal(result[0],weak);
  assert.equal(result[1],reverse);
  const consensus=createRideConsensus();
  for(const stamp of [1000,2000,3000])assert.equal(consensus.update([result[0]],stamp).confirmed,null);
});

test('加速度の点数だけでは自動確定の閾値を越えない',()=>{
  const [boosted]=apply([candidate(56)],{...evidence,score:6});
  assert.equal(boosted.score,62);
  const consensus=createRideConsensus({minScore:60});
  for(const stamp of [1000,2000,3000])assert.equal(consensus.update([boosted],stamp).confirmed,null);
});

test('加速度で候補間の僅差を広げて自動確定しない',()=>{
  const other={...ride,depart:902},rows=apply([candidate(56),candidate(54,{ride:other})],{...evidence,score:6});
  assert.equal(rows[0].score-rows[1].score,8);
  const consensus=createRideConsensus();
  for(const stamp of [1000,2000,3000]){
    const decision=consensus.update(rows,stamp);
    assert.equal(decision.confirmed,null);
    assert.equal(decision.margin,2);
    assert.equal(decision.ambiguous,true);
  }
});

test('十分な乗車根拠はGPS3更新で確定し、加速度で同じGPSを水増ししない',()=>{
  const rows=apply([candidate(80)]),consensus=createRideConsensus();
  assert.equal(consensus.update(rows,1000).count,1);
  assert.equal(consensus.update(rows,1000).count,1);
  assert.equal(consensus.update(rows,2000).confirmed,null);
  assert.equal(consensus.update(rows,3000).confirmed,ride);
});

test('表示点数が100に達しても独立した根拠の差と順位を保つ',()=>{
  const other={...ride,depart:902},rows=apply([candidate(99),candidate(90,{ride:other})],{...evidence,score:6});
  assert.equal(rows[0].score,100);
  const consensus=createRideConsensus();
  assert.equal(consensus.update([...rows].reverse(),1000).margin,9);
  assert.equal(consensus.update(rows,2000).count,2);
  assert.equal(consensus.update(rows,3000).confirmed,ride);
});
