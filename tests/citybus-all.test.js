import test from 'node:test';
import assert from 'node:assert/strict';
import {parseApproachAll} from '../worker/bus.js';
import {approachAllURL,fetchAllSelectedApproach} from '../worker/citybus-all.js';

const choices=[
  {route:'204',destination:'銀閣寺・高野',boarding:'Aのりば',value:'204010003;10381:28723:23'},
  {route:'204',destination:'円町・金閣寺',boarding:'Bのりば',value:'204020004;9980:28724:24,9990:28724:30'}
];
const html=`<table id="approach_table"><tbody>
<tr><td><img alt="204"></td><td>銀閣寺・高野</td></tr>
<tr><td id="vehicle-position-data_1"></td><td id="vehicle-position-data_2"><img alt="２つまえ 空席あり"></td><td id="vehicle-position-data_3"></td></tr>
<tr><td><img alt="204"></td><td>円町・金閣寺</td></tr>
<tr><td id="vehicle-position-data_1"><img alt="１つまえ 大変混雑しています"></td><td id="vehicle-position-data_2"></td><td id="vehicle-position-data_3"></td></tr>
</tbody></table>`;

test('全選択URLは方面を1ページへまとめる',()=>{
  const u=new URL(approachAllURL('丸太町智恵光院',choices));
  assert.equal(u.searchParams.get('routeKeynum'),'2');
  assert.equal(u.searchParams.get('destinationCd'),'204010003,204020004');
  assert.equal(u.searchParams.get('routeKeys'),'10381,9980,9990');
  assert.equal(u.searchParams.get('fromSignpoleStringKey'),'28723,28724,28724');
  assert.equal(u.searchParams.get('fromDisplayPassNo'),'23,24,30');
  assert.equal(u.searchParams.get('formerApproachGuidance'),'');
});

test('全選択HTMLは方面順を保ったまま公式位置と混雑度を読む',()=>{
  const rows=parseApproachAll(html,choices);
  assert.equal(rows.length,2);
  assert.equal(rows[0].destination,'銀閣寺・高野');
  assert.equal(rows[0].buses[0].stopsAway,2);
  assert.equal(rows[0].buses[0].minutes,null);
  assert.equal(rows[0].buses[0].congestion,'空席あり');
  assert.equal(rows[1].buses[0].stopsAway,1);
  assert.match(rows[1].buses[0].congestion,/混雑/);
});

test('全選択取得は1リクエストで全方面を返す',async()=>{
  let calls=0;
  const fetcher=async()=>{calls++;return new Response(html,{status:200,headers:{'content-type':'text/html'}});};
  const result=await fetchAllSelectedApproach('丸太町智恵光院',choices,{fetcher,timeout:1000});
  assert.equal(calls,1);
  assert.equal(result.results.length,2);
  assert.equal(result.results[0].boarding,'Aのりば');
  assert.equal(result.results[1].buses[0].stopsAway,1);
});

test('方面数のDOM変更は静かに誤対応せず失敗する',()=>{
  assert.throws(()=>parseApproachAll(html,[choices[0]]),/方面数が一致/);
});
