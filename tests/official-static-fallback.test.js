import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseCityBoard,offsetTrips,groupCityServices} from '../worker/official-static-fallback.js';

test('市バスfallbackは次停留所を含む方面を優先する',()=>{
  const boards=[{label:'銀閣寺・高野方面',sourceURL:'a'},{label:'円町・金閣寺方面',sourceURL:'b'}];
  assert.equal(chooseCityBoard(boards,'円町',false).sourceURL,'b');
});

test('公式発車時刻を基準にサービス全停留所へ時刻を展開する',()=>{
  const service={id:'bus-204-down',offsets:[0,2,5],stops:['a','b','c']};
  const trips=offsetTrips([{depart:480,destination:'銀閣寺'}],service,'2026-10-11');
  assert.deepEqual(trips[0].departures,[480,482,485]);
  assert.deepEqual(trips[0].arrivals,[480,482,485]);
  assert.equal(trips[0].date,'2026-10-11');
});

test('市バスfallbackは系統単位にまとめて上下方向を同じ取得結果から構築する',()=>{
  const grouped=groupCityServices([
    {id:'bus-10-down',route:'10'},{id:'bus-10-up',route:'10'},
    {id:'bus-204-down',route:'204'},{id:'bus-204-up',route:'204'},
    {id:'bus-202-eight-down',route:'202'},{id:'bus-202-eight-up',route:'202'}
  ]);
  assert.deepEqual(grouped.map(x=>x.route),['10','204','202']);
  assert.deepEqual(grouped.find(x=>x.route==='10').services.map(x=>x.id),['bus-10-down','bus-10-up']);
  assert.deepEqual(grouped.find(x=>x.route==='202').services.map(x=>x.id),['bus-202-eight-down','bus-202-eight-up']);
});
