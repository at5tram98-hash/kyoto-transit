import {normalize} from './network.js';

// Exact coordinates stay in memory. Only a supported stop ID is sent when searching.
export function distance(a,b){
  const r=Math.PI/180,x=(b.lng-a.lng)*r*Math.cos((a.lat+b.lat)*r/2),y=(b.lat-a.lat)*r;
  return 6371000*Math.hypot(x,y);
}
export function segmentDistance(p,a,b){
  const scale=111195,cos=Math.cos(p.lat*Math.PI/180),x=(a.lng-p.lng)*scale*cos,y=(a.lat-p.lat)*scale,
    dx=(b.lng-a.lng)*scale*cos,dy=(b.lat-a.lat)*scale,t=Math.max(0,Math.min(1,-(x*dx+y*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(x+t*dx,y+t*dy);
}
export function locate(fix,geo,network,now=Date.now()){
  if(!fix||![fix.lat,fix.lng,fix.accuracy,fix.timestamp].every(Number.isFinite)||Math.abs(fix.lat)>90||Math.abs(fix.lng)>180||fix.accuracy<0||now-fix.timestamp>45000||fix.timestamp>now+5000)return {status:'unavailable'};
  const stops=geo.stops.filter(s=>network.stops.has(s.id)).map(s=>({...s,meters:distance(fix,s)})).sort((a,b)=>a.meters-b.meters);
  const rail=stops.find(s=>['subway','kintetsu'].includes(network.stops.get(s.id).type)),bus=stops.find(s=>network.stops.get(s.id).type==='citybus');
  if(!rail||!bus||Math.min(rail.meters,bus.meters)>5000)return {status:'outside',rail,bus};
  if(fix.accuracy>100)return {status:'uncertain',rail,bus,accuracy:fix.accuracy};
  const nearLine=geo.lines.some(l=>l.points.some((p,i)=>i&&segmentDistance(fix,{lat:l.points[i-1][1],lng:l.points[i-1][0]},{lat:p[1],lng:p[0]})<Math.max(70,fix.accuracy)));
  if(!nearLine&&bus.meters>5000)return {status:'outside',rail,bus};
  return {status:nearLine?'rail':'bus',rail,bus,accuracy:fix.accuracy};
}
const simplified=n=>normalize(String(n).replace(/\([^)]*\)|（[^）]*）|駅前$/g,'').replaceAll('松ケ崎','松ヶ崎'));
export function timedStops(leg,network){
  const find=name=>[...network.stops.values()].find(s=>(s.type===leg.operator||leg.operator==='kintetsu'&&s.id==='K15')&&[s.name,...s.aliases].some(n=>simplified(n)===simplified(name)))?.id;
  return [{id:leg.from,name:network.stops.get(leg.from)?.name,time:leg.depart},...(leg.intermediate??[]).map(s=>({id:find(s.name),name:s.name,time:s.time})),{id:leg.to,name:network.stops.get(leg.to)?.name,time:leg.arrive}].filter(s=>s.id&&Number.isFinite(s.time));
}
export function trainKey(route){return JSON.stringify(route.legs.filter(l=>l.kind==='ride').map(l=>[l.from,l.to,l.depart,l.arrive,l.label,l.destination]));}
export function meetingPoints(friend,network){
  const seen=new Set(),points=[];
  friend.legs.forEach((leg,index)=>{
    if(!['subway','kintetsu'].includes(leg.operator))return;
    for(const p of timedStops(leg,network).slice(0,-1))if(!seen.has(p.id)){seen.add(p.id);points.push({...p,legIndex:index,sharedMinutes:friend.legs.filter((l,i)=>i>=index&&['subway','kintetsu'].includes(l.operator)).reduce((n,l,i)=>n+l.minutes-(i===0?p.time-leg.depart:0),0)});}
  });
  return points.sort((a,b)=>b.sharedMinutes-a.sharedMinutes||a.time-b.time);
}
export function feasibleMeeting(point,route,buffer,wait=0){
  const available=point.time-route.time,required=Math.max(buffer,wait);
  return available>=required?{point,route,available,required,slack:available-required}:null;
}
export function nextStop(leg,network,minute){return timedStops(leg,network).find(s=>s.time>minute)??null;}
export function trainCandidates(routes,fix,previous,geo,network,minute,now=Date.now()){
  if(locate(fix,geo,network,now).status!=='rail')return [];
  return routes.flatMap((r,routeIndex)=>r.legs.filter(l=>['subway','kintetsu'].includes(l.operator)&&minute>=l.depart-2&&minute<=l.arrive).map(leg=>{
    const points=timedStops(leg,network),before=[...points].reverse().find(s=>s.time<=minute),after=points.find(s=>s.time>=minute),a=geo.stops.find(s=>s.id===before?.id),b=geo.stops.find(s=>s.id===after?.id);
    if(!a||!b||segmentDistance(fix,a,b)>Math.max(180,fix.accuracy))return null;
    if(previous&&now-previous.timestamp<45000&&distance(previous,fix)>60&&distance(previous,b)+30<distance(fix,b))return null;
    return {routeIndex,leg,next:nextStop(leg,network,minute)};
  }).filter(Boolean));
}
export function schoolRequest(r){
  if(r.to!=='ksu')return r;
  if(['K01','kyotobus-kokusai'].includes(r.from)&&!r.via.length)return r;
  const via=r.via.filter(v=>v.stop!=='K01');
  if(via.length>=3)throw Error('京都産大行きは国際会館経由が必須です。ほかの経由地を2か所までにしてください。');
  return {...r,via:[...via,{stop:'K01',dwell:0,exitGate:false}]};
}
