import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJourneys,searchJourney,boundedText,validateJourneyRequest,matchesConditions} from '../worker/journeys.js';
import {parseApproach} from '../worker/bus.js';
import {journeyFare,journeyHTML,busHTML} from '../public/js/journey.js';
import {createNetwork} from '../public/js/network.js';
import {DEFAULT_PASSES} from '../public/js/fares.js';
import catalog from '../public/data/bus-catalog.json' with {type:'json'};
const network=createNetwork(catalog),req={from:'K07',to:'K01',via:[],date:'2026-10-10',start:540,trainType:'all',buffer:3,maxWalk:30};
const station=(name,time)=>`<div class="station"><ul class="time"><li>${time}</li></ul><dl><dt>${name}</dt></dl></div>`;
const page=({from='丸太町(京都市営)',to='国際会館',depart='09:03',arrive='09:15',line='京都市営烏丸線',fare=260,transfers=0}={})=>`<div id="route01"><div class="routeSummary"><li class="transfer">乗換：${transfers}回</li><li class="fare">IC優先：${fare}円</li></div><div class="routeDetail">${station(from,depart)}<div class="fareSection"><div class="access"><ul class="info"><li class="transport"><div>${line}<span class="destination">国際会館行</span></div></li><li class="platform">[発] 2番線 → [着] 1番線</li></ul></div><p class="fare">${fare}円</p></div>${station(to,arrive)}</div></div>`;
test('実結果HTMLから時刻・番線・通常運賃を取り出す',()=>{const [p]=parseJourneys(page(),req);assert.equal(p.start,543);assert.equal(p.time,555);assert.equal(p.normal,260);assert.equal(p.transfers,0);assert.equal(p.legs[0].platform,'[発] 2番線 → [着] 1番線');});
test('検索結果の通常運賃を維持して定期区間は0円',()=>{const [p]=parseJourneys(page(),req);assert.deepEqual(journeyFare(p,network,DEFAULT_PASSES,req.date).additional,0);assert.equal(journeyFare(p,network,{...DEFAULT_PASSES,subway:false},req.date).additional,260);});
test('対象外路線を実経路として採用しない',()=>assert.equal(parseJourneys(page({line:'ＪＲ奈良線'}),req).length,0));
test('会社名付きの京都バス停と全角40系統を認識',()=>{const [p]=parseJourneys(page({from:'国際会館駅前/京都バス',to:'京都産業大学前/京都バス',line:'京都バス・４０(京都産業大学前−国際会館駅前)',fare:230}),req);assert.equal(p.legs[0].from,'kyotobus-kokusai');assert.equal(p.legs[0].to,'ksu');assert.equal(journeyFare(p,network,DEFAULT_PASSES,req.date).additional,0);});
test('時刻・運賃がない結果に架空データを補わない',()=>{assert.equal(parseJourneys(page({depart:'情報なし'}),req).length,0);assert.equal(parseJourneys(page().replace('IC優先：260円','情報なし'),req).length,0);});
test('0時を越える到着は翌日として扱う',()=>{const [p]=parseJourneys(page({depart:'23:55',arrive:'00:08'}),{...req,start:1430});assert.equal(p.start,1435);assert.equal(p.time,1448);});
test('折り返し後は実到着と待ち時間から次の検索を自動生成',async()=>{
  const urls=[];const r=await searchJourney({...req,from:'K07',to:'K07',via:[{stop:'K01',dwell:10,exitGate:false}]},async url=>{urls.push(new URL(url));return new Response(urls.length===1?page():page({from:'国際会館',to:'丸太町(京都市営)',depart:'09:25',arrive:'09:38'}));});
  assert.equal(urls.length,2);assert.equal(urls[1].searchParams.get('hh'),'9');assert.equal(urls[1].searchParams.get('m1'),'2');assert.equal(urls[1].searchParams.get('m2'),'5');assert.equal(r.routes[0].normal,520);assert.equal(r.routes[0].legs[1].minutes,10);assert.equal(r.routes[0].transfers,1);
});
test('厳密な列車種別・乗換余裕・徒歩上限で取得候補を絞る',()=>{
  const p={walk:4,legs:[{kind:'ride',operator:'subway',arrive:550},{kind:'ride',operator:'kintetsu',category:'express',depart:551}]};assert.equal(matchesConditions(p,req),false);p.legs[1].through=true;assert.equal(matchesConditions(p,req),true);assert.equal(matchesConditions(p,{...req,trainType:'local'}),false);
});
test('不正な地点・滞在・日付・条件をサーバーで拒否',()=>{for(const bad of [{from:'https://example.com'},{date:'2026-02-31'},{via:[{stop:'K01',dwell:181,exitGate:false}]},{buffer:0}])assert.throws(()=>validateJourneyRequest({...req,...bad}));});
test('同名の地下鉄京都駅を近鉄京都駅の結果として採用しない',async()=>{const r=await searchJourney({...req,from:'B01'},async()=>new Response(page({from:'京都',fare:290})));assert.equal(r.routes.length,0);});
test('徒歩後の乗換余裕も確保するが、初乗車までの徒歩は乗換ではない',()=>{assert.equal(matchesConditions({walk:4,legs:[{kind:'ride',arrive:544},{kind:'walk',arrive:550},{kind:'ride',operator:'subway',depart:551}]},req),false);assert.equal(matchesConditions({walk:4,legs:[{kind:'walk',arrive:550},{kind:'ride',operator:'subway',depart:550}]},req),true);});
test('翌日の区間には期限切れの定期を適用しない',()=>{const p=parseJourneys(page({depart:'00:03',arrive:'00:15'}),{...req,start:1439})[0];assert.equal(journeyFare(p,network,{...DEFAULT_PASSES,expires:req.date},req.date).additional,260);});
test('上流データのサイズをストリーム中に制限',async()=>{await assert.rejects(boundedText(new Response('x'.repeat(100)),10));assert.equal(await boundedText(new Response('実データ')), '実データ');});
test('接近表の画像altを使い、凡例をバスと誤認しない',()=>{const p=parseApproach('<table id="approach_table"><td id="vehicle-position-data_1"><img alt="３つまえ 空席あり"></td></table><img alt="1つまえ 満員">');assert.deepEqual(p.buses.map(b=>[b.stopsAway,b.congestion]),[[3,'空席あり']]);});
test('接近なしは公式の明示メッセージがある場合だけ',()=>{assert.throws(()=>parseApproach('<table id="approach_table"></table>'));assert.equal(parseApproach('<table id="approach_table"></table><div class="modal in">現在、６停留所以内に接近しているバスはありません。</div>').noBus,true);});
test('アプリの独自表示は外部リンク不要、上流文字をエスケープ',()=>{
  const p=parseJourneys(page(),req)[0];p.legs[0].destination='<img src=x onerror=alert(1)>';
  const html=journeyHTML({routes:[p],request:req,sort:'fast',openRoute:0,network,passes:DEFAULT_PASSES,updatedAt:'2026-10-10T00:00:00Z',notice:''});assert.match(html,/0円（定期）/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);assert.doesNotMatch(html,/target="_blank"/);
  const bus=busHTML({capturedAt:'2026-10-10T00:00:00Z',route:'204',stop:'丸太町',destination:'円町',boarding:'B',buses:[{stopsAway:3,congestion:'空席あり'}]});assert.match(bus,/停留所前/);assert.doesNotMatch(bus,/あと\d+分/);
});
