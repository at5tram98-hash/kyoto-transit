import catalog from '../public/data/bus-catalog.json' with {type:'json'};
import {createNetwork,normalize} from '../public/js/network.js';
import {calendarDay} from './service-calendar.js';
import {officialFetcher,officialText,parseCityCatalog,parseHyperdia,timetableOptions,readTimetable,timeNumber} from './timetables.js';

const network=createNetwork(catalog);
const CACHE_TTL=172800;
const cleanName=stop=>stop?.fullName??stop?.name??'';
const unique=values=>[...new Set(values)];

async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let cursor=0;
  async function run(){for(;;){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i],i);}catch{out[i]=null;}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return out;
}
function stopRecord(id){const s=network.stops.get(id);return s?{id,name:s.name,type:s.type,aliases:s.aliases??[],lines:s.lines??[]}:null;}
function feed(operator,date,services,source,precision){
  const stopIds=unique(services.flatMap(s=>s.stops));
  return {schemaVersion:1,source,revisionDate:date,lastUpdated:new Date().toISOString(),validDates:[date],stops:stopIds.map(stopRecord).filter(Boolean),services,walks:[],meta:{operator,source:'official_fallback',fallback:true,precision,stale:false,warning:null,lastUpdated:new Date().toISOString()}};
}
export function chooseCityBoard(boards=[],nextName='',reverse=false){
  if(!boards.length)return null;const target=normalize(nextName);
  const scored=boards.map((board,index)=>({board,index,score:target&&normalize(board.label??'').includes(target)?10:0})).sort((a,b)=>b.score-a.score||((reverse?b.index:a.index)-(reverse?a.index:b.index)));
  return scored[0]?.board??null;
}
export function offsetTrips(entries=[],service,date){
  const base=service.offsets?.[0]??0;
  return entries.filter(e=>Number.isFinite(e.depart)).map((entry,index)=>{
    const times=(service.offsets??[]).map(offset=>Math.round(entry.depart+(offset-base)));
    return {id:`official:${service.id}:${date}:${entry.depart}:${index}`,date,arrivals:times,departures:times,headsign:entry.destination??''};
  });
}
async function cityService(service,date,day,fetcher,routePageCache){
  const route=String(service.route??''),source=catalog[route]?.source;if(!source)return null;
  let rows=routePageCache.get(route);if(!rows){rows=parseCityCatalog(await officialText(source,fetcher,3600),source);routePageCache.set(route,rows);}
  const anchorId=service.stops[0],anchor=network.stops.get(anchorId),next=network.stops.get(service.stops[1]);if(!anchor||!next)return null;
  const row=rows.find(r=>normalize(r.name)===normalize(cleanName(anchor)));if(!row?.boards?.length)return null;
  const board=chooseCityBoard(row.boards,cleanName(next),service.id.endsWith('-up'));if(!board)return null;
  const parsed=parseHyperdia(await officialText(board.sourceURL,fetcher,1800)),entries=parsed.days?.[day]??[];
  const trips=offsetTrips(entries,service,date);if(!trips.length)return null;
  return {id:`official-${service.id}`,label:service.label,operator:'citybus',route,category:'local',stops:service.stops,trips,officialFallback:true,sourceURL:board.sourceURL};
}
export async function buildCityBusFallback(env,date,fetcher=officialFetcher(env)){
  const day=calendarDay(date,'citybus');if(!day)throw Error('市バスの運行日区分を確認できません。');
  const prototypes=network.services.filter(s=>s.operator==='citybus'&&s.prototype),routePageCache=new Map();
  const services=(await mapLimit(prototypes,3,s=>cityService(s,date,day,fetcher,routePageCache))).filter(Boolean);
  if(!services.length)throw Error('京都市バスの公式時刻表fallbackを生成できませんでした。');
  return feed('citybus',date,services,'京都市交通局 公式停留所時刻表（区間所要時間は路線順序から補完）','official_departures_with_segment_completion');
}
function kyotoRouteMatch(route,value){const text=String(value??'').normalize('NFKC');return route==='臨時'?/^臨時/.test(text):/^(?:特|直行)?40$/.test(text);}
function chooseKyotoBoard(boards=[],route,targetName=''){
  const target=normalize(targetName),eligible=boards.filter(b=>(b.routes??[]).some(r=>kyotoRouteMatch(route,r)));if(!eligible.length)return null;
  return eligible.map((board,index)=>({board,index,score:target&&normalize(board.label??'').includes(target)?10:0})).sort((a,b)=>b.score-a.score||a.index-b.index)[0]?.board??null;
}
function timedSequence(board,entry,detail){
  return [{name:board.name,arrival:entry.depart,departure:entry.depart},...(detail?.stops??[]).map(s=>({name:s.stop_name,arrival:timeNumber(s.arrival_time),departure:timeNumber(s.departure_time)}))];
}
function serviceTimes(service,sequence){
  const arrivals=[],departures=[];let cursor=0,previous=0;
  for(const id of service.stops){const wanted=normalize(cleanName(network.stops.get(id)));let found=-1;for(let i=cursor;i<sequence.length;i++)if(normalize(sequence[i].name)===wanted){found=i;break;}if(found<0)return null;cursor=found+1;
    let a=sequence[found].arrival??sequence[found].departure,d=sequence[found].departure??a;if(!Number.isFinite(a)||!Number.isFinite(d))return null;while(a<previous)a+=1440;while(d<a)d+=1440;arrivals.push(a);departures.push(d);previous=d;
  }
  return {arrivals,departures};
}
async function kyotoService(service,date,day,fetcher){
  const anchorId=service.stops[0],targetId=service.stops.at(-1),anchor=network.stops.get(anchorId),target=network.stops.get(targetId);if(!anchor?.officialId||!target)return null;
  const options=await timetableOptions(anchorId,fetcher),board=chooseKyotoBoard(options.boards,service.route,cleanName(target));if(!board)return null;
  const timetable=await readTimetable(anchorId,board.key,day,fetcher,date);if(!timetable.fareURL)return null;
  const raw=JSON.parse(await officialText(timetable.fareURL,fetcher,1800));if(!Array.isArray(raw))return null;
  const trips=[];for(const entry of timetable.entries.filter(e=>kyotoRouteMatch(service.route,e.route))){const route=raw.find(r=>String(r.route_id)===String(entry.routeId)),detail=route?.departures?.find(t=>t.trip_id===entry.tripId&&timeNumber(t.departure_time)===entry.depart);if(!detail)continue;const times=serviceTimes(service,timedSequence(timetable,entry,detail));if(!times)continue;trips.push({id:`official:${service.id}:${entry.tripId}`,date,...times,headsign:entry.destination??''});}
  if(!trips.length)return null;return {id:`official-${service.id}`,label:service.label,operator:'kyotobus',route:String(service.route),category:'local',stops:service.stops,trips,officialFallback:true,sourceURL:timetable.sourceURL};
}
export async function buildKyotoBusFallback(env,date,fetcher=officialFetcher(env)){
  const day=calendarDay(date,'kyotobus');if(!day)throw Error('京都バスの運行日区分を確認できません。');
  const prototypes=network.services.filter(s=>s.operator==='kyotobus'&&s.prototype),services=(await mapLimit(prototypes,2,s=>kyotoService(s,date,day,fetcher))).filter(Boolean);
  if(!services.length)throw Error('京都バスの公式時刻表fallbackを生成できませんでした。');
  return feed('kyotobus',date,services,'京都バス 公式時刻表・便別停留所時刻','official_trip_times');
}
export async function buildOfficialFallback(env,operator,date){if(operator==='citybus')return buildCityBusFallback(env,date);if(operator==='kyotobus')return buildKyotoBusFallback(env,date);throw Error('公式時刻表fallbackの対象外です。');}
export async function readOfficialFallback(env,operator,date,{force=false}={}){
  const key=`static:fallback:${operator}:${date}`,raw=!force?await env.LIVE_KV?.get(key):null;if(raw){try{return JSON.parse(raw);}catch{}}
  const value=await buildOfficialFallback(env,operator,date);if(env.LIVE_KV)await env.LIVE_KV.put(key,JSON.stringify(value),{expirationTtl:CACHE_TTL});return value;
}
