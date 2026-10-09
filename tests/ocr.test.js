import test from 'node:test';
import assert from 'node:assert/strict';
import {freshness,summarizeOCR} from '../public/js/ocr.js';
import {approachURL,selectionURL,parseBusChoices} from '../worker/index.js';
test('取得時刻不明・過去の画像は新しい接近情報と扱わない',()=>{
 const now=Date.parse('2026-10-09T02:30:00Z');assert.equal(freshness(null,now),'取得時刻不明');assert.equal(freshness('bad',now),'取得時刻不明');assert.equal(freshness('2026-10-09T02:29:00Z',now),'取得から2分以内');assert.equal(freshness('2026-10-09T02:20:00Z',now),'保存情報・10分前');assert.equal(freshness('2026-10-10T02:30:00Z',now),'取得時刻を要確認');
});
test('路線の文字がないOCRから正常運行を捏造しない',()=>{
 assert.match(summarizeOCR('路線名 状況\n読み取れない', 'rail')[0],/確認/);
 assert.deepEqual(summarizeOCR('現在は15分以上の列車の遅れはございません','rail'),['現在は15分以上の列車の遅れはございません']);
 assert.deepEqual(summarizeOCR('奈 良 線 ｜ 一 部 運 休\n京 都 線 ｜ 一 部 運 休 ｜ 奈 良 線 の 影 響','rail'),['奈良線 | 一部運休','京都線 | 一部運休 | 奈良線の影響']);
});
test('バスの全角接近表示をOCR結果から拾う',()=>{assert.deepEqual(summarizeOCR('２０４\n３つまえ 空席あり\n円町・金閣寺','bus'),['3つまえ空席あり']);});
test('ポケロケの省略されたli終端でものりばを対応させる',()=>{
 const row=(value,dest)=>`<li class="route-row-data"><input name="rowCheckDataItem" value="${value}"><p id="destinationAbbreviation_data"><font>${dest}</font></p></li>`;
 const html='<li value="1">Aのりば'+row('204010003;10153:28271:21','銀閣寺・高野')+'<li value="2">Bのりば'+row('204020004;9990:28272:27','円町・金閣寺')+row('065010003;9898:28273:28','祇園');
 const options=parseBusChoices(html);assert.equal(options.length,2);assert.equal(options[0].boarding,'Aのりば');assert.equal(options[1].boarding,'Bのりば');assert.equal(options[1].destination,'円町・金閣寺');
});
test('公式検索の系統・のりば・表示順を同じ接近URLへ渡す',()=>{
 const u=new URL(approachURL('烏丸丸太町（地下鉄丸太町駅）','204020004;9990:28272:27,10154:28272:27'));
 assert.equal(u.hostname,'kyotocity.bus-navigation.jp');assert.equal(u.searchParams.get('routeKeys'),'9990,10154');assert.equal(u.searchParams.get('fromSignpoleStringKey'),'28272,28272');assert.equal(u.searchParams.get('fromDisplayPassNo'),'27,27');assert.equal(u.searchParams.get('destinationCd'),'204020004');
 assert.throws(()=>approachURL('京都駅前','https://evil.test'));assert.throws(()=>approachURL('京都駅前','999020004;9990:28272:27'));
 assert.equal(new URL(selectionURL('京都駅前')).searchParams.get('from'),'京都駅前');
});
