import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocationSession} from '../public/js/location-session.js';
function setup(loadData=async()=>({stops:[]})){
  let success,error,started=0,cleared=0;const status=[],positions=[];
  const session=createLocationSession({loadData,onStatus:s=>status.push(s),onPosition:(p,g)=>positions.push([p,g]),geolocation:{watchPosition:(ok,fail,options)=>{success=ok;error=fail;started++;assert.equal(options.enableHighAccuracy,true);return started;},clearWatch:()=>cleared++}});
  return {session,status,positions,ok:p=>success(p),fail:code=>error({code}),get started(){return started;},get cleared(){return cleared;}};
}
test('起動時に高精度GPSを開始し、同時に再開しても監視を重複しない',async()=>{
  const t=setup();await Promise.all([t.session.start(),t.session.start()]);assert.equal(t.started,1);t.ok({timestamp:1});assert.equal(t.positions.length,1);assert.equal(t.status.at(-1),'active');await t.session.start();assert.equal(t.started,1);
});
test('権限拒否では再表示で要求を繰り返さず、明示的な再取得で再開できる',async()=>{
  const t=setup();await t.session.start();t.fail(1);assert.equal(t.cleared,1);assert.equal(t.status.at(-1),'denied');await t.session.start();assert.equal(t.started,1);await t.session.start({retry:true});assert.equal(t.started,2);
});
test('地下の一時的な取得失敗でも監視を維持し、回復した位置を受け取る',async()=>{
  const t=setup();await t.session.start();t.fail(3);assert.equal(t.session.active,true);t.ok({timestamp:2});assert.equal(t.status.at(-1),'active');assert.equal(t.positions.length,1);
});
test('ページを離れた後の位置と読込結果を破棄し、戻ると監視を再開する',async()=>{
  let resolve;const t=setup(()=>new Promise(r=>{resolve=r;}));const pending=t.session.start();t.session.stop();resolve({stops:[]});await pending;assert.equal(t.started,0);await t.session.start();assert.equal(t.started,1);t.session.stop();t.ok({timestamp:3});assert.equal(t.positions.length,0);
});
test('位置情報APIがない端末は手動案内を選べる状態で終える',async()=>{
  const status=[];await createLocationSession({geolocation:null,loadData:async()=>{},onStatus:s=>status.push(s),onPosition:()=>{}}).start();assert.deepEqual(status,['unsupported']);
});
