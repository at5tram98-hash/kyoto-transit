import {load} from 'cheerio/slim';
import {createNetwork,normalize} from '../public/js/network.js';
import catalog from '../public/data/bus-catalog.json' with {type:'json'};
import {yahooURL} from '../public/js/providers.js';
import {schoolRequest} from '../public/js/mobility.js';

const network=createNetwork(catalog);
const routes=new Set(['10','13','43','46','78','93','202','204','205','206','208']);
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const money=s=>{const m=clean(s).match(/([\d,]+)円/);return m?Number(m[1].replaceAll(',','')):null;};
const simple=s=>normalize(s.replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g,'').replace(/[／/].*$/,'').replace(/駅前$/,'').replaceAll('松ケ崎','松ヶ崎'));
function stopId(text,operator){
  const candidates=[...network.stops.values()].filter(s=>!operator||s.type===operator||operator==='kintetsu'&&s.id==='K15');
  return candidates.find(s=>[s.name,s.fullName,...s.aliases].filter(Boolean).some(n=>simple(n)===simple(text)))?.id??null;
}
function service(label){
  if(/徒歩/.test(label))return {kind:'walk'};
  if(/京都市営烏丸線/.test(label))return {kind:'ride',operator:'subway',category:'local'};
  if(/近鉄(?:京都|奈良)線/.test(label)&&!/(特急|準急|快速|橿原線)/.test(label))return {kind:'ride',operator:'kintetsu',category:/急行/.test(label)?'express':'local'};
  if(/京都市(?:営)?バス/.test(label)){const route=label.match(/(?:バス)?[・\s]?([0-9]{1,3})(?:号|系統|\[|\(|$)/)?.[1]??label.match(/([0-9]{1,3})/ )?.[1];return routes.has(route)?{kind:'ride',operator:'citybus',route}:null;}
  if(/京都バス/.test(label)&&/(?:直行)?40(?:系統|号|\[|\(|$)/.test(label))return {kind:'ride',operator:'kyotobus',route:'40'};
  return null;
}
// Read only the visible result markup; never use account/session fields or execute source scripts.
export function parseJourneys(html,request){
  const $=load(html),plans=[];
  $('[id]').filter((_,e)=>/^route\d{2}$/.test($(e).attr('id'))).each((_,element)=>{
    const root=$(element),detail=root.find('.routeDetail'),sequence=detail.find('.station,.access').toArray();
    const legs=[],fareGroups=[];let clock=request.start,invalid=false;
    const time=text=>{const m=text.match(/(\d{1,2}):(\d{2})/);if(!m)return null;let n=Number(m[1])*60+Number(m[2]);while(n<clock)n+=1440;clock=n;return n;};
    for(let i=0;i<sequence.length;i++){
      const access=$(sequence[i]);if(!access.hasClass('access'))continue;
      const before=$(sequence[i-1]),after=$(sequence[i+1]);
      if(!before.hasClass('station')||!after.hasClass('station')){invalid=true;break;}
      const transport=access.find('.transport'),destination=clean(transport.find('.destination').text());
      const label=access.hasClass('walk')?'徒歩':clean(transport.clone().find('.destination').remove().end().text()).normalize('NFKC');
      const meta=service(label);if(!meta){invalid=true;break;}
      const fromName=clean(before.find('dt').first().text()),toName=clean(after.find('dt').first().text());
      const stopOperator=s=>/京都市営バス/.test(s)?'citybus':/京都バス/.test(s)?'kyotobus':null;
      const from=stopId(fromName,meta.operator??stopOperator(fromName)),to=stopId(toName,meta.operator??stopOperator(toName));
      if(!from||!to){invalid=true;break;}
      const depart=time(clean(before.find('ul.time li').last().text()));
      const intermediate=access.find('.stop ul li').map((_,e)=>({name:clean($(e).find('dd').text()),time:time(clean($(e).find('dt').text()))})).get();
      const arrive=time(clean(after.find('ul.time li').first().text()));
      if(depart===null||arrive===null||arrive<depart||arrive-request.start>2880){invalid=true;break;}
      const path=[from,...intermediate.map(s=>stopId(s.name,meta.operator)).filter(Boolean),to];
      if(meta.operator==='kyotobus'&&![from,to].every(id=>['ksu','kyotobus-kokusai'].includes(id))){invalid=true;break;}
      legs.push({...meta,from,to,fromName,toName,label,destination,depart,arrive,minutes:arrive-depart,path,intermediate,
        platform:clean(access.find('.platform').text())||null,
        through:/乗換不要|乗り換え不要/.test(before.text()),
        serviceId:label,tripId:`${root.attr('id')}-${i}`,group:access.closest('.fareSection').index(),_element:sequence[i]});
    }
    if(invalid||!legs.length)return;
    detail.find('.fareSection').each((_,e)=>{const indices=legs.map((l,i)=>l.kind==='ride'&&$(e).find('.access').toArray().includes(l._element)?i:-1).filter(i=>i>=0);const normal=money($(e).children('.fare').text());if(indices.length)fareGroups.push({indices,normal});});
    const normal=money(root.find('.routeSummary .fare').text()),transferText=root.find('.routeSummary .transfer').text().match(/(\d+)回/),transfers=transferText?Number(transferText[1]):NaN;
    if(normal===null||!fareGroups.length||fareGroups.some(g=>g.normal===null)||!Number.isFinite(transfers))return;
    legs.forEach(l=>delete l._element);
    if(legs.filter(l=>l.kind==='ride').length-1>transfers){
      // A same-vehicle continuation is identifiable from Yahoo!'s total transfer count.
      // Only mark the sole agency boundary; ambiguous continuations remain unmarked.
      const boundaries=legs.map((l,i)=>i&&l.kind==='ride'&&legs[i-1].kind==='ride'&&l.from===legs[i-1].to&&l.operator!==legs[i-1].operator?i:-1).filter(i=>i>=0);
      if(boundaries.length===1&&legs.filter(l=>l.kind==='ride').length-1-transfers===1)legs[boundaries[0]].through=true;
    }
    const start=legs[0].depart,end=legs.at(-1).arrive;
    plans.push({start,time:end,duration:end-start,transfers,walk:legs.filter(l=>l.kind==='walk').reduce((n,l)=>n+l.minutes,0),wait:end-start-legs.reduce((n,l)=>n+l.minutes,0),normal,legs,fareGroups});
  });
  if(!plans.length&&/Verify you are human|unusual traffic|アクセスが制限|ロボット.*確認/i.test($.text()))throw Error('Yahoo!側のアクセス確認により取得できません。時間をおいてお試しください。');
  return plans;
}

export async function boundedText(response,max=3*1024*1024){
  if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();throw Error('取得データが大きすぎます。');}
  if(!response.body)return '';const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('取得データが大きすぎます。');}parts.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new TextDecoder().decode(bytes);
}
export function validateJourneyRequest(r){
  if(!r||![r.from,r.to].every(id=>network.stops.has(id))||!Array.isArray(r.via)||r.via.length>3||!r.via.every(v=>network.stops.has(v.stop)&&Number.isInteger(v.dwell)&&v.dwell>=0&&v.dwell<=180&&typeof v.exitGate==='boolean'))throw Error('対応する出発地・到着地・経由地を選択してください。');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||new Date(`${r.date}T00:00:00Z`).toISOString().slice(0,10)!==r.date||!Number.isInteger(r.start)||r.start<0||r.start>=1440)throw Error('日時を確認してください。');
  if(!['all','local','express'].includes(r.trainType)||![1,3,5,10].includes(r.buffer)||![10,20,30].includes(r.maxWalk))throw Error('検索条件を確認してください。');
  if(r.from===r.to&&!r.via.length)throw Error('同じ場所への検索は経由地を追加してください。');return r;
}
export function matchesConditions(plan,r){
  if(plan.walk>r.maxWalk)return false;
  if(r.trainType!=='all'&&plan.legs.some(l=>l.operator==='kintetsu'&&l.category!==r.trainType))return false;
  for(let i=1;i<plan.legs.length;i++){const a=plan.legs[i-1],b=plan.legs[i],isTransfer=plan.legs.slice(0,i).some(l=>l.kind==='ride');if(isTransfer&&b.kind==='ride'&&!b.through&&b.depart-a.arrive<r.buffer)return false;}
  return true;
}
export async function searchJourney(r,fetcher=fetch){
  r=schoolRequest(r);validateJourneyRequest(r);const places=[r.from,...r.via.map(v=>v.stop),r.to],cache=new Map();let beams=[{legs:[],fareGroups:[],normal:0,transfers:0,walk:0,wait:0,time:r.start}];
  const read=async(from,to,start)=>{
    const date=new Date(Date.parse(`${r.date}T00:00:00Z`)+Math.floor(start/1440)*86400000).toISOString().slice(0,10),minute=start%1440;
    const key=`${from}:${to}:${start}`;if(cache.has(key))return cache.get(key);
    if(cache.size>=12)throw Error('経由地の候補が多すぎます。区間を分けて検索してください。');
    const url=yahooURL({...r,date,start:minute,via:[]},network,from,to,minute,[]);
    const task=(async()=>{const res=await fetcher(url,{headers:{Accept:'text/html','User-Agent':'My Map/2.0 (authorized journey reader)'},signal:AbortSignal.timeout(15000)});if(!res.ok){await res.body?.cancel();throw Error(`Yahoo!の検索を取得できませんでした（HTTP ${res.status}）。`);}const plans=parseJourneys(await boundedText(res),{start:minute});const offset=Math.floor(start/1440)*1440;return plans.map(p=>({...p,start:p.start+offset,time:p.time+offset,legs:p.legs.map(l=>({...l,depart:l.depart+offset,arrive:l.arrive+offset,intermediate:l.intermediate.map(s=>({...s,time:s.time===null?null:s.time+offset}))}))})).filter(p=>p.legs[0].from===from&&p.legs.at(-1).to===to&&matchesConditions(p,r));})();cache.set(key,task);return task;
  };
  for(let stage=0;stage<places.length-1;stage++){
    const next=[];
    for(const prior of beams){
      const v=r.via[stage-1],earliest=prior.time+(v?Math.max(v.dwell,r.buffer):0);
      const plans=await read(places[stage],places[stage+1],earliest);
      for(const p of plans){const dwell=v?{kind:'dwell',from:v.stop,to:v.stop,depart:prior.time,arrive:earliest,minutes:earliest-prior.time,requestedMinutes:v.dwell,exitGate:v.exitGate}:null;
        const offset=prior.legs.length+(dwell?1:0),legs=[...prior.legs,...(dwell?[dwell]:[]),...p.legs];
        next.push({legs,fareGroups:[...prior.fareGroups,...p.fareGroups.map(g=>({...g,indices:g.indices.map(i=>i+offset)}))],normal:prior.normal+p.normal,start:stage?prior.start:p.start,time:p.time,duration:p.time-(stage?prior.start:p.start),transfers:prior.transfers+p.transfers+(stage?1:0),walk:prior.walk+p.walk,wait:prior.wait+p.wait+(stage?p.start-prior.time:0)});
      }
    }
    const unique=new Map(next.map(p=>[p.legs.map(l=>`${l.from}:${l.to}:${l.depart}:${l.label}`).join('|'),p]));
    const all=[...unique.values()],selected=new Map();
    for(const field of ['time','transfers','walk','wait']){const p=all.sort((a,b)=>a[field]-b[field]||a.time-b.time)[0];if(p)selected.set(p.legs.map(l=>`${l.from}:${l.depart}`).join('|'),p);}
    for(const p of all.sort((a,b)=>a.time-b.time)){if(selected.size>=3)break;selected.set(p.legs.map(l=>`${l.from}:${l.depart}`).join('|'),p);}beams=[...selected.values()].slice(0,3);if(!beams.length)break;
  }
  return {routes:beams,updatedAt:new Date().toISOString(),provider:'Yahoo!乗換案内',notice:'検索で返された候補から、対応路線・列車種別・徒歩・乗換余裕で絞り込んでいます。全ダイヤの最適解は保証しません。経由地では必ず下車し、指定滞在と乗換余裕の長い方を確保します。'};
}
