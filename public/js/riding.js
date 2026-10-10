import {distance,segmentDistance,timedStops} from './mobility.js';
import {normalize,kintetsuIds} from './network.js';
export const rideKey=l=>JSON.stringify([l.operator,l.from,l.to,l.depart,l.arrive,l.label,l.destination]);
export const isBus=l=>['citybus','kyotobus'].includes(l?.operator);
export function alignRideDate(leg,sourceDate,targetDate){const offset=Math.round((Date.parse(sourceDate)-Date.parse(targetDate))/86400000)*1440;return {...leg,depart:leg.depart+offset,arrive:leg.arrive+offset,intermediate:(leg.intermediate??[]).map(s=>({...s,time:Number.isFinite(s.time)?s.time+offset:null}))};}
export function freshFix(f,now=Date.now()){return !!f&&[f.lat,f.lng,f.accuracy,f.timestamp].every(Number.isFinite)&&Math.abs(f.lat)<=90&&Math.abs(f.lng)<=180&&f.accuracy<=100&&f.accuracy>=0&&now-f.timestamp<=45000&&f.timestamp<=now+5000;}
export function trajectory(samples,now=Date.now()){
  const points=samples.filter(f=>freshFix(f,now)).sort((a,b)=>a.timestamp-b.timestamp),speeds=[];
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dt=(b.timestamp-a.timestamp)/1000,d=distance(a,b);if(dt>=2&&dt<=45&&d>Math.max(8,(a.accuracy+b.accuracy)/2))speeds.push(d/dt);}
  const measured=points.at(-1)?.speed;if(Number.isFinite(measured)&&measured>=0)speeds.push(measured);
  speeds.sort((a,b)=>a-b);
  return {points,speed:speeds.length?speeds[Math.floor(speeds.length/2)]:null,span:points.length>1?(points.at(-1).timestamp-points[0].timestamp)/1000:0,heading:points.at(-1)?.heading??null};
}
export function nearbyStops(f,geo,network,limit=3,now=Date.now()){
  if(!freshFix(f,now))return [];
  return geo.stops.filter(s=>network.stops.get(s.id)?.type==='citybus').map(s=>({...s,meters:distance(f,s)})).filter(s=>s.meters<=5000).sort((a,b)=>a.meters-b.meters).slice(0,limit);
}
const simple=s=>normalize(String(s??'').replace(/行き?$|方面$/g,'').replace(/\([^)]*\)|（[^）]*）|駅前$/g,'').replaceAll('近鉄奈良','奈良').replaceAll('大和西大寺','西大寺'));
function onRailShape(fix,geo,operator){return (geo?.lines??[]).filter(l=>operator==='subway'?l.line==='烏丸線':['京都線','奈良線'].includes(l.line)).some(l=>l.points.some((p,i)=>i&&segmentDistance(fix,{lng:l.points[i-1][0],lat:l.points[i-1][1]},{lng:p[0],lat:p[1]})<=Math.max(100,fix.accuracy*2)));}
export function matchRail(leg,feed,network,minute,fix,geo,now=Date.now()){
  if(leg.operator!=='kintetsu'||!feed||now-Date.parse(feed.sourceUpdatedAt)>120000||now-Date.parse(feed.capturedAt)>120000||Date.parse(feed.sourceUpdatedAt)>now+60000)return [];
  const stops=timedStops(leg,network),start=kintetsuIds.indexOf(leg.from),end=kintetsuIds.indexOf(leg.to);if(start<0||end<0||start===end)return [];
  return feed.trains.filter(t=>t.category===leg.category&&simple(t.destination)===simple(leg.destination)&&t.direction===(end>start?'south':'north')).filter(t=>{
    // Use source timestamp for the schedule comparison, not the later HTTP capture time.
    const sourceMinute=minute-(now-Date.parse(feed.sourceUpdatedAt))/60000,delay=t.delay??0,before=[...stops].reverse().find(s=>s.time<=sourceMinute-delay),after=stops.find(s=>s.time>=sourceMinute-delay);
    if(!before||!after)return false;
    const ids=[before.id,after.id].map(id=>kintetsuIds.indexOf(id));const pos=(t.position-1)/2;if(pos<Math.min(...ids)-.5||pos>Math.max(...ids)+.5)return false;
    if(freshFix(fix,now)&&geo){const a=geo.stops.find(s=>s.id===t.from),b=geo.stops.find(s=>s.id===t.to);if(!a||!b||segmentDistance(fix,a,b)>Math.max(350,fix.accuracy*2))return false;}
    return true;
  });
}
export function rankRides(legs,{network,geo,samples=[],minute,railFeed,busFeed,now=Date.now()}){
  const motion=trajectory(samples,now),fix=motion.points.at(-1),seen=new Set();
  return legs.filter(l=>l.kind==='ride'&&!seen.has(rideKey(l))&&seen.add(rideKey(l))).map(leg=>{
    const stops=timedStops(leg,network,{includeUntimed:true}),evidence=[],add=(reason,points)=>evidence.push({reason,points});
    if(minute<leg.depart-2||minute>leg.arrive+10)return null;
    add('時刻表の乗車時間帯',minute>=leg.depart&&minute<=leg.arrive?20:5);
    const segments=stops.slice(1).map((b,i)=>({a:stops[i],b,ga:geo?.stops.find(s=>s.id===stops[i].id),gb:geo?.stops.find(s=>s.id===b.id)})).filter(s=>s.ga&&s.gb);
    let near=null,geometry=false;if(fix&&segments.length){near=segments.map(s=>({...s,meters:segmentDistance(fix,s.ga,s.gb)})).sort((a,b)=>Math.abs(a.meters-b.meters)>5?a.meters-b.meters:Number(b.a.time<=minute&&b.b.time>minute)-Number(a.a.time<=minute&&a.b.time>minute))[0];geometry=isBus(leg)?near.meters<=Math.max(150,fix.accuracy*2):near.meters<=2500&&onRailShape(fix,geo,leg.operator);if(geometry){add(isBus(leg)?'停留所の並び付近（道路形状は未取得）':'実際の線路形状・停車駅の区間付近',25);
      const points=motion.points,previous=points.length>1?points[0]:null;if(previous&&distance(previous,fix)>60){if(distance(previous,near.gb)-distance(fix,near.gb)>30)add('次の停車地点へ進行',15);else if(distance(fix,near.gb)-distance(previous,near.gb)>30)add('進行方向が逆',-30);}
      if(points.length>=3&&motion.span>=20&&points.every(p=>segments.some(s=>segmentDistance(p,s.ga,s.gb)<(isBus(leg)?Math.max(180,p.accuracy*2):2500))&&(isBus(leg)||onRailShape(p,geo,leg.operator))))add('20秒以上、路線に沿う軌跡',10);
      if(Number.isFinite(motion.heading)&&motion.speed>=3.5){const bearing=(Math.atan2((near.gb.lng-near.ga.lng)*Math.cos(fix.lat*Math.PI/180),near.gb.lat-near.ga.lat)*180/Math.PI+360)%360,diff=Math.abs((motion.heading-bearing+540)%360-180);if(diff<=60)add('GPSの方位が路線方向と一致',5);else if(diff>=120)add('GPSの方位が逆',-15);}
    }}
    const matches=matchRail(leg,railFeed,network,minute,fix,geo,now);
    if(matches.length===1)add('近鉄公式の種別・行先・駅間と一致',25);else if(matches.length>1)add('近鉄公式に同条件の複数便',10);
    if(isBus(leg)&&busFeed&&now-Date.parse(busFeed.capturedAt)<=120000&&simple(busFeed.stop)===simple(network.stops.get(leg.from)?.fullName??network.stops.get(leg.from)?.name)&&busFeed.route===leg.route&&simple(busFeed.destination)===simple(leg.destination)&&Math.abs(minute-leg.depart)<=3&&busFeed.buses?.some(b=>b.stopsAway===0))add('乗車停留所の接近表示と一致（車両IDなし）',10);
    const score=Math.max(0,Math.min(100,evidence.reduce((n,e)=>n+e.points,0)));
    return {leg,stops,score,evidence,live:matches.length===1?matches[0]:null,geometry};
  }).filter(Boolean).sort((a,b)=>b.score-a.score||Math.abs(a.leg.depart-minute)-Math.abs(b.leg.depart-minute));
}
export function confidence(ranked){const a=ranked[0],margin=a?a.score-(ranked[1]?.score??0):0;return {level:!a?'未判定':a.score>=80&&margin>=20?'高':a.score>=55&&margin>=10?'中':'低',margin};}
export function createModeDetector(){
  let state='nearby',pending=null,since=0,lastTimestamp=0;
  return {reset(){state='nearby';pending=null;since=0;lastTimestamp=0;},update({samples=[],ranked=[],nearStation=false,confirmed=false,now=Date.now()}){
    const motion=trajectory(samples,now),fix=motion.points.at(-1),best=ranked.find(r=>r.geometry),moving=motion.speed!==null&&motion.speed>=3.5&&motion.points.length>=3&&motion.span>=20;
    let desired=confirmed?(isBus(confirmed)?'bus':'rail'):!fix?'nearby':moving&&best?(isBus(best.leg)?'bus':'rail'):nearStation&&motion.speed!==null&&motion.speed<1.2?'waiting':'nearby';
    const reason=confirmed?'手動確定した便を維持':!fix?'新しい位置情報なし':moving&&best?'移動速度と路線の軌跡が一致':nearStation&&motion.speed!==null&&motion.speed<1.2?'停車地点の近くで停止':'乗車の根拠が不足';
    if(confirmed){state=desired;pending=null;}else if(desired===state){pending=null;}else if(!fix){state='nearby';pending=null;}else if(fix.timestamp!==lastTimestamp){if(pending!==desired){pending=desired;since=fix.timestamp;}if(fix.timestamp-since>=(desired==='waiting'?20000:30000)){state=desired;pending=null;}}
    lastTimestamp=fix?.timestamp??0;return {state,pending,reason,speed:motion.speed,heading:motion.heading,span:motion.span,heldSeconds:pending?Math.max(0,(fix.timestamp-since)/1000):0};
  }};
}
export function rideProgress(leg,network,minute,{anchor=null,delay=0,alight=leg.to,passed=null}={}){
  const stops=timedStops(leg,network,{includeUntimed:true}),shift=anchor?anchor.actualMinute-anchor.scheduledMinute:delay,effective=minute-shift,complete=stops.every(s=>Number.isFinite(s.time)),target=stops.findIndex(s=>s.id===alight);
  if(isBus(leg)&&stops.length===2&&leg.minutes>2&&!(leg.intermediate??[]).length)return {finished:effective>=leg.arrive,stops,shift,next:null,remaining:null,target:stops[target],index:null,incomplete:true};
  const index=complete?stops.findIndex(s=>s.time>effective):passed?stops.findIndex(s=>s.id===passed)+1:1;
  if(!complete&&(!passed||index<=0))return {finished:false,stops,shift,next:null,remaining:null,target:stops[target],index:null,incomplete:true};
  if(index<0)return {finished:true,stops,shift,next:null,remaining:0};
  if(index>=stops.length)return {finished:true,stops,shift,next:null,remaining:0};
  return {finished:false,stops,shift,next:{...stops[index],eta:Number.isFinite(stops[index].time)?stops[index].time+shift:null},remaining:target<index?0:target-index+1,target:stops[target],index,incomplete:!complete};
}
