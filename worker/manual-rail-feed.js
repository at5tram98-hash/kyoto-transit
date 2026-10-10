import catalog from '../public/data/bus-catalog.json' with {type:'json'};
import {createNetwork,normalize,kintetsuIds,subwayIds} from '../public/js/network.js';
import {calendarDay} from './service-calendar.js';
import {officialFetcher,officialText,parseKintetsuBoard} from './timetables.js';

const network=createNetwork(catalog);
const KINTETSU='https://eki.kintetsu.co.jp/norikae/';
const byIds=ids=>new Map(ids.flatMap(id=>{const s=network.stops.get(id);return [s?.name,...(s?.aliases??[])].filter(Boolean).map(name=>[normalize(name),id]);}));
const KINTETSU_BY_NAME=byIds(kintetsuIds),SUBWAY_BY_NAME=byIds(subwayIds);
const SUBWAY_EXCLUSIVE=new Set([...SUBWAY_BY_NAME.keys()].filter(name=>!KINTETSU_BY_NAME.has(name)&&name!==normalize('竹田')));
const DESTINATION_IDS=new Map([
  ['京都','B01'],['京','B01'],['新田辺','B16'],['田','B16'],['近鉄宮津','B19'],['宮','B19'],['大和西大寺','B26'],['西','B26']
].map(([name,id])=>[normalize(name),id]));
const revisionDate=value=>{const m=String(value??'').match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:null;};
const serviceDay=day=>day==='weekday'?'weekday':'weekend';
const sourceURL=KINTETSU;
const median=values=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};

function mappedStops(trip){
  const names=trip.stops.map(s=>normalize(s.name)),takeda=names.findIndex(n=>n===normalize('竹田')),hasSubway=names.some(n=>SUBWAY_EXCLUSIVE.has(n)),subwayFirst=hasSubway&&takeda>=0&&names.slice(0,takeda).some(n=>SUBWAY_EXCLUSIVE.has(n));
  const rows=[];for(let i=0;i<trip.stops.length;i++){const stop=trip.stops[i],n=names[i];let id;if(hasSubway&&takeda>=0){if(i===takeda)id='K15';else if(subwayFirst)id=i<takeda?SUBWAY_BY_NAME.get(n):KINTETSU_BY_NAME.get(n);else id=i<takeda?KINTETSU_BY_NAME.get(n):SUBWAY_BY_NAME.get(n);}else id=KINTETSU_BY_NAME.get(n);if(!id)continue;const arrival=Number.isFinite(stop.arrival)?stop.arrival:stop.departure,departure=Number.isFinite(stop.departure)?stop.departure:stop.arrival;if(!Number.isFinite(arrival)||!Number.isFinite(departure))continue;if(rows.at(-1)?.id===id)continue;rows.push({id,arrival,departure});}return rows;
}
// Exact official trip-detail fixtures still use this converter in tests. The daily
// updater below does not fetch every T7 page; it joins tx IDs already present in T5.
export function compileKintetsuTrips(trips,{date,revision=null,checkedAt=new Date().toISOString()}={}){
  const grouped=new Map(),usedStops=new Set();
  for(const trip of trips){if(!['local','express'].includes(trip.category))continue;const rows=mappedStops(trip);if(rows.length<2)continue;rows.forEach(r=>usedStops.add(r.id));const hasSubway=rows.some(r=>subwayIds.includes(r.id)&&r.id!=='K15'),operator=hasSubway?'through':'kintetsu',signature=`${operator}|${trip.category}|${rows.map(r=>r.id).join(',')}`;if(!grouped.has(signature))grouped.set(signature,{id:`manual:${signature}`,operator,label:operator==='through'?'烏丸線・近鉄直通':'近鉄京都線',category:trip.category,stops:rows.map(r=>r.id),trips:[]});grouped.get(signature).trips.push({id:trip.tripId,date,arrivals:rows.map(r=>r.arrival),departures:rows.map(r=>r.departure),headsign:trip.destination});}
  const stops=[...usedStops].map(id=>({id,name:network.stops.get(id)?.name??id,type:network.stops.get(id)?.type??'kintetsu'}));
  return {schemaVersion:1,source:sourceURL,revisionDate:revision,lastUpdated:checkedAt,validDates:[date],stops,services:[...grouped.values()],walks:[],meta:{operator:'kintetsu',revisionDate:revision,lastUpdated:checkedAt,stale:false,warning:null,method:'official-trip-detail-json'}};
}

const routeIndex=id=>kintetsuIds.indexOf(id);
const beyond=(direction,a,b)=>direction==='south'?routeIndex(b)>routeIndex(a):routeIndex(b)<routeIndex(a);
const pairKey=(direction,category,from,to)=>`${direction}|${category}|${from}|${to}`;
function destinationId(value){return DESTINATION_IDS.get(normalize(value??''))??null;}
function collectBoardTrips(boards){
  const trips=new Map();
  for(const board of boards){for(const entry of board.entries??[]){if(!['local','express'].includes(entry.category)||!entry.tripId||!Number.isFinite(entry.depart))continue;const key=`${board.direction}|${entry.tripId}`;if(!trips.has(key))trips.set(key,{id:entry.tripId,direction:board.direction,category:entry.category,destination:entry.destination??'',rows:[]});const t=trips.get(key);t.rows.push({id:board.stop,index:board.index,departure:entry.depart});if(!t.destination&&entry.destination)t.destination=entry.destination;}}
  for(const t of trips.values()){t.rows.sort((a,b)=>t.direction==='south'?a.index-b.index:b.index-a.index);t.rows=t.rows.filter((r,i)=>i===0||r.id!==t.rows[i-1].id);}
  return [...trips.values()];
}
function segmentMedians(trips){const values=new Map();for(const t of trips){for(let i=1;i<t.rows.length;i++){const a=t.rows[i-1],b=t.rows[i],gap=b.departure-a.departure;if(gap<=0||gap>30)continue;const key=pairKey(t.direction,t.category,a.id,b.id);if(!values.has(key))values.set(key,[]);values.get(key).push(gap);}}return new Map([...values].map(([key,v])=>[key,median(v)]));}
export function compileKintetsuBoards(boards,{date,revision=null,checkedAt=new Date().toISOString()}={}){
  const trips=collectBoardTrips(boards),medians=segmentMedians(trips),grouped=new Map(),usedStops=new Set();let terminalDerived=0;
  for(const trip of trips){const rows=trip.rows.map(r=>({...r,arrival:r.departure}));const dest=destinationId(trip.destination),last=rows.at(-1);
    if(dest&&last&&dest!==last.id&&beyond(trip.direction,last.id,dest)){
      const gap=medians.get(pairKey(trip.direction,trip.category,last.id,dest));if(Number.isFinite(gap)&&gap>0&&gap<=30){rows.push({id:dest,index:routeIndex(dest),arrival:last.departure+gap,departure:last.departure+gap,derivedTerminal:true});terminalDerived++;}
    }
    if(rows.length<2)continue;rows.forEach(r=>usedStops.add(r.id));const signature=`kintetsu|${trip.direction}|${trip.category}|${rows.map(r=>r.id).join(',')}`;
    if(!grouped.has(signature))grouped.set(signature,{id:`manual:${signature}`,operator:'kintetsu',label:'近鉄京都線',category:trip.category,stops:rows.map(r=>r.id),trips:[]});
    grouped.get(signature).trips.push({id:trip.id,date,arrivals:rows.map(r=>r.arrival),departures:rows.map(r=>r.departure),headsign:trip.destination});
  }
  for(const service of grouped.values())service.trips.sort((a,b)=>a.departures[0]-b.departures[0]);
  const stops=[...usedStops].sort((a,b)=>routeIndex(a)-routeIndex(b)).map(id=>({id,name:network.stops.get(id)?.name??id,type:network.stops.get(id)?.type??'kintetsu'}));
  const tripCount=[...grouped.values()].reduce((n,s)=>n+s.trips.length,0);
  return {schemaVersion:1,source:sourceURL,revisionDate:revision,lastUpdated:checkedAt,validDates:[date],stops,services:[...grouped.values()],walks:[],meta:{operator:'kintetsu',revisionDate:revision,lastUpdated:checkedAt,stale:false,warning:null,method:'official-board-tx-join',boardCount:boards.length,tripCount,terminalDerived,intermediateArrivalUsesDeparture:true}};
}

async function mapLimit(items,limit,fn){const out=new Array(items.length);let cursor=0;async function run(){for(;;){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i],i);}catch(e){out[i]={error:String(e?.message??e)};}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return out;}
function boardURL(index,direction,day){if(index===0&&direction!=='south')return null;const d=index===0?'1':direction==='north'?'1':'2',dw=day==='weekday'?'0':'1';return `${KINTETSU}T5?USR=PC&slCode=360-${index}&d=${d}&dw=${dw}&pattern=A`;}
async function fetchBoard(fetcher,{stop,index,direction},day){const url=boardURL(index,direction,day);if(!url)return null;const parsed=parseKintetsuBoard(await officialText(url,fetcher,6*3600),url);return {stop,index,direction,entries:parsed.entries,effective:parsed.effective,sourceURL:url};}
export async function buildKintetsuPattern(env,date){
  const day=calendarDay(date,'kintetsu');if(!day)throw Error('近鉄の曜日種別を判定できません。');const fetcher=officialFetcher(env),tasks=[];
  for(let index=0;index<=25;index++){const stop=kintetsuIds[index];if(index>0)tasks.push({stop,index,direction:'north'});tasks.push({stop,index,direction:'south'});}
  const read=await mapLimit(tasks,2,(task)=>fetchBoard(fetcher,task,day)),errors=read.filter(x=>x?.error),boards=read.filter(x=>x&&!x.error);
  if(errors.length)throw Error(`近鉄公式発車表の取得に失敗しました（${errors.length}/${tasks.length}方面）。`);
  const revision=[...new Set(boards.map(b=>revisionDate(b.effective)).filter(Boolean))].sort().at(-1)??null,feed=compileKintetsuBoards(boards,{date,revision});
  if(feed.meta.tripCount<60||feed.stops.length<24)throw Error(`近鉄の時刻表結合が不十分です（${feed.meta.tripCount}便・${feed.stops.length}駅）。`);
  feed.meta.day=serviceDay(day);feed.meta.partial=false;feed.meta.quality='all-station-board-join';return feed;
}
export async function refreshKintetsuPattern(env,date){if(!env.LIVE_KV)throw Error('LIVE_KVが未設定です。');const feed=await buildKintetsuPattern(env,date),key=`manual:kintetsu:${serviceDay(calendarDay(date,'kintetsu'))}`;await env.LIVE_KV.put(key,JSON.stringify(feed));await env.LIVE_KV.put('manual:kintetsu:status',JSON.stringify({checkedAt:feed.lastUpdated,revisionDate:feed.revisionDate,tripCount:feed.meta.tripCount,boardCount:feed.meta.boardCount,terminalDerived:feed.meta.terminalDerived,day:feed.meta.day,partial:false,method:feed.meta.method}));return feed;}
export async function readKintetsuPattern(env,date){const day=calendarDay(date,'kintetsu');if(!day)return null;const raw=await env.LIVE_KV?.get(`manual:kintetsu:${serviceDay(day)}`);if(!raw)return null;const source=JSON.parse(raw),age=Date.now()-Date.parse(source.lastUpdated),stale=!Number.isFinite(age)||age>14*86400_000;return {...source,validDates:[date],services:source.services.map(s=>({...s,trips:s.trips.map(t=>({...t,date}))})),meta:{...source.meta,stale,warning:stale?'近鉄の時刻データを確認してください。':source.meta.warning??null}};}
