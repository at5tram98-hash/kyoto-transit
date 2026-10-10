import {kintetsuIds} from './network.js';
import {distance,segmentDistance} from './mobility.js';
import {trajectory,rankRides,freshFix,matchMeasuredVehicles,createRideConsensus} from './riding.js';
import {getBusChoices,getBusData,getKyotoBusRT} from './live.js';
import {officialTripLeg} from './vehicle.js';
import {subwayRideCandidates,buildCityBusTrip,routeIntersection} from './vnext-core.js';
import {mergeTimetableFeeds} from './search-core.js';
import {state,settings,tokyoNow,nearest,speed,sleep,haptic,toast,rideKey,serviceName,official,ensureRailFeed,inferRailDirection} from './vnext-state.js';

const consensus=createRideConsensus({required:3,minScore:55,minMargin:8});
let lastNextAlertKey=null;
const scoreClamp=n=>Math.max(0,Math.min(100,Math.round(n)));
const asCandidate=(ride,score,source,extra={})=>({ride,score:scoreClamp(score),source,...extra});
function onRailCorridor(fix,type){if(!fix||!state.geo?.lines)return false;const names=type==='subway'?new Set(['烏丸線']):new Set(['京都線','奈良線']);return state.geo.lines.filter(l=>names.has(l.line)).some(l=>l.points.some((p,i)=>i&&segmentDistance(fix,{lng:l.points[i-1][0],lat:l.points[i-1][1]},{lng:p[0],lat:p[1]})<=Math.max(140,fix.accuracy*2)));}
function normalizeStaticFeed(raw){const mapped=mergeTimetableFeeds({...state.network,services:[]},[raw]);return {...raw,services:mapped.services};}

async function detectKintetsu(stopId){
  const now=tokyoNow(),feed=await ensureRailFeed(),data=await official('/rider/candidates',{stop:stopId,date:now.date,minute:now.minute}),legs=data.trips.map(t=>officialTripLeg(t,state.network)).filter(Boolean);if(!legs.length)return [];
  const direction=inferRailDirection(stopId,'kintetsu'),ranked=rankRides(legs,{network:state.network,geo:state.geo,samples:state.samples,minute:now.minute,railFeed:feed,busFeed:null});
  return ranked.map(r=>{let score=r.score;if(direction){const a=kintetsuIds.indexOf(r.leg.from),b=kintetsuIds.indexOf(r.leg.to),legDirection=b>a?'south':'north';if(legDirection!==direction)score-=20;}return asCandidate(r.leg,score,'近鉄公式時刻表＋列車位置＋現在地',{live:r.live,evidence:r.evidence});}).sort((a,b)=>b.score-a.score).slice(0,3);
}

async function ensureKyotoBusFeed(){
  if(state.kyotoBusFeed&&Date.now()-state.kyotoBusFeedAt<12000)return state.kyotoBusFeed;
  try{state.kyotoBusFeed=await getKyotoBusRT(AbortSignal.timeout(4000));state.kyotoBusFeedAt=Date.now();return state.kyotoBusFeed;}catch(e){if(e?.code!=='odpt_not_configured')console.warn('kyotobus rt',e);return state.kyotoBusFeed;}
}

async function detectKyotoBus(stopId){
  const now=tokyoNow(),data=await official('/rider/candidates',{stop:stopId,date:now.date,minute:now.minute}),legs=data.trips.map(t=>officialTripLeg(t,state.network)).filter(Boolean).filter(l=>now.minute>=l.depart-8&&now.minute<=l.arrive+5);if(!legs.length)return [];
  const feed=await ensureKyotoBusFeed(),ranked=rankRides(legs,{network:state.network,geo:state.geo,samples:state.samples,minute:now.minute,railFeed:null,busFeed:null}),rankMap=new Map(ranked.map(r=>[rideKey(r.leg),r]));
  return legs.map(ride=>{const base=rankMap.get(rideKey(ride)),measured=matchMeasuredVehicles(ride,feed?.vehicles??[],{network:state.network,samples:state.samples,now:Date.now()})[0],scheduleScore=base?.score??(now.minute>=ride.depart-2&&now.minute<=ride.arrive+3?38:22),score=measured?scoreClamp(scheduleScore*.62+measured.score*.68):scoreClamp(scheduleScore+20),live=measured?.vehicle??null;return asCandidate(ride,score,live?'京都バス車両位置＋公式時刻表＋現在地':'京都バス公式時刻表＋現在地',{live,evidence:[...(base?.evidence??[]),...(measured?.evidence??[])]});}).sort((a,b)=>b.score-a.score||Math.abs(a.ride.depart-now.minute)-Math.abs(b.ride.depart-now.minute)).slice(0,3);
}

async function detectSubway(stopId){
  const now=tokyoNow();
  if(!state.subwayStaticFeed||state.subwayStaticFeedDate!==now.date||Date.now()-(state.subwayStaticFeedAt??0)>15*60*1000){
    const raw=await official('/api/static/feed',{operator:'subway',date:now.date});
    state.subwayStaticFeed=normalizeStaticFeed(raw);
    state.subwayStaticFeedDate=now.date;
    state.subwayStaticFeedAt=Date.now();
  }
  const directionHint=inferRailDirection(stopId,'subway'),legs=subwayRideCandidates(state.subwayStaticFeed,{fromId:stopId,direction:directionHint,minute:now.minute,network:state.network,windowBefore:9,windowAfter:1});
  if(!legs.length)return [];
  const ranked=rankRides(legs,{network:state.network,geo:state.geo,samples:state.samples,minute:now.minute,railFeed:null,busFeed:null});
  return ranked.map(r=>asCandidate(r.leg,r.score+35,'地下鉄公式全駅時刻表＋現在地',{evidence:r.evidence})).sort((a,b)=>b.score-a.score||Math.abs(a.ride.depart-now.minute)-Math.abs(b.ride.depart-now.minute)).slice(0,3);
}

export function updateBusTrail(id,meters){if(!id||meters>130)return;const last=state.busTrail.at(-1);if(last?.id===id)return;state.busTrail.push({id,at:Date.now()});state.busTrail=state.busTrail.filter(x=>Date.now()-x.at<8*60*1000).slice(-4);}

async function detectCityBus(stopInfo){
  const now=tokyoNow(),trail=state.busTrail.map(x=>x.id),routes=routeIntersection(trail.length>=2?trail:[stopInfo.id],state.network);if(!routes.length)return [];
  const stop=state.network.stops.get(stopInfo.id),choices=(await getBusChoices(stop.fullName??stop.name,AbortSignal.timeout(4000))).choices,routeChoices=choices.filter(c=>routes.includes(String(c.route))).slice(0,4);let bestLive=null;
  for(const choice of routeChoices.slice(0,3)){try{const live=await getBusData(stop.fullName??stop.name,choice,AbortSignal.timeout(4000));if((live.buses??[]).some(b=>Number.isFinite(b.stopsAway)&&b.stopsAway<=1)){bestLive=live;break;}}catch{}await sleep(40);}
  if(bestLive){state.busLive=bestLive;state.busLiveAt=Date.now();}
  const previous=trail.length>1?trail.at(-2):null,rows=[];
  for(const route of routes.slice(0,3)){const choice=routeChoices.find(c=>String(c.route)===String(route)),live=bestLive&&String(bestLive.route)===String(route)?bestLive:null,ride=buildCityBusTrip({route,currentStopId:stopInfo.id,previousStopId:previous,network:state.network,minute:now.minute,destination:live?.destination??choice?.destination});if(!ride)continue;const score=live?78:routes.length===1?62:58;rows.push(asCandidate(ride,score,live?'市バス接近情報＋現在地':'停留所列＋現在地',{live}));}
  return rows.sort((a,b)=>b.score-a.score).slice(0,3);
}

function mergeCandidates(...groups){const map=new Map();for(const row of groups.flat().filter(Boolean)){const key=rideKey(row.ride);const old=map.get(key);if(!old||row.score>old.score)map.set(key,row);}return [...map.values()].sort((a,b)=>b.score-a.score).slice(0,3);}
function applyRide(candidate){const changed=rideKey(state.ride)!==rideKey(candidate.ride);state.ride=candidate.ride;state.rideSource=candidate.source;state.rideConfidence=candidate.score;state.lastRideSeenAt=Date.now();state.rideCandidates=[];state.rideConsensusCount=0;if(Number.isFinite(candidate.live?.delay))state.rideShift=candidate.live.delay;if(changed){lastNextAlertKey=null;haptic();toast(`${serviceName(candidate.ride)}を判定しました`);}}
export function confirmRideCandidate(index){const candidate=state.rideCandidates[Number(index)];if(!candidate)return false;consensus.reset();applyRide(candidate);return true;}
export function resetRideDetection(){consensus.reset();state.rideCandidates=[];state.rideConsensusCount=0;lastNextAlertKey=null;}

export async function autoDetectRide(force=false,onChange=()=>{}){
  if(!settings.autoDetect||state.detectBusy||!state.network||!state.geo||!state.fix||!freshFix(state.fix)||state.ride)return;if(!force&&Date.now()-state.lastDetectAt<12000)return;
  const near=nearest(),motion=trajectory(state.samples),moving=Number.isFinite(motion.speed)&&motion.speed>=2.8;updateBusTrail(near.bus?.id,near.bus?.meters??Infinity);if(!moving){state.rideCandidates=[];state.rideConsensusCount=0;return;}state.detectBusy=true;state.lastDetectAt=Date.now();onChange();
  try{
    let candidates=[];const stationClose=near.rail&&near.rail.meters<=Math.max(180,state.fix.accuracy*2.2),railClose=near.rail&&(stationClose||onRailCorridor(state.fix,near.rail.stop.type)),recentBusTrail=state.busTrail.some(x=>Date.now()-x.at<180000),busClose=near.bus&&(near.bus.meters<=Math.max(150,state.fix.accuracy*2.1)||(recentBusTrail&&near.bus.meters<=700)),kyotoClose=near.kyotoBus&&near.kyotoBus.meters<=Math.max(180,state.fix.accuracy*2.3);
    if(railClose){if(near.rail.id==='K15'){const [k,s]=await Promise.all([detectKintetsu('K15').catch(()=>[]),detectSubway('K15').catch(()=>[])]);candidates=mergeCandidates(k,s);}else candidates=near.rail.stop.type==='kintetsu'?await detectKintetsu(near.rail.id).catch(()=>[]):await detectSubway(near.rail.id).catch(()=>[]);}
    if(!candidates.length&&(busClose||kyotoClose)){const cityPromise=busClose&&near.bus.stop.type==='citybus'?detectCityBus(near.bus).catch(()=>[]):Promise.resolve([]),kyotoPromise=kyotoClose?detectKyotoBus(near.kyotoBus.id).catch(()=>[]):near.bus?.stop.type==='kyotobus'&&busClose?detectKyotoBus(near.bus.id).catch(()=>[]):Promise.resolve([]);const [city,kyoto]=await Promise.all([cityPromise,kyotoPromise]);candidates=mergeCandidates(city,kyoto);}
    const decision=consensus.update(candidates,state.fix.timestamp);state.rideConsensusCount=decision.count;state.rideCandidates=decision.ambiguous?decision.candidates:[];
    if(decision.confirmed){const selected=candidates.find(c=>rideKey(c.ride)===rideKey(decision.confirmed))??candidates[0];if(selected)applyRide(selected);}
  }finally{state.detectBusy=false;onChange();}
}

export function updateRideAnchor(){
  const ride=state.ride;if(!ride||!freshFix(state.fix)||!state.geo)return;const now=tokyoNow(),stops=ride.officialStops??[],effective=now.minute-state.rideShift,busMode=['citybus','kyotobus'].includes(ride.operator),trailId=state.busTrail.at(-1)?.id,trailIndex=busMode&&trailId?stops.map(s=>s.id).lastIndexOf(trailId):-1;let best=null;
  for(const s of stops){if(!s.id||!Number.isFinite(s.time))continue;const g=state.geo.stops.find(x=>x.id===s.id);if(!g)continue;const meters=distance(state.fix,g);if(meters<Math.max(45,Math.min(90,state.fix.accuracy*1.6))&&(!best||meters<best.meters))best={s,meters};}
  if(best&&Math.abs(now.minute-best.s.time)<20&&!['kintetsu','through'].includes(ride.operator))state.rideShift=now.minute-best.s.time;
  if(busMode){const scheduled=stops.find(s=>s.id&&Number.isFinite(s.time)&&s.time>effective+.1),fallbackIndex=trailIndex>=0?trailIndex+1:ride.operator==='citybus'?1:-1,next=scheduled??(fallbackIndex>=0&&fallbackIndex<stops.length?stops[fallbackIndex]:null),nextGeo=next&&state.geo.stops.find(x=>x.id===next.id),alertKey=next?`${rideKey(ride)}|${next.id}`:null;if(nextGeo&&alertKey!==lastNextAlertKey&&distance(state.fix,nextGeo)<=220){lastNextAlertKey=alertKey;haptic();toast(`次は ${next.name??state.network.stops.get(next.id)?.name??'次の停留所'}`);}}
  const end=stops.at(-1),endGeo=end?.id?state.geo.stops.find(x=>x.id===end.id):null,endTime=Number.isFinite(end?.time)?end.time:Number.isFinite(ride.arrive)?ride.arrive:null,atEnd=endGeo&&distance(state.fix,endGeo)<80&&speed()<1.2,scheduleAllows=Number.isFinite(endTime)?now.minute>endTime+state.rideShift:busMode&&trailId===end?.id;if(atEnd&&scheduleAllows){if(Date.now()-state.lastRideSeenAt>90000){state.ride=null;state.rideShift=0;state.rideSource=null;state.rideConfidence=0;resetRideDetection();toast('到着を確認しました');}}else state.lastRideSeenAt=Date.now();
}
