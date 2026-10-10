import {datasetResourceLinks,parseResourcePage,selectGtfsVersion,compactGtfsZip,dateFeed} from './static-gtfs.js';
import {readKintetsuPattern,refreshKintetsuStage,finalizeKintetsuPattern} from './manual-rail-feed.js';
import {readSubwayPattern,refreshSubwayPattern} from './manual-subway-feed.js';
import {calendarDay} from './service-calendar.js';

export const DATASETS={
  kyotobus:'https://ckan.odpt.org/dataset/kyoto_bus_all_lines_anotherversion',
  citybus:'https://ckan.odpt.org/dataset/kyoto_municipal_transportation_kyoto_city_bus_gtfs',
  subway:'https://ckan.odpt.org/dataset/kyoto_municipal_transportation_kyoto_city_subway_gtfs'
};
export const REFRESH_STEPS=[
  'odpt:kyotobus','odpt:citybus','odpt:subway',
  'subway:current','subway:opposite',
  'kintetsu:current:south','kintetsu:current:north',
  'kintetsu:opposite:south','kintetsu:opposite:north'
];
const tokyoDate=(now=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const shiftDate=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400_000).toISOString().slice(0,10);
const patternKind=day=>day==='weekday'?'weekday':day?'weekend':null;
const oppositePatternDate=(date,operator='kintetsu')=>{const current=patternKind(calendarDay(date,operator));if(!current)throw Error('運行カレンダーを確認できません。');for(let i=1;i<=14;i++){const candidate=shiftDate(date,i),kind=patternKind(calendarDay(candidate,operator));if(kind&&kind!==current)return candidate;}throw Error('反対の運行パターン日を確認できません。');};
async function text(url,timeout=10000){const r=await fetch(url,{headers:{'User-Agent':'My Map/2.0 timetable updater','Accept':'text/html'},signal:AbortSignal.timeout(timeout),cache:'no-store'});if(!r.ok){await r.body?.cancel();throw Error(`データカタログ ${r.status}`);}const value=await r.text();if(value.length>4_000_000)throw Error('データカタログが大きすぎます。');return value;}
function withConsumerKey(raw,key){const u=new URL(raw.replace(/\[(?:token|トークン|consumerKey)[^\]]*\]/gi,encodeURIComponent(key)));u.searchParams.set('acl:consumerKey',key);return u.href;}
export async function discoverVersion(datasetURL,date,fetchText=text){
  const page=await fetchText(datasetURL),links=datasetResourceLinks(page,datasetURL).slice(0,16),candidates=[];
  for(const url of links){try{candidates.push(parseResourcePage(await fetchText(url),url));}catch{/* skip an individual catalog entry */}}
  const chosen=selectGtfsVersion(candidates,date);if(!chosen)throw Error(`対象日 ${date} に有効なGTFS版を確認できませんでした。`);return {chosen,candidates};
}
async function downloadZip(url,key){const r=await fetch(withConsumerKey(url,key),{headers:{Accept:'application/zip, application/octet-stream'},signal:AbortSignal.timeout(20000),cache:'no-store'});if(!r.ok){await r.body?.cancel();throw Error(`GTFSダウンロード ${r.status}`);}const len=Number(r.headers.get('content-length'));if(Number.isFinite(len)&&len>24*1024*1024){await r.body?.cancel();throw Error('GTFS ZIPが大きすぎます。');}return new Uint8Array(await r.arrayBuffer());}
export async function refreshOne(env,operator,date=tokyoDate()){
  if(!env.ODPT_CONSUMER_KEY)throw Error('ODPT_CONSUMER_KEYが未設定です。');if(!env.LIVE_KV)throw Error('LIVE_KVが未設定です。');
  const dataset=DATASETS[operator],{chosen}=await discoverVersion(dataset,date),zip=await downloadZip(chosen.url,env.ODPT_CONSUMER_KEY),feed=await compactGtfsZip(zip,{operator,source:dataset,version:chosen});
  const record={...feed,catalogResource:chosen.resourceURL,catalogTitle:chosen.title};await env.LIVE_KV.put(`static:${operator}`,JSON.stringify(record));await env.LIVE_KV.put(`static:meta:${operator}`,JSON.stringify({operator,selected:chosen,revisionDate:record.revisionDate,lastUpdated:record.lastUpdated,validFrom:record.validFrom,validTo:record.validTo}));return record;
}
async function readCronState(env,date){const raw=await env.LIVE_KV?.get('static:cron-state');if(!raw)return {step:0,cycleDate:date,startedAt:new Date().toISOString()};try{const value=JSON.parse(raw);return Number.isInteger(value.step)&&value.step>=0&&value.step<REFRESH_STEPS.length&&/^\d{4}-\d{2}-\d{2}$/.test(value.cycleDate)?value:{step:0,cycleDate:date,startedAt:new Date().toISOString()};}catch{return {step:0,cycleDate:date,startedAt:new Date().toISOString()};}}
async function recordRefreshResult(env,result,nextState){
  const raw=await env.LIVE_KV?.get('static:last-refresh'),previous=raw?JSON.parse(raw):{operators:{},history:[]},history=[...(previous.history??[]),result].slice(-36),record={...previous,updatedAt:new Date().toISOString(),cycleDate:nextState.cycleDate,currentStep:nextState.step,last:result,history};await env.LIVE_KV?.put('static:last-refresh',JSON.stringify(record));await env.LIVE_KV?.put('static:cron-state',JSON.stringify(nextState));return record;
}
export async function runRefreshStep(env,date=tokyoDate()){
  if(!env.LIVE_KV)throw Error('LIVE_KVが未設定です。');const state=await readCronState(env,date),name=REFRESH_STEPS[state.step],base=state.cycleDate,kOpp=oppositePatternDate(base,'kintetsu'),sOpp=oppositePatternDate(base,'subway'),startedAt=new Date().toISOString();let detail=null,error=null;
  try{
    if(name.startsWith('odpt:')){const operator=name.split(':')[1],feed=await refreshOne(env,operator,base);detail={operator,revisionDate:feed.revisionDate,validFrom:feed.validFrom,validTo:feed.validTo,trips:feed.trips.length};}
    else if(name==='subway:current'){const feed=await refreshSubwayPattern(env,base);detail={operator:'subway',pattern:feed.meta.day,trips:feed.meta.tripCount,complete:feed.meta.completeCount};}
    else if(name==='subway:opposite'){const feed=await refreshSubwayPattern(env,sOpp);detail={operator:'subway',pattern:feed.meta.day,trips:feed.meta.tripCount,complete:feed.meta.completeCount};}
    else if(name==='kintetsu:current:south')detail={operator:'kintetsu',pattern:patternKind(calendarDay(base,'kintetsu')),stage:await refreshKintetsuStage(env,base,'south')};
    else if(name==='kintetsu:current:north'){const stage=await refreshKintetsuStage(env,base,'north'),feed=await finalizeKintetsuPattern(env,base);detail={operator:'kintetsu',pattern:feed.meta.day,stage,trips:feed.meta.tripCount,boards:feed.meta.boardCount};}
    else if(name==='kintetsu:opposite:south')detail={operator:'kintetsu',pattern:patternKind(calendarDay(kOpp,'kintetsu')),stage:await refreshKintetsuStage(env,kOpp,'south')};
    else if(name==='kintetsu:opposite:north'){const stage=await refreshKintetsuStage(env,kOpp,'north'),feed=await finalizeKintetsuPattern(env,kOpp);detail={operator:'kintetsu',pattern:feed.meta.day,stage,trips:feed.meta.tripCount,boards:feed.meta.boardCount};}
  }catch(e){error=String(e?.message??e);await env.LIVE_KV.put('static:last-error',JSON.stringify({at:new Date().toISOString(),cycleDate:base,step:state.step,name,error}),{expirationTtl:604800});}
  const nextStep=(state.step+1)%REFRESH_STEPS.length,nextState=nextStep===0?{step:0,cycleDate:date,startedAt:new Date().toISOString()}:{...state,step:nextStep};const result={startedAt,finishedAt:new Date().toISOString(),cycleDate:base,step:state.step,name,ok:!error,detail,error};await recordRefreshResult(env,result,nextState);return result;
}
// Full refresh remains available for local tests/administration, but production Cron
// uses runRefreshStep() so no invocation exceeds the Workers subrequest ceiling.
export async function refreshAll(env,date=tokyoDate()){const out=[];for(let i=0;i<REFRESH_STEPS.length;i++)out.push(await runRefreshStep(env,date));return {date,updatedAt:new Date().toISOString(),steps:out};}
function staticRecord(feed,operator,date){const daily=dateFeed(feed,date),updated=Date.parse(feed.lastUpdated),valid=Boolean(feed.validFrom&&feed.validTo&&date>=feed.validFrom&&date<=feed.validTo),fresh=Number.isFinite(updated)&&Date.now()-updated<=48*3600_000,stale=!valid||!fresh;return {...daily,meta:{operator,revisionDate:feed.revisionDate,lastUpdated:feed.lastUpdated,validFrom:feed.validFrom,validTo:feed.validTo,stale,warning:stale?'時刻データの更新を確認してください。':null}};}
export async function readStatic(env,operator,date=tokyoDate()){
  if(operator==='kintetsu')return readKintetsuPattern(env,date);
  if(!['kyotobus','citybus','subway'].includes(operator))throw Error('事業者を確認してください。');const raw=await env.LIVE_KV?.get(`static:${operator}`);
  if(operator==='subway'){
    if(raw){const feed=JSON.parse(raw),record=staticRecord(feed,operator,date);if(!record.meta.stale)return record;}
    return readSubwayPattern(env,date);
  }
  if(!raw)return null;return staticRecord(JSON.parse(raw),operator,date);
}
export {tokyoDate,oppositePatternDate};
