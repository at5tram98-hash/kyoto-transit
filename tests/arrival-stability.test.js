import test from 'node:test';
import assert from 'node:assert/strict';
import {busDirectionLabel,busServiceLabel,groupCityBusRows,busArrivalText,shouldShowKintetsuArrival,relevantMissingOperators} from '../public/js/arrival-stability.js';

test('204は方面ごとに明確な系統名へ分ける',()=>{
  assert.equal(busDirectionLabel('204','銀閣寺・高野'),'高野・銀閣寺方面');
  assert.equal(busDirectionLabel('204','円町・金閣寺'),'金閣寺方面');
  assert.equal(busServiceLabel({route:'204',dest:'銀閣寺・高野'}),'204（高野・銀閣寺方面）');
});

test('同じ系統・方面の複数接近車は1行へまとめる',()=>{
  const rows=groupCityBusRows([
    {key:'a:0',route:'204',dest:'銀閣寺・高野',minutes:3,source:'live',confidence:.96},
    {key:'a:1',route:'204',dest:'銀閣寺・高野',minutes:11,source:'live',confidence:.96},
    {key:'b:0',route:'204',dest:'円町・金閣寺',minutes:6,source:'live',confidence:.96}
  ]),ginkaku=rows.find(r=>r.dest==='銀閣寺・高野');
  assert.equal(rows.length,2);assert.equal(ginkaku.arrivals.length,2);assert.equal(busArrivalText(ginkaku),'あと3・11分');
});

test('実測停留所位置から算出したETAは表示上liveとして扱う',()=>{
  const [row]=groupCityBusRows([{key:'x',route:'10',dest:'四条河原町',minutes:4,source:'prediction',confidence:.62}]);
  assert.equal(row.source,'live');
});

test('近鉄接近情報は近鉄線付近または乗車中だけ表示する',()=>{
  assert.equal(shouldShowKintetsuArrival({locationStatus:'bus',kintetsuMeters:120}),false);
  assert.equal(shouldShowKintetsuArrival({locationStatus:'rail',kintetsuMeters:900}),false);
  assert.equal(shouldShowKintetsuArrival({locationStatus:'rail',kintetsuMeters:220}),true);
  assert.equal(shouldShowKintetsuArrival({locationStatus:'outside',rideOperator:'through',kintetsuMeters:5000}),true);
});

test('経路で使わない事業者の未準備警告は出さない',()=>{
  const missing=[{operator:'citybus'},{operator:'kyotobus'}],planned=[{legs:[{kind:'ride',operator:'subway'}]}];
  assert.deepEqual(relevantMissingOperators(missing,planned,'subway','subway','K07','K01'),[]);
  assert.deepEqual(relevantMissingOperators([{operator:'kyotobus'}],[], 'subway','kyotobus','K01','ksu').map(x=>x.operator),['kyotobus']);
});
