import test from 'node:test';
import assert from 'node:assert/strict';
import {createRefreshLoop} from '../public/js/refresh.js';

test('非表示・処理中は更新せず、再表示時にも1分の間隔を守る',async()=>{
  let clock=0,visible=true,ready=true,calls=0;
  const loop=createRefreshLoop({now:()=>clock,canRefresh:()=>visible&&ready,refresh:async()=>{calls++;},schedule:()=>1,cancel:()=>{}});
  loop.setEnabled(true);clock=59999;await loop.tick();assert.equal(calls,0);
  clock=60000;visible=false;await loop.tick();assert.equal(calls,0);
  visible=true;ready=false;await loop.tick();assert.equal(calls,0);
  ready=true;await loop.tick();assert.equal(calls,1);
  await loop.tick();assert.equal(calls,1);
  clock=119999;await loop.tick();assert.equal(calls,1);
  clock=120000;await loop.tick();assert.equal(calls,2);
});
test('遅い取得と次の更新を重ねず、失敗後に連続再試行しない',async()=>{
  let clock=0,calls=0,finish;
  const loop=createRefreshLoop({now:()=>clock,canRefresh:()=>true,schedule:()=>1,cancel:()=>{},refresh:()=>{calls++;return new Promise((resolve,reject)=>{finish=reject;});}});
  loop.setEnabled(true);clock=60000;const first=loop.tick();clock=120000;await loop.tick();assert.equal(calls,1);
  finish(Error('取得失敗'));await first;clock=120001;const second=loop.tick();assert.equal(calls,2);finish(Error('取得失敗'));await second;
  await loop.tick();assert.equal(calls,2);
});
test('手動更新は次の自動更新を延期し、停止はタイマーを解除する',async()=>{
  let clock=0,calls=0,cancelled=0,scheduled=0;
  const loop=createRefreshLoop({now:()=>clock,canRefresh:()=>true,refresh:async()=>{calls++;},schedule:()=>++scheduled,cancel:()=>cancelled++});
  loop.setEnabled(true);loop.setEnabled(true);assert.equal(scheduled,1);
  clock=30000;loop.touch();clock=60000;await loop.tick();assert.equal(calls,0);
  clock=90000;await loop.tick();assert.equal(calls,1);
  loop.setEnabled(false);assert.equal(cancelled,1);clock=150000;await loop.tick();assert.equal(calls,1);
  loop.setEnabled(true);assert.equal(scheduled,2);loop.dispose();assert.equal(cancelled,2);
});
