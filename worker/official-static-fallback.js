import catalog from '../public/data/bus-catalog.json' with {type:'json'};
import {createNetwork,normalize} from '../public/js/network.js';
import {calendarDay} from './service-calendar.js';
import {officialFetcher,officialText,parseCityCatalog,parseHyperdia,parseKyotoSchedules,kyotoEntries} from './timetables.js';

const network=createNetwork(catalog);
const CACHE_TTL=172800;
const PARTIAL_TTL=300;
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
  const now=new Date().toISOString();
  return {schemaVersion:1,source,revisionDate:date,lastUpdated:now,validDates:[date],stops:stopIds.map(stopRecord).filter(Boolean),services,walks:[],meta:{operator,source:'official_fallback',fallback:true,precision,stale:false,warning:null,lastUpdated:now}};
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
export function groupCityServices(services=[]){
  const grouped=new Map();
  for(const service of services){const route=String(service.route??'');if(!route)continue;if(!grouped.has(route))grouped.set(route,[]);grouped.get(route).push(service);}
  return [...grouped].map(([route,items])=>({route,services:items}));
}
async function parsedBoard(board,fetcher,timetableCache){
  let value=timetableCache.get(board.sourceURL);
  if(!value){value=officialText(board.sourceURL,fetcher,1800).then(parseHyperdia);timetableCache.set(board.sourceURL,value);}
  return value;
}
async function cityServiceFromRows(service,date,day,fetcher,rows,timetableCache){
  const anchorId=service.stops[0],anchor=network.stops.get(anchorId),next=network.stops.get(service.stops[1]);if(!anchor||!next)return null;
  const row=rows.find(r=>normalize(r.name)===normalize(cleanName(anchor)));if(!row?.boards?.length)return null;
  const board=chooseCityBoard(row.boards,cleanName(next),service.id.endsWith('-up'));if(!board)return null;
  const parsed=await parsedBoard(board,fetcher,timetableCache),entries=parsed.days?.[day]??[],trips=offsetTrips(entries,service,date);if(!trips.length)return null;
  return {id:`official-${service.id}`,label:service.label,operator:'citybus',route:String(service.route),category:'local',stops:service.stops,trips,officialFallback:true,sourceURL:board.sourceURL};
}
async function recordCityRouteError(env,route,service,error){
  if(!env.LIVE_KV)return;await env.LIVE_KV.put(`diag:static:citybus:${route}:${service}`,JSON.stringify({operator:'citybus',route,service,error:String(error?.message??error),at:new Date().toISOString()}),{expirationTtl:604800});
}
async function readCityRouteFallback(env,route,services,date,day,fetcher){
  const key=`static:fallback:citybus-route:${route}:${date}`,raw=await env.LIVE_KV?.get(key);if(raw){try{const saved=JSON.parse(raw);if(Array.isArray(saved.services)&&saved.services.length)return saved;}catch{}}
  const source=catalog[route]?.source;if(!source)throw Error(`市バス${route}系統の公式時刻表URLがありません。`);
  const rows=parseCityCatalog(await officialText(source,fetcher,3600),source),timetableCache=new Map(),built=[],failed=[];
  for(const service of services){try{const value=await cityServiceFromRows(service,date,day,fetcher,rows,timetableCache);if(value)built.push(value);else failed.push(service.id);}catch(error){failed.push(service.id);await recordCityRouteError(env,route,service.id,error);}}
  if(!built.length)throw Error(`市バス${route}系統の公式時刻表fallbackを生成できませんでした。`);
  const value={route,date,services:built,expectedServices:services.length,availableServices:built.length,failed,capturedAt:new Date().toISOString()};
  if(env.LIVE_KV)await env.LIVE_KV.put(key,JSON.stringify(value),{expirationTtl:failed.length?PARTIAL_TTL:CACHE_TTL});return value;
}
export async function buildCityBusFallback(env,date,fetcher=officialFetcher(env)){
  const day=calendarDay(date,'citybus');if(!day)throw Error('市バスの運行日区分を確認できません。');
  const prototypes=network.services.filter(s=>s.operator==='citybus'&&s.prototype),groups=groupCityServices(prototypes),routeResults=[];
  // 京都市公式サイトへの負荷と一時的な取得失敗を抑えるため、系統単位で順番に取得する。
  for(const group of groups){try{routeResults.push(await readCityRouteFallback(env,group.route,group.services,date,day,fetcher));}catch(error){await recordCityRouteError(env,group.route,'route',error);}}
  const services=routeResults.flatMap(r=>r.services??[]);if(!services.length)throw Error('京都市バスの公式時刻表fallbackを生成できませんでした。');
  const value=feed('citybus',date,services,'京都市交通局 公式停留所時刻表（区間所要時間は路線順序から補完）','official_departures_with_segment_completion');
  value.meta.expectedRoutes=groups.length;value.meta.availableRoutes=routeResults.length;value.meta.expectedServices=prototypes.length;value.meta.availableServices=services.length;value.meta.partial=routeResults.length<groups.length||services.length<prototypes.length;value.meta.failedRoutes=groups.map(g=>g.route).filter(route=>!routeResults.some(r=>r.route===route));
  return value;
}
function kyotoRouteMatch(route,value){const text=String(value??'').normalize('NFKC');return route==='臨時'?/^臨時/.test(text):/^(?:特|直行)?40$/.test(text);}
function chooseKyotoBoard(boards=[],route,targetName=''){
  const target=normalize(targetName),eligible=boards.filter(b=>(b.routes??[]).some(r=>kyotoRouteMatch(route,r)));if(!eligible.length)return null;
  return eligible.map((board,index)=>({board,index,score:target&&normalize(board.label??'').includes(target)?10:0})).sort((a,b)=>b.score-a.score||a.index-b.index)[0]?.board??null;
}
const KYOTO_DIRECT_BOARDS={
  'kyotobus-40-down':'https://www.kyotobus.jp/route/timetable/schedule.html?stop_id=91_3',
  'kyotobus-40-up':'https://www.kyotobus.jp/route/timetable/schedule.html?stop_id=7475_1',
  'kyotobus-marutamachi-temp-down':'https://www.kyotobus.jp/route/timetable/schedule.html?stop_id=51_2',
  'kyotobus-marutamachi-temp-up':'https://www.kyotobus.jp/route/timetable/schedule.html?stop_id=152_1'
};
function kyotoDayEntries(days,day){const selected=day==='holiday'?'sunday':day==='weekday'?(days.weekday?'weekday':null):day;return selected?days[selected]??[]:[];}
async function kyotoBoardDays(env,service,fetcher){
  const sourceURL=KYOTO_DIRECT_BOARDS[service.id];if(!sourceURL)return null;
  const key=`static:kyotobus-board:${service.id}`,raw=await env.LIVE_KV?.get(key);if(raw){try{return JSON.parse(raw);}catch{}}
  const html=await officialText(sourceURL,fetcher,3600),{boot}=parseKyotoSchedules(html),schedule=boot.master_current??Object.values(boot)[0];if(!schedule)return null;
  const value={sourceURL,days:kyotoEntries(schedule),effective:schedule.start_date??null,capturedAt:new Date().toISOString()};if(env.LIVE_KV)await env.LIVE_KV.put(key,JSON.stringify(value),{expirationTtl:604800});return value;
}
async function kyotoService(env,service,date,day,fetcher){
  const board=await kyotoBoardDays(env,service,fetcher);if(!board)return null;const entries=kyotoDayEntries(board.days,day).filter(e=>kyotoRouteMatch(service.route,e.route)),trips=offsetTrips(entries,service,date);if(!trips.length)return null;
  return {id:`official-${service.id}`,label:service.label,operator:'kyotobus',route:String(service.route),category:'local',stops:service.stops,trips,officialFallback:true,sourceURL:board.sourceURL};
}
export async function buildKyotoBusFallback(env,date,fetcher=officialFetcher(env)){
  const day=calendarDay(date,'kyotobus');if(!day)throw Error('京都バスの運行日区分を確認できません。');
  const prototypes=network.services.filter(s=>s.operator==='kyotobus'&&s.prototype).sort((a,b)=>Number(!a.id.startsWith('kyotobus-40'))-Number(!b.id.startsWith('kyotobus-40'))),services=(await mapLimit(prototypes,1,s=>kyotoService(env,s,date,day,fetcher))).filter(Boolean);
  if(!services.length)throw Error('京都バスの公式時刻表fallbackを生成できませんでした。');
  const value=feed('kyotobus',date,services,'京都バス 公式時刻表（区間所要時間は路線順序から補完）','official_departures_with_segment_completion');value.meta.partial=services.length<prototypes.length;value.meta.expectedServices=prototypes.length;value.meta.availableServices=services.length;return value;
}
export async function buildOfficialFallback(env,operator,date){if(operator==='citybus')return buildCityBusFallback(env,date);if(operator==='kyotobus')return buildKyotoBusFallback(env,date);throw Error('公式時刻表fallbackの対象外です。');}
export async function readOfficialFallback(env,operator,date,{force=false}={}){
  const key=`static:fallback:${operator}:${date}`,raw=!force?await env.LIVE_KV?.get(key):null;if(raw){try{return JSON.parse(raw);}catch{}}
  const value=await buildOfficialFallback(env,operator,date);if(env.LIVE_KV)await env.LIVE_KV.put(key,JSON.stringify(value),{expirationTtl:value.meta?.partial?PARTIAL_TTL:CACHE_TTL});return value;
}
