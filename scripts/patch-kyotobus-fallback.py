from pathlib import Path

p=Path('worker/timetables.js')
s=p.read_text()
old="const r=await env.BROWSER.quickAction('content',{url:u.href,gotoOptions:{waitUntil:'networkidle2',timeout:20000},actionTimeout:12000});"
new="const r=await env.BROWSER.quickAction('content',{url:u.href,gotoOptions:{waitUntil:'domcontentloaded',timeout:30000},waitForSelector:{selector:'body',visible:true,timeout:20000},actionTimeout:30000});"
if old not in s:
    raise SystemExit('Kyoto Bus Browser Rendering call not found')
p.write_text(s.replace(old,new,1))

p=Path('worker/official-static-fallback.js')
s=p.read_text()
s=s.replace("import {officialFetcher,officialText,parseCityCatalog,parseHyperdia,timetableOptions,readTimetable,timeNumber} from './timetables.js';","import {officialFetcher,officialText,parseCityCatalog,parseHyperdia,parseKyotoSchedules,kyotoEntries} from './timetables.js';",1)
old="""function timedSequence(board,entry,detail){
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
}"""
new="""const KYOTO_DIRECT_BOARDS={
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
}"""
if old not in s:
    raise SystemExit('legacy Kyoto Bus fallback block not found')
s=s.replace(old,new,1)
old="const value=await buildOfficialFallback(env,operator,date);if(env.LIVE_KV)await env.LIVE_KV.put(key,JSON.stringify(value),{expirationTtl:CACHE_TTL});return value;"
new="const value=await buildOfficialFallback(env,operator,date);if(env.LIVE_KV)await env.LIVE_KV.put(key,JSON.stringify(value),{expirationTtl:value.meta?.partial?300:CACHE_TTL});return value;"
if old not in s:
    raise SystemExit('fallback cache write not found')
p.write_text(s.replace(old,new,1))
