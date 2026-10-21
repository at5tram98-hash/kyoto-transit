import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseKyotoBusNav,kyotoBusNavURL,fetchKyotoBusNav} from '../worker/kyotobus-nav.js';

const live=readFileSync(new URL('./fixtures/kyotobus-nav-40.html',import.meta.url),'utf8');
const none=readFileSync(new URL('./fixtures/kyotobus-nav-none.html',import.meta.url),'utf8');

test('京都バスナビの区間一覧から公式の予定・予測時刻と通過停留所数を読む',()=>{
  const {buses,message}=parseKyotoBusNav(live);
  assert.equal(message,null);
  assert.equal(buses.length,1);
  const [bus]=buses;
  assert.equal(bus.route,'40');
  assert.equal(bus.destination,'国際会館駅前');
  assert.deepEqual(bus.departure,{stop:'京都産業大学前',scheduled:22*60+1,predicted:22*60+1});
  assert.deepEqual(bus.arrival,{stop:'国際会館駅前',scheduled:22*60+11,predicted:22*60+13});
  assert.equal(bus.minutesToDeparture,3);
  assert.equal(bus.stopsAway,2);
  assert.equal(bus.platform,'ターミナル(40)');
  assert.equal(bus.congestion,'通常の状態です');
});

test('接近便がない時は公式メッセージを返し、便を作らない',()=>{
  assert.deepEqual(parseKyotoBusNav(none),{buses:[],message:'60分以内に接近しているバスはありません。'});
});

test('一覧も公式メッセージもない画面は運行なしと解釈しない',()=>{
  assert.throws(()=>parseKyotoBusNav('<html><body><div id="buslist"></div></body></html>'),/読み取れません/);
});

test('対象外の停留所では公式サイトへ問い合わせない',async()=>{
  let calls=0;const fetcher=async()=>{calls++;return new Response(live);};
  await assert.rejects(fetchKyotoBusNav('京都駅前','国際会館駅前',{fetcher}),/対象区間/);
  assert.equal(calls,0);
  const value=await fetchKyotoBusNav('京都産業大学前','国際会館駅前',{fetcher});
  assert.equal(calls,1);
  assert.equal(value.buses[0].arrival.predicted,22*60+13);
  const u=new URL(kyotoBusNavURL('京都産業大学前','国際会館駅前'));
  assert.equal(u.hostname,'kyotobus.bus-navigation.jp');
  assert.equal(u.searchParams.get('from'),'京都産業大学前');
  assert.equal(u.searchParams.get('to'),'国際会館駅前');
});
