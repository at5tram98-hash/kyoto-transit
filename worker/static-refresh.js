import {datasetResourceLinks,parseResourcePage,selectGtfsVersion,compactGtfsZip,dateFeed} from './static-gtfs.js';

export const DATASETS={
  kyotobus:'https://ckan.odpt.org/dataset/kyoto_bus_all_lines_anotherversion',
  citybus:'https://ckan.odpt.org/dataset/kyoto_municipal_transportation_kyoto_city_bus_gtfs',
  subway:'https://ckan.odpt.org/dataset/kyoto_municipal_transportation_kyoto_city_subway_gtfs'
};
const tokyoDate=(now=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
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
export async function refreshAll(env,date=tokyoDate()){
  const result={date,updatedAt:new Date().toISOString(),operators:{}};
  for(const op of ['kyotobus','citybus','subway']){try{const f=await refreshOne(env,op,date);result.operators[op]={ok:true,revisionDate:f.revisionDate,validFrom:f.validFrom,validTo:f.validTo,trips:f.trips.length};}catch(e){result.operators[op]={ok:false,error:String(e?.message??e)};}}
  if(env.LIVE_KV)await env.LIVE_KV.put('static:last-refresh',JSON.stringify(result));return result;
}
export async function readStatic(env,operator,date=tokyoDate()){
  if(!['kyotobus','citybus','subway'].includes(operator))throw Error('事業者を確認してください。');const raw=await env.LIVE_KV?.get(`static:${operator}`);if(!raw)return null;const feed=JSON.parse(raw),daily=dateFeed(feed,date),updated=Date.parse(feed.lastUpdated),stale=(!feed.validFrom||date<feed.validFrom)||(!feed.validTo||date>feed.validTo)||!Number.isFinite(updated)||Date.now()-updated>48*3600_000;return {...daily,meta:{operator,revisionDate:feed.revisionDate,lastUpdated:feed.lastUpdated,validFrom:feed.validFrom,validTo:feed.validTo,stale,warning:stale?'時刻データの更新を確認してください。':null}};
}
export {tokyoDate};
