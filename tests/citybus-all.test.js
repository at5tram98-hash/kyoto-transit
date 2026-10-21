import test from 'node:test';
import assert from 'node:assert/strict';
import {parseApproachAll} from '../worker/bus.js';
import {approachAllURL,batchBusChoices,fetchAllSelectedApproach} from '../worker/citybus-all.js';

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

test('全選択URLは公式の方面境界形式で1ページへまとめる',()=>{
  const u=new URL(approachAllURL('丸太町智恵光院',choices));
  assert.equal(u.searchParams.get('routeKeynum'),'2');
  assert.equal(u.searchParams.get('destinationCd'),'204010003,204020004');
  assert.equal(u.searchParams.get('routeKeys'),'10381_9980,9990');
  assert.equal(u.searchParams.get('fromSignpoleStringKey'),'28723_28724,28724');
  assert.equal(u.searchParams.get('fromDisplayPassNo'),'23_24,30');
  assert.equal(u.searchParams.get('formerApproachGuidance'),'');
});

test('公式の10方面上限を越える時だけ複数ページへ分ける',()=>{
  const many=Array.from({length:21},(_,i)=>({...choices[0],value:`20401000${i%10};${10000+i}:28723:23`}));
  assert.deepEqual(batchBusChoices(many).map(x=>x.length),[10,10,1]);
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
  assert.equal(new Set(result.results.map(x=>x.capturedAt)).size,1);
});

test('方面数のDOM変更は静かに誤対応せず失敗する',()=>{
  assert.throws(()=>parseApproachAll(html,[choices[0]]),/方面数が一致/);
});

// Shapes observed on the official site on 2026-10-21.
const officialChoices=[
  {route:'205',destination:'（快速）九条車庫',boarding:'',value:'205R20003;9993:28377:7'},
  {route:'205',destination:'九条車庫まで',boarding:'',value:'205020005;10019:28377:7'},
  {route:'78',destination:'（始発停留所）久世工業団地',boarding:'',value:'078010099;9780:28374:29'},
  {route:'46',destination:'三条京阪',boarding:'Eのりば',value:'046T10002;10772:28370:32,9870:28370:33'}
];
const officialHtml=`<table id="approach_table"><tbody>
<tr><td rowspan="2"><div><table><tbody><tr><td><img alt="かいそく205"></td></tr></tbody></table></div></td><td>（快速）九条車庫 (Rapid) Kujo Shako</td></tr>
<tr><td colspan="6">本日の運行は終了いたしました</td></tr>
<tr><td rowspan="2"><img alt="205くじょうしゃこ"></td><td>九条車庫まで Kujo Shako</td></tr>
<tr><td id="vehicle-position-data_1"><img alt="４つまえ　混雑"></td><td id="vehicle-position-data_2"><img alt="５つまえ　空席あり"></td></tr>
<tr><td rowspan="2"><img alt="78"></td><td>久世工業団地 Kuze Kogyodanchi</td></tr>
<tr><td id="vehicle-position-data_1"></td></tr>
<tr><td rowspan="2"><img alt="46"></td><td>三条京阪 Sanjo Keihan</td></tr>
<tr><td id="vehicle-position-data_1"><img alt="１つまえ　空席あり"></td></tr>
</tbody></table>`;

test('公式の運行終了行・快速系統・始発停留所・英字入り方面コードを全方面で読む',()=>{
  const rows=parseApproachAll(officialHtml,officialChoices);
  assert.equal(rows.length,4);
  assert.equal(rows[0].noBus,true);
  assert.equal(rows[0].message,'本日の運行は終了いたしました');
  assert.deepEqual(rows[1].buses.map(b=>b.stopsAway),[4,5]);
  assert.equal(rows[2].noBus,true);
  assert.equal(rows[3].buses[0].stopsAway,1);
  assert.equal(rows[3].boarding,'Eのりば');
});

test('方面の並びが公式画面と異なる場合は誤対応せず失敗する',()=>{
  assert.throws(()=>parseApproachAll(officialHtml,[officialChoices[1],officialChoices[0],...officialChoices.slice(2)]),/並び順/);
});

test('公式は正式名でしか系統を返さないため上流URLだけ正式名へ変換する',()=>{
  const u=new URL(approachAllURL('四条烏丸',[officialChoices[3]]));
  assert.equal(u.searchParams.get('from'),'四条烏丸（地下鉄四条駅）');
  assert.equal(u.searchParams.get('destinationCd'),'046T10002');
  assert.equal(new URL(approachAllURL('丸太町智恵光院',choices)).searchParams.get('from'),'丸太町智恵光院');
});

test('北3の方面コードも一括取得の対象にする',()=>{
  const u=new URL(approachAllURL('北大路バスターミナル',[{route:'北3',destination:'京都産大',value:'N03000001;1:2:3'}]));
  assert.equal(u.searchParams.get('destinationCd'),'N03000001');
});
