import {subwayIds,kintetsuIds,normalize} from './network.js';

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

const directionIds=(fromId,direction)=>{
  const i=subwayIds.indexOf(fromId);
  if(i<0)return [];
  if(direction==='north')return subwayIds.slice(0,i+1).reverse();
  if(direction==='south')return subwayIds.slice(i);
  return [];
};

export function buildSubwayTrip({fromId,direction,depart,network,stepMinutes=2}){
  const ids=directionIds(fromId,direction);
  if(ids.length<2||!Number.isFinite(depart))return null;
  const stops=ids.map((id,index)=>({id,name:network?.stops?.get(id)?.name??id,time:depart+index*stepMinutes,arrival:depart+index*stepMinutes,departure:depart+index*stepMinutes,estimated:index>0})),destination=stops.at(-1).name;
  return {kind:'ride',operator:'subway',category:'local',label:'地下鉄烏丸線',destination,from:fromId,to:ids.at(-1),depart,arrive:stops.at(-1).time,minutes:stops.at(-1).time-depart,officialStops:stops,fullTerminus:true,syntheticTimes:true,direction};
}

function orderedDirection(ids,axis){
  const points=ids.map(id=>axis.indexOf(id)).filter(i=>i>=0);
  if(points.length<2)return null;
  return points.at(-1)>points[0]?'south':'north';
}

function stopRows(service,trip,network,start=0){
  const rows=[];
  for(let i=start;i<service.stops.length;i++){
    const id=service.stops[i],arrival=trip.arrivals?.[i],departure=trip.departures?.[i],time=Number.isFinite(arrival)?arrival:departure;
    if(!id||!Number.isFinite(time))continue;
    rows.push({id,name:network?.stops?.get(id)?.name??id,time,arrival:Number.isFinite(arrival)?arrival:time,departure:Number.isFinite(departure)?departure:time,estimated:false});
  }
  return rows;
}

export function subwayRideCandidates(feed,{fromId,direction=null,minute,network,windowBefore=9,windowAfter=1}={}){
  if(!feed||!Array.isArray(feed.services)||!Number.isFinite(minute)||!fromId)return [];
  const rows=[];
  for(const service of feed.services){
    if(!['subway','through'].includes(service.operator))continue;
    const fromIndex=service.stops?.indexOf(fromId)??-1;
    if(fromIndex<0)continue;
    const serviceDirection=orderedDirection(service.stops,subwayIds);
    if(!serviceDirection||(direction&&serviceDirection!==direction))continue;
    for(const trip of service.trips??[]){
      const depart=trip.departures?.[fromIndex]??trip.arrivals?.[fromIndex];
      if(!Number.isFinite(depart)||depart<minute-windowBefore||depart>minute+windowAfter)continue;
      const stops=stopRows(service,trip,network,fromIndex);
      if(stops.length<2)continue;
      if(feed.meta?.terminalArrivalDerived&&stops.at(-1)?.id===service.stops.at(-1))stops.at(-1).estimated=true;
      const last=stops.at(-1),arrive=last.arrival??last.time;
      rows.push({kind:'ride',operator:service.operator,category:service.category??'local',label:service.label??'地下鉄烏丸線',destination:trip.headsign??last.name,from:fromId,to:last.id,depart,arrive,minutes:arrive-depart,officialStops:stops,fullTerminus:true,syntheticTimes:false,direction:serviceDirection,serviceId:service.id,tripId:trip.id,timetableSource:'static'});
    }
  }
  return rows.sort((a,b)=>Math.abs(a.depart-minute)-Math.abs(b.depart-minute)||a.depart-b.depart).slice(0,6);
}

function projectSubwayStatic(feed,nowMinute,network){
  const trains=[];
  for(const service of feed?.services??[]){
    if(!['subway','through'].includes(service.operator))continue;
    const direction=orderedDirection(service.stops??[],subwayIds);
    if(!direction)continue;
    for(const trip of service.trips??[]){
      const points=(service.stops??[]).map((id,i)=>({id,axis:subwayIds.indexOf(id),time:trip.departures?.[i]??trip.arrivals?.[i]})).filter(p=>p.axis>=0&&Number.isFinite(p.time));
      if(points.length<2||nowMinute<points[0].time-2||nowMinute>points.at(-1).time+2)continue;
      let a=points[0],b=points[1],position=a.axis,atStation=true;
      if(nowMinute>=points.at(-1).time){a=points.at(-1);b=a;position=a.axis;atStation=true;}
      else if(nowMinute>points[0].time){
        for(let i=0;i<points.length-1;i++)if(nowMinute<=points[i+1].time){a=points[i];b=points[i+1];break;}
        const span=Math.max(.1,b.time-a.time),fraction=clamp((nowMinute-a.time)/span,0,1);position=a.axis+(b.axis-a.axis)*fraction;atStation=Math.min(Math.abs(nowMinute-a.time),Math.abs(nowMinute-b.time))<=.25;
      }
      trains.push({operator:service.operator,direction,from:a.id,to:b.id,atStation,position,destination:trip.headsign??network?.stops?.get(points.at(-1).id)?.name??'',label:service.label??'烏丸線',category:service.category??'local',delay:null,estimated:true,depart:points[0].time,tripId:trip.id,source:'schedule'});
    }
  }
  return trains.sort((a,b)=>a.depart-b.depart).slice(0,40);
}

export function projectSubwayTrains({feed=null,southEntries=[],northEntries=[],nowMinute,network,windowBefore=36,windowAfter=2,stepMinutes=2}){
  if(feed?.services?.length)return projectSubwayStatic(feed,nowMinute,network);
  const total=(subwayIds.length-1)*stepMinutes,trains=[];
  const add=(entry,direction)=>{
    const depart=entry.depart;
    if(!Number.isFinite(depart))return;
    const elapsed=nowMinute-depart;
    if(elapsed<0||elapsed>total)return;
    const progress=clamp(elapsed/total,0,1),raw=progress*(subwayIds.length-1);
    let aIndex=Math.floor(raw),bIndex=Math.min(subwayIds.length-1,aIndex+1);
    if(direction==='north'){aIndex=subwayIds.length-1-aIndex;bIndex=Math.max(0,aIndex-1);}
    const a=subwayIds[aIndex],b=subwayIds[bIndex];
    trains.push({operator:'subway',direction,from:a,to:b,atStation:Math.abs(raw-Math.round(raw))<.12,position:raw,destination:direction==='south'?network.stops.get(subwayIds.at(-1))?.name:network.stops.get(subwayIds[0])?.name,label:'烏丸線',delay:null,estimated:true,depart});
  };
  southEntries.filter(e=>e.depart>=nowMinute-windowBefore&&e.depart<=nowMinute+windowAfter).forEach(e=>add(e,'south'));
  northEntries.filter(e=>e.depart>=nowMinute-windowBefore&&e.depart<=nowMinute+windowAfter).forEach(e=>add(e,'north'));
  return trains;
}

const simpleDestination=value=>normalize(String(value??'').replace(/行き?$|方面|駅$/g,'').replaceAll('大和西大寺','西大寺').replaceAll('近鉄奈良','奈良'));
function destinationPenalty(a,b){const x=simpleDestination(a),y=simpleDestination(b);if(!x||!y)return 2;if(x===y)return 0;if(x.includes(y)||y.includes(x))return 1;return 8;}
function tripTimeAtRailPosition(service,trip,position){
  const points=(service.stops??[]).map((id,i)=>({axis:kintetsuIds.indexOf(id),time:trip.departures?.[i]??trip.arrivals?.[i]})).filter(p=>p.axis>=0&&p.axis<=25&&Number.isFinite(p.time));
  if(points.length<2)return null;
  const min=Math.min(points[0].axis,points.at(-1).axis),max=Math.max(points[0].axis,points.at(-1).axis);
  if(position<min-.5||position>max+.5)return null;
  const exact=points.find(p=>Math.abs(p.axis-position)<.05);if(exact)return exact.time;
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],lo=Math.min(a.axis,b.axis),hi=Math.max(a.axis,b.axis);
    if(position<lo||position>hi||a.axis===b.axis)continue;
    const fraction=(position-a.axis)/(b.axis-a.axis);return a.time+(b.time-a.time)*fraction;
  }
  return null;
}

export function railTimetableEta(feed,train,targetId,nowMinute,{maxError=12,maxMinutes=45}={}){
  if(!feed?.services?.length||!train||!Number.isFinite(train.position)||!Number.isFinite(nowMinute))return null;
  const targetAxis=kintetsuIds.indexOf(targetId),position=(Number(train.position)-1)/2;
  if(targetAxis<0||targetAxis>25||position<-.5||position>25.5)return null;
  const direction=train.direction==='north'?'north':'south',delay=Number.isFinite(train.delay)?train.delay:0,candidates=[];
  for(const service of feed.services){
    if(!['kintetsu','through'].includes(service.operator)||service.category!==train.category)continue;
    const serviceDirection=orderedDirection(service.stops??[],kintetsuIds);
    if(serviceDirection!==direction)continue;
    const targetIndex=service.stops.indexOf(targetId);if(targetIndex<0)continue;
    for(const trip of service.trips??[]){
      const targetArrival=trip.arrivals?.[targetIndex]??trip.departures?.[targetIndex];if(!Number.isFinite(targetArrival))continue;
      const scheduledAtPosition=tripTimeAtRailPosition(service,trip,position);if(!Number.isFinite(scheduledAtPosition))continue;
      const minutes=targetArrival+delay-nowMinute,error=Math.abs(scheduledAtPosition+delay-nowMinute);
      if(minutes<-.5||minutes>maxMinutes||error>maxError)continue;
      const penalty=destinationPenalty(train.dest??train.destination,trip.headsign),score=error+penalty;
      candidates.push({minutes:Math.max(0,minutes),scheduledArrival:targetArrival,delay,matchError:error,headsign:trip.headsign,tripId:trip.id,serviceId:service.id,score});
    }
  }
  return candidates.sort((a,b)=>a.score-b.score||a.minutes-b.minutes)[0]??null;
}

export function buildCityBusTrip({route,currentStopId,previousStopId=null,direction='forward',network,minute,destination=null}){
  const services=(network?.services??[]).filter(s=>s.operator==='citybus'&&String(s.route)===String(route)),candidates=[];
  for(const service of services){
    const indexes=service.stops.map((id,i)=>id===currentStopId?i:-1).filter(i=>i>=0);
    for(const index of indexes){
      const ids=service.stops.slice(index);if(ids.length<2)continue;
      const stops=ids.map(id=>({id,name:network.stops.get(id)?.name??id,time:null,arrival:null,departure:null,estimated:false})),previousIndex=previousStopId?service.stops.lastIndexOf(previousStopId,index-1):-1,trailScore=previousStopId?(previousIndex>=0?100:-100):0;
      candidates.push({trailScore,kind:'ride',operator:'citybus',category:'local',route:String(route),label:`市バス ${route}系統`,destination:destination??stops.at(-1).name,from:currentStopId,to:ids.at(-1),depart:null,arrive:null,minutes:null,officialStops:stops,fullTerminus:true,syntheticTimes:false,direction,serviceId:service.id,observedMinute:Number.isFinite(minute)?minute:null});
    }
  }
  const chosen=candidates.sort((a,b)=>b.trailScore-a.trailScore||b.officialStops.length-a.officialStops.length)[0]??null;if(chosen)delete chosen.trailScore;return chosen;
}

export function routeIntersection(stopIds,network){
  const sets=stopIds.map(id=>new Set((network?.stops?.get(id)?.lines??[]).filter(r=>CITY_ROUTES.includes(String(r))))).filter(s=>s.size);if(!sets.length)return [];return [...sets[0]].filter(route=>sets.every(s=>s.has(route)));
}

export function directionFromSamples(samples,geo,fromId,nextId,prevId,distanceFn){
  if(!Array.isArray(samples)||samples.length<2||!geo||typeof distanceFn!=='function')return null;const first=samples[0],last=samples.at(-1),get=id=>geo.stops?.find(s=>s.id===id),next=get(nextId),prev=get(prevId);if(!next&&!prev)return null;const towardNext=next?distanceFn(first,next)-distanceFn(last,next):-Infinity,towardPrev=prev?distanceFn(first,prev)-distanceFn(last,prev):-Infinity;if(Math.max(towardNext,towardPrev)<25)return null;return towardNext>towardPrev?'next':'prev';
}

export function remainingStops(ride,nowMinute,shift=0){
  const stops=ride?.officialStops??[];if(!stops.length)return [];const i=stops.findIndex(s=>Number.isFinite(s.time)&&s.time+shift>=nowMinute-1);return stops.slice(Math.max(0,i<0?stops.length-1:i));
}

export function delayLabel(delay,official=false){
  if(!Number.isFinite(delay))return official?'遅れ情報なし':'遅れ推定なし';const rounded=Math.round(delay);if(Math.abs(rounded)<1)return official?'遅れ表示なし':'ほぼ定刻';return `${official?'':'推定 '}${Math.abs(rounded)}分${rounded>0?'遅れ':'早め'}`;
}
