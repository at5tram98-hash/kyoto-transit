import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHyperdia,parseKintetsuBoard,parseKintetsuTrip,jsonConstant,kyotoEntries} from '../worker/timetables.js';
import {calendarDay} from '../worker/service-calendar.js';
import {createAutoBoarding,officialTripLeg} from '../public/js/vehicle.js';
import {createNetwork} from '../public/js/network.js';
import catalog from '../public/data/bus-catalog.json' with {type:'json'};
const network=createNetwork(catalog);
test('公式PC地下鉄表の発車時刻を読み取り、未提供の行先は作らない',()=>{
  const d=parseHyperdia('<h1>丸太町</h1><table><tr class="time wektime"><td><h3>5</h3></td><td class="timetable"><span data-no="1">34</span><span data-no="2">50</span></td></tr><tr class="time holtime"><td><h3>6</h3></td><td class="timetable"><span data-no="3">5</span></td></tr></table>');
  assert.deepEqual(d.days.weekday.map(e=>e.depart),[334,350]);assert.equal(d.days.saturday[0].depart,365);assert.equal(d.days.weekday[0].destination,null);
});
test('近鉄公式の普通・急行・便詳細リンクを読み分ける',()=>{
  const d=parseKintetsuBoard('<table><tr><td><b>5</b></td><td><table><tr><td><a href="T7?sf=5532&amp;tx=1-6661&amp;dw=1&amp;time=0520"><div class="K_1901">田<br><div class="min">20</div></div></a></td><td><a href="T7?sf=5532&amp;tx=1-5370&amp;dw=1&amp;time=0530"><div class="K_1903">京<br><div class="min">33</div></div></a></td></tr></table></td></tr></table>','https://eki.kintetsu.co.jp/norikae/T5');
  assert.equal(d.entries.length,2);assert.equal(d.entries[0].category,'local');assert.equal(d.entries[0].destination,'新田辺');assert.equal(d.entries[1].depart,333);assert.equal(d.entries[1].category,'express');assert.match(d.entries[1].tripURL,/tx=1-5370/);
});
test('公式便詳細は発着・長い停車・終点の発車なしを維持する',()=>{
  const html='<table><tr><td>普通 京都行き（始発駅 大和西大寺）</td></tr><tr><td><a href="/norikae/T2">高の原</a></td><td>１７：０６</td><td>１７：０７</td></tr><tr><td><a href="/norikae/T2">新祝園</a></td><td>１７：１３</td><td>１７：１８</td></tr><tr><td><a href="/norikae/T2">京都</a></td><td>１８：０９</td><td>－</td></tr></table>';
  const d=parseKintetsuTrip(html,'https://eki.kintetsu.co.jp/norikae/T7?tx=1-6755');assert.equal(d.stops[1].departure-d.stops[1].arrival,5);assert.equal(d.stops.at(-1).arrival,1089);assert.equal(d.stops.at(-1).departure,null);
});
test('京都バスJSONはコードとして実行せず、対象系統の実時刻を保持する',()=>{
  const d=jsonConstant('const SCHEDULE_BOOT = {"x":{"note":"brace } here","timetable":{"saturday":{"hour":{"6":[{"route_short_name":"４０","departure_time":"06:48","trip_id":"real-1","route_id":"10059","stop_headsign":"市原"},{"route_short_name":"１４","departure_time":"06:50"}]}}}}};','SCHEDULE_BOOT');assert.equal(d.x.note,'brace } here');const e=kyotoEntries(d.x);assert.equal(e.saturday.length,1);assert.equal(e.saturday[0].depart,408);assert.equal(e.saturday[0].tripId,'real-1');assert.throws(()=>jsonConstant('const BAD = {"value": (() => 1)()};','BAD'));
});
test('大学カレンダーと一般の平日を混同しない',()=>{
  assert.equal(calendarDay('2026-10-29','kyotobus'),'weekday_b');assert.equal(calendarDay('2026-10-28','kyotobus'),'wednesday_a');assert.equal(calendarDay('2026-12-28','kyotobus'),'holiday');assert.equal(calendarDay('2026-12-28','subway'),'weekday');assert.equal(calendarDay('2026-10-10','subway'),'saturday');assert.equal(calendarDay('2027-04-01','kyotobus'),null);assert.throws(()=>calendarDay('2026-02-30','subway'));
});
test('自動確定には強い一意候補と別GPS点の15秒継続が必要',()=>{
  const detector=createAutoBoarding(),leg={from:'B24',depart:1000,destination:'京都'},ranked=[{leg,score:90,geometry:true},{leg:{...leg,depart:1005},score:60,geometry:true}];assert.equal(detector.update(ranked,{timestamp:100000},'rail'),null);assert.equal(detector.update(ranked,{timestamp:100000},'rail'),null);assert.equal(detector.update(ranked,{timestamp:115000},'rail'),leg);detector.reset();assert.equal(detector.update([{...ranked[0]},{...ranked[1],score:90}],{timestamp:140000},'rail'),null);
});
test('近鉄から地下鉄への直通は同名の京都・十条を取り違えない',()=>{
  const trip={operator:'kintetsu',boardStop:'B07',destination:'国際会館',category:'express',title:'急行 国際会館行き',stops:[{name:'近鉄丹波橋',departure:600},{name:'竹田',arrival:605,departure:607},{name:'十条',arrival:612},{name:'京都',arrival:616},{name:'国際会館',arrival:640}]};const leg=officialTripLeg(trip,network);assert.equal(leg.operator,'through');assert.equal(leg.officialStops[2].id,'K13');assert.equal(leg.officialStops[3].id,'K11');assert.equal(leg.to,'K01');assert.equal(leg.fullTerminus,true);
});
