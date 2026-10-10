import {summarizeFares} from './fares.js';

class Heap {
  list=[];
  push(item){let i=this.list.push(item)-1;while(i>0){const p=(i-1)>>1;if(this.list[p].score<=item.score)break;this.list[i]=this.list[p];i=p;}this.list[i]=item;}
  pop(){const top=this.list[0],end=this.list.pop();if(this.list.length){let i=0;while(i*2+1<this.list.length){let c=i*2+1;if(c+1<this.list.length&&this.list[c+1].score<this.list[c].score)c++;if(this.list[c].score>=end.score)break;this.list[i]=this.list[c];i=c;}this.list[i]=end;}return top;}
  get size(){return this.list.length;}
}
const weights={fast:[0,0,0],transfers:[18,0,0],wait:[0,1.5,0],walk:[0,0,4]};
export function buildIndex(network) {
  const rides=new Map(),walks=new Map();
  for(const service of network.services)service.stops.forEach((id,index)=>{
    if(index<service.stops.length-1){if(!rides.has(id))rides.set(id,[]);rides.get(id).push({service,index});}
  });
  for(const walk of network.walks){if(!walks.has(walk.from))walks.set(walk.from,[]);walks.get(walk.from).push(walk);}
  return {rides,walks};
}
function nextTrips(service,index,ready,date) {
  if(service.trips) {
    return service.trips.filter(t=>t.date===date&&t.departures[index]>=ready).sort((a,b)=>a.departures[index]-b.departures[index]).slice(0,2)
      .map(t=>({tripId:t.id,depart:t.departures[index],arrivals:t.arrivals,departures:t.departures,headsign:t.headsign??null}));
  }
  const offset=service.offsets[index];
  const base=service.first+Math.max(0,Math.ceil((ready-service.first-offset)/service.headway))*service.headway;
  if(base>service.last)return [];
  return [{tripId:`${service.id}@${base}`,depart:base+offset,arrivals:service.offsets.map(x=>base+x),departures:service.offsets.map(x=>base+x),headsign:null}];
}

export function route(network,request,objective='fast',filter=request.trainType??'all',index=buildIndex(network)) {
  const {from,to,date,start,via=[],buffer=3,maxWalk=30}=request;
  if(!network.stops.has(from)||!network.stops.has(to))throw new Error('対応する駅・停留所を選択してください。');
  if(from===to&&!via.length)throw new Error('出発地と到着地が同じです。折り返す場合は経由地を追加してください。');
  if(!Number.isFinite(start)||!Number.isFinite(buffer)||buffer<1||buffer>15)throw new Error('時刻または乗換余裕を確認してください。');
  for(const v of via)if(!network.stops.has(v.stop)||!Number.isFinite(v.dwell)||v.dwell<0||v.dwell>180)throw new Error('経由地・滞在時間を確認してください。');
  if(network.mode==='timetable'&&network.validDates&&!network.validDates.includes(date))return null;
  const targets=[...via.map(v=>v.stop),to];
  const coeff=weights[objective]??weights.fast;
  const score=s=>s.time-start+Math.max(0,s.boardings-1)*coeff[0]+s.wait*coeff[1]+s.walk*coeff[2];
  const queue=new Heap(),labels=new Map();
  queue.push({stop:from,stage:0,time:start,boardings:0,wait:0,walk:0,legs:[],lastTrip:null,score:0});
  const horizon=start+600;
  let loops=0;
  while(queue.size&&loops++<100000){
    let s=queue.pop();
    if(s.time>horizon||s.boardings>9)continue;
    if(s.stop===targets[s.stage]){
      if(s.stage===targets.length-1)return {...s,start,objective,filter,date,sourceMode:network.mode};
      const v=via[s.stage];
      s={...s,stage:s.stage+1,time:s.time+v.dwell,lastTrip:null,
        legs:[...s.legs,{kind:'dwell',from:s.stop,to:s.stop,depart:s.time,arrive:s.time+v.dwell,minutes:v.dwell,exitGate:Boolean(v.exitGate)}]};
      s.score=score(s);
    }
    const key=`${s.stop}:${s.stage}`;
    const retained=labels.get(key)??[];
    const dominates=(a,b)=>a.time<=b.time&&a.score<=b.score&&a.boardings<=b.boardings&&a.walk<=b.walk;
    if(retained.some(x=>dominates(x,s)))continue;
    const next=[...retained.filter(x=>!dominates(s,x)),s].sort((a,b)=>a.score-b.score).slice(0,6);
    if(!next.includes(s))continue;
    labels.set(key,next);
    for(const walk of index.walks.get(s.stop)??[]){
      if(s.walk+walk.minutes>maxWalk||(s.legs.at(-1)?.kind==='walk'&&s.legs.at(-1).from===walk.to))continue;
      const n={...s,stop:walk.to,time:s.time+walk.minutes,walk:s.walk+walk.minutes,lastTrip:null,
        legs:[...s.legs,{...walk,kind:'walk',depart:s.time,arrive:s.time+walk.minutes}]};
      n.score=score(n);queue.push(n);
    }
    for(const {service,index:i} of index.rides.get(s.stop)??[]){
      if(filter!=='all'&&['kintetsu','through'].includes(service.operator)&&service.category!==filter)continue;
      const ready=s.time+(s.boardings?buffer:0);
      for(const trip of nextTrips(service,i,ready,date)) {
        if(trip.tripId===s.lastTrip)continue;
        for(let j=i+1;j<service.stops.length;j++){
          if(j>i+1&&service.stops[j-1]===targets[s.stage])break;
          const n={...s,stop:service.stops[j],time:trip.arrivals[j],boardings:s.boardings+1,
            wait:s.wait+trip.depart-s.time,lastTrip:trip.tripId,
            legs:[...s.legs,{kind:'ride',from:s.stop,to:service.stops[j],depart:trip.depart,arrive:trip.arrivals[j],
              serviceId:service.id,tripId:trip.tripId,operator:service.operator,label:service.label,category:service.category,
              route:service.route,destination:trip.headsign,through:service.through,path:service.stops.slice(i,j+1),
              times:trip.arrivals.slice(i,j+1),direction:service.stops.at(-1),platform:service.platforms?.[i]??null,
              platformSource:service.platforms?.[i]?'imported':null}]};
          if(n.time<=s.time)continue;
          n.score=score(n);queue.push(n);
        }
      }
    }
  }
  if(queue.size)throw new Error('探索上限に達しました。経由地を分けて検索してください。');
  return null;
}

export function planRoutes(network,request,passes) {
  const results=[],seen=new Set(),index=buildIndex(network);
  for(const objective of ['fast','transfers','wait','walk']){
    const candidate=route(network,request,objective,request.trainType,index);
    if(candidate){const key=signature(candidate);if(!seen.has(key)){seen.add(key);results.push(enrich(candidate,network,passes));}}
  }
  if(request.trainType==='all')for(const type of ['local','express']){
    const candidate=route(network,request,'fast',type,index);
    if(candidate){const key=signature(candidate);if(!seen.has(key)){seen.add(key);results.push(enrich(candidate,network,passes));}}
  }
  return results.sort((a,b)=>a.time-b.time);
}
function signature(r){return r.legs.map(l=>`${l.kind}/${l.from}/${l.to}/${l.serviceId??''}/${l.depart}`).join('|');}
function enrich(r,network,passes){return {...r,transfers:Math.max(0,r.boardings-1),duration:Math.ceil(r.time-r.start),fare:summarizeFares(r.legs,network,passes,r.date)};}
export function formatTime(minutes){const m=Math.round(minutes),day=Math.floor(m/1440);return `${day?'翌日 ':''}${String(Math.floor((m%1440)/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;}
