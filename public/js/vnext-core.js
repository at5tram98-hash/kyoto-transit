import {subwayIds} from './network.js';

export const CITY_ROUTES=['10','13','43','46','78','93','202','204','205','206','208'];
export const KYOTO_ROUTES=['40','特40','直行40','臨時'];
export const ALL_ROUTE_LABELS=[...CITY_ROUTES,...KYOTO_ROUTES];

export const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export const normalizeMinute=n=>{let v=Number(n);while(v<0)v+=1440;return v;};
export const formatMinute=n=>{if(!Number.isFinite(n))return '—';const day=Math.floor(n/1440),m=((Math.round(n)%1440)+1440)%1440,h=Math.floor(m/60),mm=String(m%60).padStart(2,'0');return `${day>0?'翌日 ':''}${String(h).padStart(2,'0')}:${mm}`;};

export function chooseNearbyGuide({rail,bus},railLimit=350,busLimit=350){
  const railOk=rail&&Number.isFinite(rail.meters)&&rail.meters<=railLimit;
  const busOk=bus&&Number.isFinite(bus.meters)&&bus.meters<=busLimit;
  if(!railOk)return busOk?{kind:'bus',...bus}:null;
  if(!busOk)return {kind:'rail',...rail};
  return rail.meters<=bus.meters?{kind:'rail',...rail}:{kind:'bus',...bus};
}
const directionIds=(fromId,direction)=>{const i=subwayIds.indexOf(fromId);if(i<0)return [];if(direction==='north')return subwayIds.slice(0,i+1).reverse();if(direction==='south')return subwayIds.slice(i);return [];};
export function buildSubwayTrip({fromId,direction,depart,network,stepMinutes=2}){const ids=directionIds(fromId,direction);if(ids.length<2||!Number.isFinite(depart))return null;const stops=ids.map((id,index)=>({id,name:network?.stops?.get(id)?.name??id,time:depart+index*stepMinutes,arrival:depart+index*stepMinutes,departure:depart+index*stepMinutes,estimated:index>0})),destination=stops.at(-1).name;return {kind:'ride',operator:'subway',category:'local',label:'地下鉄烏丸線',destination,from:fromId,to:ids.at(-1),depart,arrive:stops.at(-1).time,minutes:stops.at(-1).time-depart,officialStops:stops,fullTerminus:true,syntheticTimes:true,direction};}
export function buildCityBusTrip({route,currentStopId,previousStopId=null,direction='forward',network,minute,destination=null}){
  const services=(network?.services??[]).filter(s=>s.operator==='citybus'&&String(s.route)===String(route)),candidates=[];
  for(const service of services){const indexes=service.stops.map((id,i)=>id===currentStopId?i:-1).filter(i=>i>=0);for(const index of indexes){const ids=service.stops.slice(index);if(ids.length<2)continue;const stops=ids.map((id,i)=>({id,name:network.stops.get(id)?.name??id,time:minute+i*2,arrival:minute+i*2,departure:minute+i*2,estimated:true})),previousIndex=previousStopId?service.stops.lastIndexOf(previousStopId,index-1):-1,trailScore=previousStopId?(previousIndex>=0?100:-100):0;candidates.push({trailScore,kind:'ride',operator:'citybus',category:'local',route:String(route),label:`市バス ${route}系統`,destination:destination??stops.at(-1).name,from:currentStopId,to:ids.at(-1),depart:minute,arrive:stops.at(-1).time,minutes:stops.at(-1).time-minute,officialStops:stops,fullTerminus:true,syntheticTimes:true,direction,serviceId:service.id});}}
  const chosen=candidates.sort((a,b)=>b.trailScore-a.trailScore||b.officialStops.length-a.officialStops.length)[0]??null;if(chosen)delete chosen.trailScore;return chosen;
}
export function routeIntersection(stopIds,network){const sets=stopIds.map(id=>new Set((network?.stops?.get(id)?.lines??[]).filter(r=>CITY_ROUTES.includes(String(r))))).filter(s=>s.size);if(!sets.length)return [];return [...sets[0]].filter(route=>sets.every(s=>s.has(route)));}
export function directionFromSamples(samples,geo,fromId,nextId,prevId,distanceFn){if(!Array.isArray(samples)||samples.length<2||!geo||typeof distanceFn!=='function')return null;const first=samples[0],last=samples.at(-1),get=id=>geo.stops?.find(s=>s.id===id),next=get(nextId),prev=get(prevId);if(!next&&!prev)return null;const towardNext=next?distanceFn(first,next)-distanceFn(last,next):-Infinity,towardPrev=prev?distanceFn(first,prev)-distanceFn(last,prev):-Infinity;if(Math.max(towardNext,towardPrev)<25)return null;return towardNext>towardPrev?'next':'prev';}
export function projectSubwayTrains({southEntries=[],northEntries=[],nowMinute,network,windowBefore=36,windowAfter=2,stepMinutes=2}){const total=(subwayIds.length-1)*stepMinutes,trains=[];const add=(entry,direction)=>{const depart=entry.depart;if(!Number.isFinite(depart))return;const elapsed=nowMinute-depart;if(elapsed<0||elapsed>total)return;const progress=clamp(elapsed/total,0,1),raw=progress*(subwayIds.length-1);let aIndex=Math.floor(raw),bIndex=Math.min(subwayIds.length-1,aIndex+1);if(direction==='north'){aIndex=subwayIds.length-1-aIndex;bIndex=Math.max(0,aIndex-1);}const a=subwayIds[aIndex],b=subwayIds[bIndex];trains.push({operator:'subway',direction,from:a,to:b,atStation:Math.abs(raw-Math.round(raw))<.12,position:raw,destination:direction==='south'?network.stops.get(subwayIds.at(-1))?.name:network.stops.get(subwayIds[0])?.name,label:'烏丸線',delay:null,estimated:true,depart});};southEntries.filter(e=>e.depart>=nowMinute-windowBefore&&e.depart<=nowMinute+windowAfter).forEach(e=>add(e,'south'));northEntries.filter(e=>e.depart>=nowMinute-windowBefore&&e.depart<=nowMinute+windowAfter).forEach(e=>add(e,'north'));return trains;}
export function remainingStops(ride,nowMinute,shift=0){const stops=ride?.officialStops??[];if(!stops.length)return [];const i=stops.findIndex(s=>Number.isFinite(s.time)&&s.time+shift>=nowMinute-1);return stops.slice(Math.max(0,i<0?stops.length-1:i));}
export function delayLabel(delay,official=false){if(!Number.isFinite(delay))return official?'遅れ情報なし':'遅れ推定なし';const rounded=Math.round(delay);if(Math.abs(rounded)<1)return official?'遅れ表示なし':'ほぼ定刻';return `${official?'':'推定 '}${Math.abs(rounded)}分${rounded>0?'遅れ':'早め'}`;}
