import {unzipEntries,textEntry} from './zip.js';

const CITY_ROUTES=new Set(['10','13','43','46','78','93','202','204','205','206','208']);
const TEMP_WORDS=/臨時|特別|増発|オープンキャンパス|イベント|千灯|千日|運休|通過|迂回/;
const dateISO=s=>{const m=String(s??'').match(/(20\d{2})[年\/.\-]?\s*(\d{1,2})[月\/.\-]?\s*(\d{1,2})/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:null;};
const compactDate=s=>{const m=String(s??'').match(/(20\d{2})(\d{2})(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:dateISO(s);};
const cmpDate=(a,b)=>String(a??'').localeCompare(String(b??''));
const inRange=(date,start,end)=>(!start||date>=start)&&(!end||date<=end);

export function selectGtfsVersion(candidates,date){
  const active=candidates.filter(c=>c?.url&&inRange(date,c.effectiveFrom,c.effectiveTo)&&(!c.versionDate||c.versionDate<=date));
  return active.sort((a,b)=>Number(Boolean(b.temporary))-Number(Boolean(a.temporary))||cmpDate(b.effectiveFrom,a.effectiveFrom)||cmpDate(b.versionDate,a.versionDate)||cmpDate(b.updatedAt,a.updatedAt))[0]??null;
}
export function parseResourcePage(html,resourceURL=''){
  const decoded=String(html).replace(/&amp;/g,'&').replace(/&#x2F;/gi,'/').replace(/&quot;/g,'"');
  const text=decoded.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  const title=(decoded.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]??decoded.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  const versionDate=compactDate(title)||compactDate(text);
  const range=text.match(/有効期間\s*[:：]\s*([^〜~]{4,40})\s*[〜~]\s*([^。<]{4,40})/),effectiveFrom=range?dateISO(range[1]):versionDate,effectiveTo=range?dateISO(range[2]):null;
  let url=decoded.match(/https:\/\/api\.odpt\.org\/api\/v4\/files\/[^"'<>\s]+?\.zip(?:\?[^"'<>\s]*)?/i)?.[0]??null;
  if(url)url=url.replace(/&amp;/g,'&');
  return {resourceURL,title,versionDate,effectiveFrom,effectiveTo,updatedAt:versionDate,temporary:TEMP_WORDS.test(text),url,description:text.slice(0,800)};
}
export function datasetResourceLinks(html,base){const out=[],seen=new Set();for(const m of String(html).matchAll(/href="([^"]*\/resource\/[^"]+)"/gi)){const u=new URL(m[1].replace(/&amp;/g,'&'),base).href;if(!seen.has(u)){seen.add(u);out.push(u);}}return out;}

export function parseCSV(text){
  const rows=[];let row=[],cell='',quoted=false;const push=()=>{row.push(cell);cell='';},finish=()=>{push();if(row.some(v=>v!==''))rows.push(row);row=[];};
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}else if(c==='"')quoted=true;else if(c===',')push();else if(c==='\n')finish();else if(c!=='\r')cell+=c;}if(cell||row.length)finish();if(!rows.length)return [];
  const head=rows[0].map(x=>x.trim());return rows.slice(1).map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]??''])));
}
export function gtfsMinute(value){const m=String(value??'').match(/^(\d{1,2}):(\d{2}):(\d{2})$/);if(!m)return null;return Number(m[1])*60+Number(m[2])+Number(m[3])/60;}
const ymd=s=>String(s??'').replace(/\D/g,'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
const routeAllowed=(operator,r)=>{const short=String(r.route_short_name??'').normalize('NFKC').replace(/\s/g,''),long=String(r.route_long_name??'').normalize('NFKC');if(operator==='citybus')return CITY_ROUTES.has(short);if(operator==='kyotobus')return /(^|[^0-9])40([^0-9]|$)/.test(short)||/^特40$/.test(short)||/直行/.test(short)&&/40|産大|京都産業大学/.test(short+long)||/京都産業大学/.test(long)&&/国際会館|丸太町/.test(long);return true;};
const categoryFor=(operator,r)=>operator==='kintetsu'&&/急行/.test(`${r.route_short_name} ${r.route_long_name}`)?'express':'local';

export async function compactGtfsZip(bytes,{operator,source,version}){
  const entries=await unzipEntries(bytes),stops=parseCSV(textEntry(entries,'stops.txt')),routes=parseCSV(textEntry(entries,'routes.txt')).filter(r=>routeAllowed(operator,r)),routeIds=new Set(routes.map(r=>r.route_id)),trips=parseCSV(textEntry(entries,'trips.txt')).filter(t=>routeIds.has(t.route_id)),tripIds=new Set(trips.map(t=>t.trip_id));
  if(!routes.length||!trips.length)throw Error(`${operator}の対象路線がGTFSにありません。`);
  const times=new Map();for(const s of parseCSV(textEntry(entries,'stop_times.txt'))){if(!tripIds.has(s.trip_id))continue;const a=gtfsMinute(s.arrival_time),d=gtfsMinute(s.departure_time),seq=Number(s.stop_sequence);if(!Number.isFinite(a)||!Number.isFinite(d)||!Number.isFinite(seq))continue;if(!times.has(s.trip_id))times.set(s.trip_id,[]);times.get(s.trip_id).push({stopId:s.stop_id,seq,arrival:a,departure:d,pickup:s.pickup_type||'0',dropoff:s.drop_off_type||'0'});}
  const usedStops=new Set(),shapeIds=new Set();const compactTrips=[];for(const t of trips){const rows=(times.get(t.trip_id)??[]).sort((a,b)=>a.seq-b.seq);if(rows.length<2)continue;rows.forEach(x=>usedStops.add(x.stopId));if(t.shape_id)shapeIds.add(t.shape_id);compactTrips.push({id:t.trip_id,routeId:t.route_id,serviceId:t.service_id,headsign:t.trip_headsign||'',direction:Number(t.direction_id)||0,shapeId:t.shape_id||null,stops:rows.map(x=>x.stopId),arrivals:rows.map(x=>x.arrival),departures:rows.map(x=>x.departure)});}
  if(!compactTrips.length)throw Error(`${operator}の時刻データを軽量化できませんでした。`);
  const stopRows=stops.filter(s=>usedStops.has(s.stop_id)).map(s=>({id:s.stop_id,name:s.stop_name,code:s.stop_code||null,parent:s.parent_station||null,platform:s.platform_code||null,lat:Number(s.stop_lat)||null,lng:Number(s.stop_lon)||null}));
  const routeRows=routes.map(r=>({id:r.route_id,shortName:r.route_short_name||'',longName:r.route_long_name||'',type:Number(r.route_type)||3,category:categoryFor(operator,r)}));
  const calendar=entries.has('calendar.txt')?parseCSV(textEntry(entries,'calendar.txt')).map(c=>({serviceId:c.service_id,start:ymd(c.start_date),end:ymd(c.end_date),week:['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(k=>c[k]==='1')})):[];
  const calendarDates=entries.has('calendar_dates.txt')?parseCSV(textEntry(entries,'calendar_dates.txt')).map(c=>({serviceId:c.service_id,date:ymd(c.date),exception:Number(c.exception_type)})):[];
  const shapes=[];if(entries.has('shapes.txt')&&shapeIds.size){const grouped=new Map();for(const p of parseCSV(textEntry(entries,'shapes.txt'))){if(!shapeIds.has(p.shape_id))continue;if(!grouped.has(p.shape_id))grouped.set(p.shape_id,[]);grouped.get(p.shape_id).push({seq:Number(p.shape_pt_sequence),lat:Number(p.shape_pt_lat),lng:Number(p.shape_pt_lon)});}for(const [id,points] of grouped){points.sort((a,b)=>a.seq-b.seq);const sampled=points.filter((_,i)=>i===0||i===points.length-1||i%4===0).map(p=>[p.lng,p.lat]);shapes.push({id,points:sampled});}}
  const starts=calendar.map(c=>c.start).filter(Boolean).sort(),ends=calendar.map(c=>c.end).filter(Boolean).sort();
  return {schemaVersion:2,operator,source,version,revisionDate:version?.versionDate??null,lastUpdated:new Date().toISOString(),validFrom:starts[0]??null,validTo:ends.at(-1)??null,stops:stopRows,routes:routeRows,trips:compactTrips,calendar,calendarDates,shapes};
}

export function serviceActive(feed,serviceId,date){const exception=feed.calendarDates?.filter(x=>x.serviceId===serviceId&&x.date===date).at(-1);if(exception)return exception.exception===1;const c=feed.calendar?.find(x=>x.serviceId===serviceId);if(!c||date<c.start||date>c.end)return false;const day=new Date(`${date}T00:00:00+09:00`).getDay(),idx=(day+6)%7;return Boolean(c.week[idx]);}
export function dateFeed(feed,date){
  const active=feed.trips.filter(t=>serviceActive(feed,t.serviceId,date)),bySig=new Map(),routes=new Map(feed.routes.map(r=>[r.id,r]));
  for(const t of active){const r=routes.get(t.routeId);if(!r)continue;const sig=`${t.routeId}|${t.stops.join(',')}`;if(!bySig.has(sig))bySig.set(sig,{id:sig,operator:feed.operator,route:r.shortName||r.longName,label:r.shortName||r.longName||feed.operator,category:r.category??'local',stops:t.stops,trips:[]});bySig.get(sig).trips.push({id:t.id,date,arrivals:t.arrivals,departures:t.departures,headsign:t.headsign});}
  return {schemaVersion:1,source:feed.source,revisionDate:feed.revisionDate,lastUpdated:feed.lastUpdated,validDates:[date],stops:feed.stops.map(s=>({...s,type:feed.operator==='citybus'?'citybus':feed.operator==='kyotobus'?'kyotobus':feed.operator})),services:[...bySig.values()],walks:[]};
}
