import {createNetwork} from '../public/js/network.js';
import {trainKey,meetingPoints,feasibleMeeting,schoolRequest} from '../public/js/mobility.js';
import catalog from '../public/data/bus-catalog.json' with {type:'json'};
import {searchJourney,validateJourneyRequest} from './journeys.js';
const network=createNetwork(catalog);
const empty=(id,time)=>({start:time,time,duration:0,normal:0,transfers:0,walk:0,wait:0,legs:[],fareGroups:[],from:id});
export function validateMeeting(r){
  validateJourneyRequest({...r,to:r.from==='K01'?'B24':'K01',via:[],trainType:'all',maxWalk:30});
  if(!['subway','kintetsu'].includes(network.stops.get(r.from)?.type)||!Number.isInteger(r.friendStart)||r.friendStart<0||r.friendStart>=1440||!Number.isInteger(r.wait)||r.wait<0||r.wait>180||!['all','local','express'].includes(r.friendType)||typeof r.friendKey!=='string'||r.friendKey.length>2000)throw Error('出発駅・友達の列車・待ち時間を確認してください。');
  return r;
}
export function joinRoutes(a,b,point){
  const hold={kind:'dwell',from:point.id,to:point.id,depart:a.time,arrive:point.time,minutes:point.time-a.time,requestedMinutes:point.time-a.time,exitGate:false};
  const offset=a.legs.length+1,legs=[...a.legs,hold,...b.legs];
  return {start:a.start,time:b.time,duration:b.time-a.start,normal:a.normal+b.normal,transfers:a.transfers+b.transfers+(a.legs.length?1:0),walk:a.walk+b.walk,wait:a.wait+b.wait+hold.minutes,legs,fareGroups:[...a.fareGroups,...b.fareGroups.map(g=>({...g,indices:g.indices.map(i=>i+offset)}))]};
}
export async function findMeeting(r,read=searchJourney){
  validateMeeting(r);
  const upstream=read;let calls=0;read=async q=>{if(++calls>36)throw Error('合流検索の上限に達しました。未確認の駅があります。');return upstream(q);};
  const request={date:r.date,buffer:r.buffer,maxWalk:30,via:[],trainType:'all'};
  const friendData=await read({...request,from:'B24',to:'K01',start:r.friendStart,trainType:r.friendType});
  const friend=friendData.routes.find(p=>trainKey(p)===r.friendKey);
  if(!friend)throw Error('選んだ友達の列車を再確認できませんでした。列車の候補を更新して選び直してください。');
  const points=meetingPoints(friend,network),checked=[],plans=[];
  // Evaluate actual stopping stations in descending shared time, without assuming that express/local reach is monotonic.
  for(let i=0;i<points.length;i+=3){
    const batch=await Promise.all(points.slice(i,i+3).map(async point=>{
      if(point.time<r.start+Math.max(r.buffer,r.wait))return {point,plans:[]};
      try{const routes=point.id===r.from?[empty(r.from,r.start)]:(await read({...request,from:r.from,to:point.id,start:r.start})).routes;return {point,plans:routes};}
      catch{return {point,plans:[],unconfirmed:true};}
    }));
    for(const {point,plans:routes,unconfirmed} of batch){
      const possible=routes.map(p=>feasibleMeeting(point,p,r.buffer,r.wait)).filter(Boolean).sort((a,b)=>a.route.time-b.route.time);
      const check={id:point.id,time:point.time,sharedMinutes:point.sharedMinutes,possible:false,unconfirmed:!!unconfirmed,earliest:routes.length?Math.min(...routes.map(p=>p.time)):null};checked.push(check);
      if(!possible[0])continue;
      const c=possible[0],original=friend.legs[c.point.legIndex];
      try{
        const suffix=(await read({...request,from:c.point.id,to:'K01',start:c.point.time})).routes.find(p=>{
          const first=p.legs.find(l=>l.kind==='ride');
          return first?.from===c.point.id&&first.depart===c.point.time&&first.operator===original.operator&&first.category===original.category&&first.destination===original.destination&&first.to===original.to&&first.arrive===original.arrive&&p.time===friend.time;
        });
        if(suffix){check.possible=true;plans.push({...c,journey:joinRoutes(c.route,suffix,c.point)});}else check.unconfirmed=true;
      }catch{check.unconfirmed=true;}
      if(plans.length>=3)break;
    }
    if(plans.length>=3)break;
  }
  // School arrival is always KokusaiKaikan -> Kyoto Bus, using live search results.
  if(plans.length){
    let school;try{const after=await read(schoolRequest({...request,from:'K01',to:'ksu',start:friend.time+r.buffer}));school=after.routes.find(p=>p.legs.some(l=>l.operator==='kyotobus'&&l.from==='kyotobus-kokusai'&&l.to==='ksu'));}catch{/* Confirmed rail rendezvous remains usable when the bus search fails. */}
    for(const p of plans){p.schoolAvailable=!!school;if(school)p.journey=joinRoutes(p.journey,school,{id:'K01',time:school.start});}
  }
  return {plans,checked,friend,updatedAt:new Date().toISOString(),notice:'最大地点は、選択した友達の経路とYahoo!が返した自分の移動候補の中で比較しています。全ダイヤの最適解ではありません。時刻は予定時刻です。番線と実際の運行を確認してください。'};
}
