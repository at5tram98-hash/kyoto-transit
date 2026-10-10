import {normalize} from './network.js';
import {planRoutes} from './router.js';

const aliases=s=>[s.name,s.fullName,...(s.aliases??[])].filter(Boolean).map(normalize);
export function mergeTimetableFeeds(base,feeds){
  const index=new Map();for(const s of base.stops.values())for(const n of aliases(s))if(!index.has(n))index.set(n,s.id);
  const services=[];const sourceMeta=[];
  for(const feed of feeds.filter(Boolean)){
    const map=new Map();for(const s of feed.stops??[]){const native=base.stops.get(s.id),id=native&&aliases(native).includes(normalize(s.name))?s.id:index.get(normalize(s.name));if(id)map.set(s.id,id);}
    for(const service of feed.services??[]){
      const mapped=[];for(let i=0;i<service.stops.length;i++){const id=map.get(service.stops[i]);if(!id)continue;if(mapped.at(-1)?.id===id)continue;mapped.push({id,index:i});}
      if(mapped.length<2)continue;const positions=mapped.map(x=>x.index),dedup=mapped.map(x=>x.id);
      const trips=(service.trips??[]).map(t=>({id:t.id,date:t.date,arrivals:positions.map(i=>t.arrivals[i]),departures:positions.map(i=>t.departures[i]),headsign:t.headsign})).filter(t=>t.arrivals.length===dedup.length&&t.arrivals.every(Number.isFinite)&&t.departures.every(Number.isFinite));
      if(!trips.length)continue;services.push({...service,stops:dedup,trips,prototype:false});
    }
    if(feed.meta)sourceMeta.push(feed.meta);
  }
  return {...base,services,mode:'timetable',source:'静的時刻表',validDates:[...new Set(feeds.flatMap(f=>f?.validDates??[]))],feedMeta:sourceMeta};
}
const sig=r=>r.legs.map(l=>`${l.kind}:${l.from}:${l.to}:${l.depart}:${l.serviceId??''}`).join('|');
export function selectThree(routes,{timeMode='departure'}={}){
  if(!routes.length)return [];const unique=[...new Map(routes.map(r=>[sig(r),r])).values()],pool=unique.map(r=>({...r,key:sig(r)})),chosen=[];
  const pick=(label,sorter)=>{const r=[...pool].filter(x=>!chosen.some(c=>c.key===x.key)).sort(sorter)[0];if(r)chosen.push({...r,optionLabel:label});};
  pick('早い',timeMode==='arrival'?(a,b)=>a.duration-b.duration||b.start-a.start:(a,b)=>a.time-b.time||a.transfers-b.transfers);
  pick('安い',(a,b)=>(a.fare.additional??Infinity)-(b.fare.additional??Infinity)||(a.fare.normal??Infinity)-(b.fare.normal??Infinity)||a.time-b.time);
  pick('乗換少',(a,b)=>a.transfers-b.transfers||(timeMode==='arrival'?b.start-a.start:a.time-b.time));
  while(chosen.length<3&&chosen.length<pool.length)pick(`候補${chosen.length+1}`,(a,b)=>timeMode==='arrival'?b.start-a.start:a.time-b.time);
  return chosen;
}
function firstDepartureCandidates(network,request,window=360){
  const values=new Set(),min=request.start-window,max=request.start;
  const addAt=(stop,offset=0)=>{for(const service of network.services){const i=service.stops.indexOf(stop);if(i<0)continue;for(const trip of service.trips??[]){if(trip.date!==request.date)continue;const d=trip.departures[i]-offset;if(d>=min&&d<=max)values.add(Math.max(0,d));}}};
  addAt(request.from,0);for(const walk of network.walks.filter(w=>w.from===request.from&&w.minutes<=request.maxWalk))addAt(walk.to,walk.minutes);
  return [...values].sort((a,b)=>b-a).slice(0,64);
}
function actualJourneyStart(route,fallback){const first=route.legs?.[0];return Number.isFinite(first?.depart)?first.depart:fallback;}
export function searchTimetable(network,request,passes){
  if(request.timeMode!=='arrival')return selectThree(planRoutes(network,request,passes),{timeMode:'departure'});
  const target=request.start,found=[];for(const start of firstDepartureCandidates(network,request)){const routes=planRoutes(network,{...request,start,timeMode:'departure'},passes);for(const r of routes)if(r.time<=target){const actualStart=actualJourneyStart(r,start);found.push({...r,start:actualStart,duration:Math.ceil(r.time-actualStart)});}}
  return selectThree(found,{timeMode:'arrival'});
}
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
export function staleWarnings(network){return [...new Set((network.feedMeta??[]).filter(m=>m.stale||m.warning).map(m=>m.warning??`${m.operator}の時刻データを確認してください。`))];}
export function dayKind(date,{holidays=new Set()}={}){if(holidays.has(date))return 'holiday';const d=new Date(`${date}T00:00:00Z`).getUTCDay();return d===0?'holiday':d===6?'saturday':'weekday';}
