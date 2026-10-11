import test from 'node:test';
import assert from 'node:assert/strict';
import {busDirectionLabel,busServiceLabel,groupCityBusRows,busArrivalText,busCongestionText,normalizeCongestion,shouldShowKintetsuArrival,relevantMissingOperators} from '../public/js/arrival-stability.js';

test('204は方面ごとに明確な系統名へ分ける',()=>{
  assert.equal(busDirectionLabel('204','銀閣寺・高野'),'高野・銀閣寺方面');
  assert.equal(busDirectionLabel('204','円町・金閣寺'),'金閣寺方面');
  assert.equal(busServiceLabel({route:'204',dest:'銀閣寺・高野',boarding:'Aのりば'}),'204（高野・銀閣寺方面） Aのりば');
});

test('同じ系統・方面・のりばの複数接近車は1行へまとめる',()=>{
  const rows=groupCityBusRows([
    {key:'a:0',route:'204',dest:'銀閣寺・高野',boarding:'Aのりば',minutes:3,source:'live',congestion:'空席あり'},
    {key:'a:1',route:'204',dest:'銀閣寺・高野',boarding:'Aのりば',minutes:11,source:'live',congestion:'混雑'},
    {key:'b:0',route:'204',dest:'円町・金閣寺',boarding:'Bのりば',stopsAway:2,source:'live',congestion:'ゆったり立てる'}
  ]),ginkaku=rows.find(r=>r.dest==='銀閣寺・高野'),kinkaku=rows.find(r=>r.dest==='円町・金閣寺');
  assert.equal(rows.length,2);assert.equal(ginkaku.arrivals.length,2);assert.equal(busArrivalText(ginkaku),'あと3分・あと11分');
  assert.equal(busArrivalText(kinkaku),'2停留所前');assert.equal(busCongestionText(kinkaku),'ゆったり立てる');
});

test('停留所数しかない実測から架空の分数へ変換しない',()=>{
  const [row]=groupCityBusRows([{key:'x',route:'10',dest:'四条河原町',stopsAway:4,minutes:null,source:'live',confidence:.72}]);
  assert.equal(row.source,'live');assert.equal(busArrivalText(row),'4停留所前');
});

test('公式混雑度の表現を正規化する',()=>{
  assert.equal(normalizeCongestion('大変混雑しています'),'大変混雑');
  assert.equal(normalizeCongestion('ゆったり立てます'),'ゆったり立てる');
  assert.equal(normalizeCongestion('空席があります'),'空席あり');
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
