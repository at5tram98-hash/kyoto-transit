import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNetwork} from '../public/js/network.js';
import {mergeTimetableFeeds,searchTimetable} from '../public/js/search-core.js';
import {compileKintetsuTrips} from '../worker/manual-rail-feed.js';
import {calendarDay} from '../worker/service-calendar.js';

const catalog=JSON.parse(readFileSync(new URL('../public/data/bus-catalog.json',import.meta.url),'utf8'));
const baseNetwork=createNetwork(catalog);
const passes={subway:false,citybus:false,kyotobus:false,expires:''};
const tm=s=>{const [h,m]=s.split(':').map(Number);return h*60+m;};
const trip=(id,category,destination,from,depart,to,arrive,extra=[])=>({tripId:id,category,destination,stops:[{name:from,departure:tm(depart)},...extra,{name:to,arrival:tm(arrive)}]});

// 2026-03-14 timetable revision. Each source points to the official Kintetsu trip-detail page
// that was rechecked on 2026-10-10. Paid limited expresses are intentionally excluded.
const cases=[
  {name:'京都→高の原 平日 普通 05:12',date:'2026-10-09',from:'B01',to:'B24',depart:'05:12',arrive:'06:01',trip:trip('1-1960','local','橿原神宮前','京都','05:12','高の原','06:01'),source:'https://eki.kintetsu.co.jp/norikae/sp/T7?dw=0&sf=5198&time=0510&tx=1-1960'},
  {name:'京都→高の原 平日 急行 07:58',date:'2026-10-09',from:'B01',to:'B24',depart:'07:58',arrive:'08:32',trip:trip('1-1935','express','天理','京都','07:58','高の原','08:32'),source:'https://eki.kintetsu.co.jp/norikae/T7?dw=0&sf=5198&time=1650&tx=1-1935'},
  {name:'京都→高の原 平日 急行 08:21',date:'2026-10-09',from:'B01',to:'B24',depart:'08:21',arrive:'08:57',trip:trip('1-1916','express','天理','京都','08:21','高の原','08:57'),source:'https://eki.kintetsu.co.jp/norikae/T7?dw=0&sf=5198&time=2130&tx=1-1916'},
  {name:'京都→高の原 土休日 急行 09:26',date:'2026-10-10',from:'B01',to:'B24',depart:'09:26',arrive:'09:59',trip:trip('1-7077','express','天理','京都','09:26','高の原','09:59'),source:'https://eki.kintetsu.co.jp/norikae/T7?dw=1&sf=5198&tx=1-7077'},
  {name:'高の原→京都 平日 急行 05:34',date:'2026-10-09',from:'B24',to:'B01',depart:'05:34',arrive:'06:07',trip:trip('1-1904','express','京都','高の原','05:34','京都','06:07'),source:'https://eki.kintetsu.co.jp/norikae/T7?dw=0&sf=5532&tx=1-1904'},
  {name:'高の原→京都 土休日 急行 09:11',date:'2026-10-10',from:'B24',to:'B01',depart:'09:11',arrive:'09:45',trip:trip('1-7101','express','京都','高の原','09:11','京都','09:45'),source:'https://eki.kintetsu.co.jp/norikae/T7?dw=1&sf=5532&time=0910&tx=1-7101'},
  {name:'高の原→京都 土休日 普通 11:37',date:'2026-10-10',from:'B24',to:'B01',depart:'11:37',arrive:'12:39',trip:trip('1-6737','local','京都','高の原','11:37','京都','12:39'),source:'https://eki.kintetsu.co.jp/norikae/T7?dw=1&sf=5532&time=1130&tx=1-6737'},
  {name:'高の原→京都 土休日 急行 11:58',date:'2026-10-10',from:'B24',to:'B01',depart:'11:58',arrive:'12:35',trip:trip('1-5380','express','京都','高の原','11:58','京都','12:35'),source:'https://eki.kintetsu.co.jp/norikae/T7?dw=1&sf=5532&time=1150&tx=1-5380'},
  {name:'高の原→京都 土休日 急行 12:13',date:'2026-10-10',from:'B24',to:'B01',depart:'12:13',arrive:'12:50',trip:trip('1-7097','express','京都','高の原','12:13','京都','12:50'),source:'https://eki.kintetsu.co.jp/norikae/T7?dw=1&sf=5532&time=1210&tx=1-7097'},
  {name:'高の原→京都 土休日 急行 14:28',date:'2026-10-10',from:'B24',to:'B01',depart:'14:28',arrive:'15:05',trip:trip('1-5373','express','京都','高の原','14:28','京都','15:05'),source:'https://eki.kintetsu.co.jp/norikae/T7?dw=1&sf=5532&time=1420&tx=1-5373'},
  {name:'高の原→京都 平日 急行 16:28',date:'2026-10-09',from:'B24',to:'B01',depart:'16:28',arrive:'17:05',trip:trip('1-86','express','京都','高の原','16:28','京都','17:05'),source:'https://eki.kintetsu.co.jp/norikae/T7?dw=0&sf=5532&time=1620&tx=1-86'},
  {name:'高の原→京都 平日 急行 22:19',date:'2026-10-09',from:'B24',to:'B01',depart:'22:19',arrive:'22:52',trip:trip('1-1909','express','京都','高の原','22:19','京都','22:52'),source:'https://eki.kintetsu.co.jp/norikae/T7?dw=0&sf=5532&time=2210&tx=1-1909'}
];

for(const c of cases)test(`公式照合: ${c.name}`,()=>{
  const feed=compileKintetsuTrips([c.trip],{date:c.date,revision:'2026-03-14',checkedAt:'2026-10-10T12:00:00Z'}),network=mergeTimetableFeeds({...baseNetwork,services:[],mode:'timetable'},[feed]);
  const routes=searchTimetable(network,{from:c.from,to:c.to,date:c.date,start:tm(c.depart),timeMode:'departure',via:[],buffer:3,maxWalk:10,trainType:c.trip.category},passes);
  assert.ok(routes.length,`${c.source} の便が検索結果にない`);assert.equal(routes[0].start,tm(c.depart));assert.equal(routes[0].time,tm(c.arrive));
});

test('公式照合: 近鉄直通の丸太町→国際会館 10:50→11:02',()=>{
  const through={tripId:'1-5581',category:'express',destination:'国際会館',stops:[{name:'高の原',departure:tm('10:01')},{name:'竹田',arrival:tm('10:32'),departure:tm('10:36')},{name:'くいな橋',arrival:tm('10:37'),departure:tm('10:37')},{name:'京都（京都地下鉄）',arrival:tm('10:42'),departure:tm('10:42')},{name:'丸太町',arrival:tm('10:49'),departure:tm('10:50')},{name:'国際会館',arrival:tm('11:02')}]};
  const feed=compileKintetsuTrips([through],{date:'2026-10-10',revision:'2026-03-14'}),network=mergeTimetableFeeds({...baseNetwork,services:[],mode:'timetable'},[feed]),routes=searchTimetable(network,{from:'K07',to:'K01',date:'2026-10-10',start:tm('10:50'),timeMode:'departure',via:[],buffer:3,maxWalk:10,trainType:'express'},passes);
  assert.ok(routes.length);assert.equal(routes[0].start,tm('10:50'));assert.equal(routes[0].time,tm('11:02'));
});

test('祝日判定: 2026-10-12は休日ダイヤ',()=>{assert.equal(calendarDay('2026-10-12','kintetsu'),'holiday');});

test.todo('丸太町→国際会館→京産大: 京都バスGTFSの国際会館発と京産大着を一次データで照合する（ODPT secret登録後）');
