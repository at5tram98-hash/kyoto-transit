import {normalize} from './network.js';
import {planRoutes} from './router.js';

const aliases=s=>[s.name,s.fullName,...(s.aliases??[])].filter(Boolean).map(normalize);
export function mergeTimetableFeeds(base,feeds){
  const index=new Map();for(const s of base.stops.values())for(const n of aliases(s))if(!index.has(n))index.set(n,s.id);
  const services=[];const sourceMeta=[];
  for(const feed of feeds.filter(Boolean)){
    const feedStops=new Map((feed.stops??[]).map(s=>[s.id,s])),map=new Map();
    for(const s of feed.stops??[]){const id=index.get(normalize(s.name));if(id)map.set(s.id,id);}
    for(const service of feed.services??[]){
      const ids=service.stops.map(id=>map.get(id)).filter(Boolean),dedup=ids.filter((id,i)=>i===0||id!==ids[i-1]);if(dedup.length<2)continue;
      const positions=[];let last=-1;for(const id of dedup){const p=ids.indexOf(id,last+1);positions.push(p);last=p;}
      const trips=(service.trips??[]).map(t=>({id:t.id,date:t.date,arrivals:positions.map(i=>t.arrivals[i]),departures:positions.map(i=>t.departures[i]),headsign:t.headsign})).filter(t=>t.arrivals.every(Number.isFinite)&&t.departures.every(Number.isFinite));
      if(!trips.length)continue;services.push({...service,stops:dedup,trips,prototype:false});
    }
    if(feed.meta)sourceMeta.push(feed.meta);
  }
  return {...base,services,mode:'timetable',source:'静的時刻表',validDates:[...new Set(feeds.flatMap(f=>f?.validDates??[]))],feedMeta:sourceMeta};
}
const sig=r=>r.legs.map(l=>`${l.kind}:${l.from}:${l.to}:${l.depart}:${l.serviceId??''}`).join('|');
export function selectThree(routes){
  if(!routes.length)return [];const pool=routes.map(r=>({...r,key:sig(r)})),chosen=[];
  const pick=(label,sorter)=>{const r=[...pool].filter(x=>!chosen.some(c=>c.key===x.key)).sort(sorter)[0];if(r)chosen.push({...r,optionLabel:label});};
  pick('早い',(a,b)=>a.time-b.time||a.transfers-b.transfers);
  pick('安い',(a,b)=>(a.fare.additional??Infinity)-(b.fare.additional??Infinity)||(a.fare.normal??Infinity)-(b.fare.normal??Infinity)||a.time-b.time);
  pick('乗換少',(a,b)=>a.transfers-b.transfers||a.time-b.time);
  while(chosen.length<3&&chosen.length<pool.length)pick(`候補${chosen.length+1}`,(a,b)=>a.time-b.time);
  return chosen;
}
export function searchTimetable(network,request,passes){return selectThree(planRoutes(network,request,passes));}
const clampDelay=n=>Number.isFinite(n)?Math.max(-5,Math.min(60,n)):null;
export function realtimeDelayForLeg(leg,realtime,{nowMinute}={}){
  if(leg.operator==='kintetsu'||leg.operator==='through'){
    const rows=realtime?.rail?.trains??[],match=rows.find(t=>(!leg.category||t.category===leg.category)&&(!leg.destination||normalize(t.dest??t.destination??'')===normalize(leg.destination??'')));return match&&Number.isFinite(match.delay)?{delay:clampDelay(match.delay),source:match.predicted?'prediction':'live'}:null;
  }
  if(leg.operator==='kyotobus'){
    const rows=realtime?.kyotobus?.vehicles??[],match=rows.find(v=>String(v.route)===String(leg.route));return match&&Number.isFinite(match.delay)?{delay:clampDelay(match.delay),source:match.fresh===false?'prediction':'live'}:null;
  }
  if(leg.operator==='citybus'){
    const rows=realtime?.citybus?.results??[],match=rows.find(r=>String(r.route)===String(leg.route)&&Number.isFinite(r.minutes));if(!match||!Number.isFinite(nowMinute))return null;return {delay:clampDelay(nowMinute+match.minutes-leg.depart),source:match.source==='live'?'live':'prediction'};
  }return null;
}
export function applyRealtime(route,realtime,context={}){
  let shift=0,quality='schedule';const legs=route.legs.map(leg=>{if(leg.kind!=='ride')return {...leg,depart:leg.depart+shift,arrive:leg.arrive+shift};const live=realtimeDelayForLeg(leg,realtime,context);if(live){shift=Math.max(shift,live.delay??0);if(live.source==='live')quality='live';else if(quality!=='live')quality='prediction';}return {...leg,depart:leg.depart+shift,arrive:leg.arrive+shift,realtime:live};});return {...route,legs,time:route.time+shift,duration:route.duration+shift,realtimeSource:quality,realtimeDelay:shift};
}
export function staleWarnings(network){return (network.feedMeta??[]).filter(m=>m.stale||m.warning).map(m=>m.warning??`${m.operator}の時刻データを確認してください。`);}
export function dayKind(date,{holidays=new Set()}={}){if(holidays.has(date))return 'holiday';const d=new Date(`${date}T00:00:00+09:00`).getDay();return d===0?'holiday':d===6?'saturday':'weekday';}
