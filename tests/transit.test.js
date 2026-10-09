import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNetwork,searchStops,subwayIds} from '../public/js/network.js';
import {DEFAULT_PASSES,summarizeFares,kintetsuFare,subwayFare,estimateDirectFare} from '../public/js/fares.js';
import {route,planRoutes,formatTime} from '../public/js/router.js';
import {yahooURL,departureAfterDwell,validateFeed,applyFeed} from '../public/js/providers.js';
const catalog=JSON.parse(readFileSync(new URL('../public/data/bus-catalog.json',import.meta.url),'utf8'));
const network=createNetwork(catalog),date='2026-10-09';
const ride=(from,to,path,operator='subway',tripId='a')=>({kind:'ride',from,to,path,operator,serviceId:tripId,tripId});
const request=extra=>({from:'K07',to:'K01',via:[],start:600,date,buffer:3,maxWalk:30,trainType:'all',...extra});

test('地下鉄定期内では普通運賃を残して追加額0円',()=>{
  const f=summarizeFares([ride('K07','K01',subwayIds.slice(0,7).reverse())],network,DEFAULT_PASSES,date);
  assert.equal(f.normal,260);assert.equal(f.additional,0);assert.equal(f.details[0].covered,true);
});
test('京都〜国際会館の普通運賃は290円',()=>{
  const f=summarizeFares([ride('K11','K01',subwayIds.slice(0,11).reverse())],network,DEFAULT_PASSES,date);
  assert.equal(f.normal,290);assert.equal(f.additional,0);
});
test('地下鉄の定期外は運賃の差額ではなく京都境界から精算する',()=>{
  const f=summarizeFares([ride('K07','K15',subwayIds.slice(6))],network,DEFAULT_PASSES,date);
  assert.equal(f.normal,260);assert.equal(f.additional,260);
});
test('定期を越えない南端区間も追加料金が必要',()=>{
  const f=summarizeFares([ride('K12','K13',['K12','K13'])],network,DEFAULT_PASSES,date);
  assert.equal(f.normal,220);assert.equal(f.additional,220);
});
test('市バスと京都バスも定期適用後0円',()=>{
  const from=network.busIds.get('祇園'),to=network.busIds.get('清水道');
  const a=summarizeFares([ride(from,to,[from,to],'citybus')],network,DEFAULT_PASSES,date);
  const b=summarizeFares([ride('kyotobus-kokusai','ksu',['kyotobus-kokusai','ksu'],'kyotobus')],network,DEFAULT_PASSES,date);
  assert.equal(a.normal,230);assert.equal(a.additional,0);assert.equal(b.normal,230);assert.equal(b.additional,0);
});
test('近鉄は地下鉄・バスの定期を適用しない',()=>{
  const f=summarizeFares([ride('B07','B24',['B07','B24'],'kintetsu')],network,DEFAULT_PASSES,date);
  assert.equal(f.normal,530);assert.equal(f.additional,530);
});
test('同じ事業者内の列車乗換で運賃を二重計上しない',()=>{
  const f=summarizeFares([ride('B07','B12',['B07','B12'],'kintetsu','a'),ride('B12','B24',['B12','B24'],'kintetsu','b')],network,DEFAULT_PASSES,date);
  assert.equal(f.normal,530);assert.equal(f.details.length,1);
});
test('途中下車して改札を出た場合は別計算',()=>{
  const legs=[ride('B07','B12',['B07','B12'],'kintetsu','a'),{kind:'dwell',exitGate:true},ride('B12','B24',['B12','B24'],'kintetsu','b')];
  assert.equal(summarizeFares(legs,network,DEFAULT_PASSES,date).details.length,2);
});
test('折り返しで往路の運賃を落とさない',()=>{
  const f=summarizeFares([ride('B07','B24',['B07','B24'],'kintetsu','a'),{kind:'dwell',exitGate:false},ride('B24','B07',['B24','B07'],'kintetsu','b')],network,DEFAULT_PASSES,date);
  assert.equal(f.normal,1060);assert.equal(f.additional,1060);
});
test('定期期限を過ぎた検索は通常運賃',()=>{
  const p={...DEFAULT_PASSES,expires:'2026-10-08'};
  const f=summarizeFares([ride('K07','K01',subwayIds.slice(0,7).reverse())],network,p,date);
  assert.equal(f.additional,260);
});
test('定期の最終日は有効',()=>{
  const p={...DEFAULT_PASSES,expires:date};
  assert.equal(summarizeFares([ride('K07','K01',subwayIds.slice(0,7).reverse())],network,p,date).additional,0);
});
test('直通列車でも事業者境界を分ける',()=>{
  const f=summarizeFares([ride('K11','B07',['K11','K12','K13','K14','K15','B06','B07'],'through')],network,DEFAULT_PASSES,date);
  assert.equal(f.details.length,2);assert.equal(f.additional,440); // 地下鉄260＋近鉄180
});
test('近鉄運賃の営業キロ端数切り上げ',()=>{assert.equal(kintetsuFare(3),180);assert.equal(kintetsuFare(3.1),240);assert.equal(kintetsuFare(39),760);});
test('地下鉄運賃の区数境界',()=>{assert.equal(subwayFare(3),220);assert.equal(subwayFare(3.1),260);assert.equal(subwayFare(7.1),290);});
test('丹波橋の別名、バスの系統番号を検索できる',()=>{assert.ok(searchStops(network,'丹波橋').some(s=>s.id==='B07'));assert.ok(searchStops(network,'２０４').length>40);});
test('指定系統の全カタログを登録、96は捏造しない',()=>{
  for(const [route,e] of Object.entries(catalog))for(const n of e.names)assert.ok(searchStops(network,n).some(s=>s.lines.includes(route)),`${route}/${n}`);
  assert.equal(searchStops(network,'96').length,0);assert.ok(network.services.some(s=>s.label==='202系統・八条口'));
});
test('同じ駅を往復して経由地の順番・待ち時間を守る',()=>{
  const r=route(network,request({via:[{stop:'B07',dwell:3},{stop:'B24',dwell:10}]}));
  assert.ok(r);const dwell=r.legs.filter(l=>l.kind==='dwell');assert.deepEqual(dwell.map(d=>d.from),['B07','B24']);assert.equal(dwell[1].arrive-dwell[1].depart,10);
  const after=r.legs[r.legs.findIndex(l=>l===dwell[1])+1];assert.ok(after.depart>=dwell[1].arrive+3);assert.equal(r.stop,'K01');
  assert.ok(r.legs.some(l=>l.path?.includes('K07')&&l.to==='K01'));
});
test('急行だけでは通過駅で下車できない',()=>{
  const r=route(network,request({from:'B06',to:'B24',trainType:'express'}));assert.equal(r,null);
});
test('近鉄の普通だけで竹田まで検索できる',()=>{
  const r=route(network,request({from:'B24',to:'K15',trainType:'local'}));assert.ok(r);
  assert.ok(r.legs.filter(l=>l.kind==='ride'&&['kintetsu','through'].includes(l.operator)).every(l=>l.category==='local'));
});
test('直通の鉄道サービスは近鉄京都駅を経由しない',()=>{
  for(const s of network.services.filter(s=>s.through)){assert.ok(!s.stops.includes('B01'));assert.ok(s.stops.includes('K11'));assert.ok(s.stops.includes('K15'));}
});
test('複数比較案の各時間に逆転がない',()=>{
  const rs=planRoutes(network,request({from:'B24',to:'K01'}),DEFAULT_PASSES);assert.ok(rs.length>=2);
  for(const r of rs)for(let i=0;i<r.legs.length;i++){const l=r.legs[i];assert.ok(l.arrive>=l.depart);if(i)assert.ok(l.depart>=r.legs[i-1].arrive);}
});
test('Yahooリンクに全経由地・日時を安全にエンコード',()=>{
  const url=new URL(yahooURL(request({from:'K07',to:'K01',start:637,via:[{stop:'B07',dwell:3},{stop:'B24',dwell:10}]}),network));
  assert.equal(url.origin,'https://transit.yahoo.co.jp');assert.equal(url.searchParams.get('from'),'丸太町');assert.deepEqual(url.searchParams.getAll('via'),['近鉄丹波橋','高の原']);assert.equal(url.searchParams.has('via1'),false);assert.equal(url.searchParams.get('hh'),'10');assert.equal(url.searchParams.get('m1'),'3');assert.equal(url.searchParams.get('m2'),'7');assert.equal(url.searchParams.get('type'),'1');
});
test('Yahoo検索の補助運賃で市バスの通常230円・定期0円を併記',()=>{
  const f=estimateDirectFare(network.busIds.get('祇園'),network.busIds.get('清水道'),network,DEFAULT_PASSES,date);
  assert.equal(f.normal,230);assert.equal(f.additional,0);
});
test('Yahoo検索の補助運賃でも近鉄に定期を適用しない',()=>{
  const f=estimateDirectFare('B24','K15',network,DEFAULT_PASSES,date);
  assert.equal(f.normal,590);assert.equal(f.additional,590);
});
test('Yahoo検索の直通補助運賃は竹田で事業者を分ける',()=>{
  const f=estimateDirectFare('K11','B07',network,DEFAULT_PASSES,date);
  assert.equal(f.additional,440);assert.equal(f.details.length,2);
});
test('実到着23時55分から10分の折り返し待ちで翌日0時5分をYahooへ渡す',()=>{
  const next=departureAfterDwell('2026-10-09T23:55',10);
  assert.deepEqual(next,{date:'2026-10-10',start:5});
  const u=new URL(yahooURL(request(next),network));assert.equal(u.searchParams.get('d'),'10');assert.equal(u.searchParams.get('hh'),'0');assert.equal(u.searchParams.get('m2'),'5');
});
test('折り返しの到着未入力や不正な待ち時間を拒否',()=>{assert.throws(()=>departureAfterDwell('',10));assert.throws(()=>departureAfterDwell('2026-10-09T12:00',-1));});
const fixture=()=>({schemaVersion:1,source:'検証用の明示されたデータ',validDates:[date],stops:[{id:'a',name:'A',type:'citybus'},{id:'b',name:'B',type:'citybus'}],services:[{id:'s',label:'202系統',operator:'citybus',category:'local',stops:['a','b'],trips:[{id:'t',date,arrivals:[600,610],departures:[600,610]}]}],walks:[]});
test('取込データは有効日の便だけを使用し、架空便にフォールバックしない',()=>{
  const n=applyFeed(network,fixture());assert.ok(route(n,request({from:'a',to:'b',start:599})));assert.equal(route(n,request({from:'a',to:'b',date:'2026-10-10'})),null);assert.equal(route(n,request({from:'a',to:'b',start:601})),null);
});
test('逆転した時刻データを拒否',()=>{const f=fixture();f.services[0].trips[0].arrivals[1]=590;assert.throws(()=>validateFeed(f));});
test('24時以降の時刻と乗車終了後の検索',()=>{assert.equal(formatTime(1450),'翌日 00:10');assert.equal(route(network,request({from:'K01',to:'K07',start:1439})),null);});
