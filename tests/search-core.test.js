import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeTimetableFeeds,selectThree,searchTimetable,applyRealtime,dayKind,staleWarnings} from '../public/js/search-core.js';

const stops=new Map([
 ['a',{id:'a',name:'A',type:'subway',aliases:[],lines:['L'],subwayKm:0}],
 ['b',{id:'b',name:'B',type:'subway',aliases:[],lines:['L'],subwayKm:4}],
 ['c',{id:'c',name:'C',type:'citybus',aliases:[],lines:['10']}],
 ['d',{id:'d',name:'D',type:'citybus',aliases:[],lines:['10']}]
]);
const base={stops,services:[],walks:[{from:'b',to:'c',minutes:3},{from:'c',to:'b',minutes:3}],mode:'fallback'};
const subway={validDates:['2026-10-10'],meta:{operator:'subway',stale:false},stops:[{id:'x',name:'A'},{id:'y',name:'B'}],services:[{id:'s',operator:'subway',label:'烏丸線',category:'local',stops:['x','y'],trips:[{id:'s1',date:'2026-10-10',arrivals:[480,488],departures:[480,488]},{id:'s2',date:'2026-10-10',arrivals:[490,498],departures:[490,498]}]}]};
const city={validDates:['2026-10-10'],meta:{operator:'citybus',stale:false},stops:[{id:'p',name:'C'},{id:'q',name:'D'}],services:[{id:'b10',operator:'citybus',route:'10',label:'10系統',category:'local',stops:['p','q'],trips:[{id:'b1',date:'2026-10-10',arrivals:[495,505],departures:[495,505]},{id:'b2',date:'2026-10-10',arrivals:[510,520],departures:[510,520]}]}]};
const passes={subway:false,citybus:false,kyotobus:false,expires:''};

test('GTFS停留所IDをアプリ内地点へ名称で統合し時刻表ネットワークを作る',()=>{const n=mergeTimetableFeeds(base,[subway,city]);assert.equal(n.services.length,2);assert.deepEqual(n.services[0].stops,['a','b']);assert.deepEqual(n.services[1].stops,['c','d']);assert.deepEqual(n.validDates,['2026-10-10']);});
test('乗換余裕と徒歩上限を反映して時刻表探索する',()=>{const n=mergeTimetableFeeds(base,[subway,city]),r=searchTimetable(n,{from:'a',to:'d',date:'2026-10-10',start:479,timeMode:'departure',via:[],buffer:3,maxWalk:10,trainType:'all'},passes);assert.ok(r.length>=1);assert.equal(r[0].legs.filter(x=>x.kind==='ride').length,2);assert.equal(r[0].time,505);});
test('到着時刻指定は実際の初発便候補から締切以内の経路を選ぶ',()=>{const n=mergeTimetableFeeds(base,[subway,city]),r=searchTimetable(n,{from:'a',to:'d',date:'2026-10-10',start:506,timeMode:'arrival',via:[],buffer:3,maxWalk:10,trainType:'all'},passes);assert.ok(r.length>=1);assert.equal(r[0].time,505);assert.equal(r[0].start,480);});
test('早い・安い・乗換少を重複しない3案として選ぶ',()=>{const routes=[{legs:[{kind:'ride',from:'a',to:'b',depart:1,serviceId:'x'}],time:20,duration:19,start:1,transfers:1,fare:{additional:300,normal:300}},{legs:[{kind:'ride',from:'a',to:'b',depart:2,serviceId:'y'}],time:25,duration:23,start:2,transfers:0,fare:{additional:400,normal:400}},{legs:[{kind:'ride',from:'a',to:'b',depart:3,serviceId:'z'}],time:30,duration:27,start:3,transfers:2,fare:{additional:100,normal:100}}];const r=selectThree(routes);assert.equal(r.length,3);assert.equal(r[0].optionLabel,'早い');assert.equal(r[1].optionLabel,'安い');assert.equal(r[2].optionLabel,'乗換少');});
test('リアルタイム遅延を到着時刻へ反映し実測/予測を区別する',()=>{const route={time:500,duration:20,legs:[{kind:'ride',operator:'citybus',route:'10',depart:480,arrive:500}]};const live={citybus:{results:[{route:'10',minutes:5,source:'prediction'}]}};const r=applyRealtime(route,live,{nowMinute:478});assert.equal(r.realtimeDelay,3);assert.equal(r.time,503);assert.equal(r.realtimeSource,'prediction');});
test('祝日・土曜・平日を自動判定する',()=>{const holidays=new Set(['2026-10-12']);assert.equal(dayKind('2026-10-12',{holidays}),'holiday');assert.equal(dayKind('2026-10-10',{holidays}),'saturday');assert.equal(dayKind('2026-10-09',{holidays}),'weekday');});
test('古いfeedだけ短い警告を返す',()=>{const n={feedMeta:[{operator:'subway',stale:false},{operator:'citybus',stale:true,warning:'時刻データの更新を確認してください。'}]};assert.deepEqual(staleWarnings(n),['時刻データの更新を確認してください。']);});
