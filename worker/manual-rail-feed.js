import catalog from '../public/data/bus-catalog.json' with {type:'json'};
import {createNetwork,normalize,kintetsuIds,subwayIds} from '../public/js/network.js';
import {calendarDay} from './service-calendar.js';
import {officialFetcher,officialText,parseKintetsuTrip,readTimetable} from './timetables.js';

const network=createNetwork(catalog);
const APP_IDS=new Set([...kintetsuIds,...subwayIds]);
const STOP_BY_NAME=new Map([...network.stops.values()].filter(s=>APP_IDS.has(s.id)).flatMap(s=>[s.name,...(s.aliases??[])].filter(Boolean).map(name=>[normalize(name),s.id])));
const SEEDS=[
  {stop:'B01',direction:'south'},
  {stop:'K15',direction:'south'},
  {stop:'B16',direction:'north'},
  {stop:'B26',direction:'north'}
];
const revisionDate=value=>{const m=String(value??'').match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:null;};
const serviceDay=day=>day==='weekday'?'weekday':'weekend';
const sourceURL='https://eki.kintetsu.co.jp/norikae/';

function mappedStops(trip){
  const rows=[];for(const stop of trip.stops){const id=STOP_BY_NAME.get(normalize(stop.name));if(!id)continue;const arrival=Number.isFinite(stop.arrival)?stop.arrival:stop.departure,departure=Number.isFinite(stop.departure)?stop.departure:stop.arrival;if(!Number.isFinite(arrival)||!Number.isFinite(departure))continue;if(rows.at(-1)?.id===id)continue;rows.push({id,arrival,departure});}return rows;
}
export function compileKintetsuTrips(trips,{date,revision=null,checkedAt=new Date().toISOString()}={}){
  const grouped=new Map(),usedStops=new Set();
  for(const trip of trips){if(!['local','express'].includes(trip.category))continue;const rows=mappedStops(trip);if(rows.length<2)continue;rows.forEach(r=>usedStops.add(r.id));const hasSubway=rows.some(r=>subwayIds.includes(r.id)&&r.id!=='K15'),operator=hasSubway?'through':'kintetsu',signature=`${operator}|${trip.category}|${rows.map(r=>r.id).join(',')}`;if(!grouped.has(signature))grouped.set(signature,{id:`manual:${signature}`,operator,label:operator==='through'?'烏丸線・近鉄直通':'近鉄京都線',category:trip.category,stops:rows.map(r=>r.id),trips:[]});grouped.get(signature).trips.push({id:trip.tripId,date,arrivals:rows.map(r=>r.arrival),departures:rows.map(r=>r.departure),headsign:trip.destination});}
  const stops=[...usedStops].map(id=>({id,name:network.stops.get(id)?.name??id,type:network.stops.get(id)?.type??'kintetsu'}));
  return {schemaVersion:1,source:sourceURL,revisionDate:revision,lastUpdated:checkedAt,validDates:[date],stops,services:[...grouped.values()],walks:[],meta:{operator:'kintetsu',revisionDate:revision,lastUpdated:checkedAt,stale:false,warning:null,method:'official-timetable-json'}};
}
async function mapLimit(items,limit,fn){const out=new Array(items.length);let cursor=0;async function run(){for(;;){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i],i);}catch(e){out[i]={error:String(e?.message??e)};}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return out;}
export async function buildKintetsuPattern(env,date){
  const day=calendarDay(date,'kintetsu');if(!day)throw Error('近鉄の曜日種別を判定できません。');const fetcher=officialFetcher(env),boards=[];
  for(const seed of SEEDS){const board=await readTimetable(seed.stop,seed.direction,day,fetcher,date);boards.push(board);}
  const entries=[...new Map(boards.flatMap(board=>(board.entries??[]).filter(e=>['local','express'].includes(e.category)&&e.tripURL).map(e=>[e.tripId,{...e,revision:revisionDate(board.effective)}])).values())];
  if(!entries.length)throw Error('近鉄の普通・急行便を確認できませんでした。');
  const parsed=await mapLimit(entries,8,async entry=>parseKintetsuTrip(await officialText(entry.tripURL,fetcher,6*3600),entry.tripURL));
  const trips=parsed.filter(x=>x&&!x.error),revision=[...new Set(boards.map(b=>revisionDate(b.effective)).filter(Boolean))].sort().at(-1)??null;if(trips.length<20)throw Error(`近鉄便詳細が少なすぎます（${trips.length}件）。`);
  const feed=compileKintetsuTrips(trips,{date,revision});feed.meta.seedStations=SEEDS.map(x=>x.stop);feed.meta.tripCount=trips.length;feed.meta.day=serviceDay(day);feed.meta.failedTrips=parsed.length-trips.length;return feed;
}
export async function refreshKintetsuPattern(env,date){if(!env.LIVE_KV)throw Error('LIVE_KVが未設定です。');const feed=await buildKintetsuPattern(env,date),key=`manual:kintetsu:${serviceDay(calendarDay(date,'kintetsu'))}`;await env.LIVE_KV.put(key,JSON.stringify(feed));await env.LIVE_KV.put('manual:kintetsu:status',JSON.stringify({checkedAt:feed.lastUpdated,revisionDate:feed.revisionDate,tripCount:feed.meta.tripCount,failedTrips:feed.meta.failedTrips,day:feed.meta.day}));return feed;}
export async function readKintetsuPattern(env,date){const day=calendarDay(date,'kintetsu');if(!day)return null;const raw=await env.LIVE_KV?.get(`manual:kintetsu:${serviceDay(day)}`);if(!raw)return null;const source=JSON.parse(raw),age=Date.now()-Date.parse(source.lastUpdated),stale=!Number.isFinite(age)||age>14*86400_000;return {...source,validDates:[date],services:source.services.map(s=>({...s,trips:s.trips.map(t=>({...t,date}))})),meta:{...source.meta,stale,warning:stale?'近鉄の時刻データを確認してください。':null}};}
