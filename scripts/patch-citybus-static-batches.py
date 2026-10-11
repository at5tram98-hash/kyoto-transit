from pathlib import Path
import re

def one(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing target: {label}')
    return text.replace(old,new,1)

def rex(text, pattern, repl, label):
    out,n=re.subn(pattern,repl,text,count=1,flags=re.S)
    if n!=1: raise SystemExit(f'{label}: {n} matches')
    return out

p=Path('worker/official-static-fallback.js'); s=p.read_text()
s=one(s,"const PARTIAL_TTL=300;","const PARTIAL_TTL=300;\nexport const CITYBUS_ROUTE_BATCHES=[['10','13','43','46'],['78','93','202','204'],['205','206','208']];",'route batches')
new_city=r'''async function cityContext(date){
  const day=calendarDay(date,'citybus');if(!day)throw Error('市バスの運行日区分を確認できません。');
  const prototypes=network.services.filter(s=>s.operator==='citybus'&&s.prototype),groups=groupCityServices(prototypes);return {day,prototypes,groups};
}
async function cachedCityRoutes(env,date,groups){
  const routeResults=[],missing=[];
  for(const group of groups){const raw=await env.LIVE_KV?.get(`static:fallback:citybus-route:${group.route}:${date}`);if(!raw){missing.push(group.route);continue;}try{const saved=JSON.parse(raw);if(Array.isArray(saved.services)&&saved.services.length)routeResults.push(saved);else missing.push(group.route);}catch{missing.push(group.route);}}
  return {routeResults,missing,services:routeResults.flatMap(r=>r.services??[])};
}
function cityFeedFromRoutes(date,prototypes,groups,routeResults,services,missing){
  const value=feed('citybus',date,services,'京都市交通局 公式停留所時刻表（区間所要時間は路線順序から補完）','official_departures_with_segment_completion');
  value.meta.expectedRoutes=groups.length;value.meta.availableRoutes=routeResults.length;value.meta.expectedServices=prototypes.length;value.meta.availableServices=services.length;value.meta.partial=missing.length>0||services.length<prototypes.length;value.meta.failedRoutes=missing;return value;
}
export async function refreshCityBusBatch(env,date,batchIndex,fetcher=officialFetcher(env)){
  if(!env.LIVE_KV)throw Error('LIVE_KVが未設定です。');const {day,groups}=await cityContext(date),routes=CITYBUS_ROUTE_BATCHES[batchIndex];if(!routes)throw Error('市バス更新バッチを確認してください。');
  const selected=groups.filter(g=>routes.includes(g.route)),routeResults=[],failed=[];
  for(const group of selected){try{routeResults.push(await readCityRouteFallback(env,group.route,group.services,date,day,fetcher));}catch(error){failed.push(group.route);await recordCityRouteError(env,group.route,'batch',error);}}
  if(!routeResults.length)throw Error(`市バスfallbackバッチ${batchIndex+1}を生成できませんでした。`);
  return {date,batchIndex,routes,availableRoutes:routeResults.map(r=>r.route),failedRoutes:failed,services:routeResults.flatMap(r=>r.services??[]).length};
}
export async function finalizeCityBusFallback(env,date){
  if(!env.LIVE_KV)throw Error('LIVE_KVが未設定です。');const {prototypes,groups}=await cityContext(date),{routeResults,missing,services}=await cachedCityRoutes(env,date,groups);
  if(missing.length||services.length<prototypes.length)throw Error(`市バス公式時刻表fallbackが未完成です（未取得: ${missing.join('・')||'サービス'}）。`);
  const value=cityFeedFromRoutes(date,prototypes,groups,routeResults,services,[]);await env.LIVE_KV.put(`static:fallback:citybus:${date}`,JSON.stringify(value),{expirationTtl:CACHE_TTL});return value;
}
async function partialCityBusFallback(env,date){
  const {prototypes,groups}=await cityContext(date),{routeResults,missing,services}=await cachedCityRoutes(env,date,groups);if(!services.length)throw Error('京都市バスの公式時刻表fallbackをまだ生成できていません。');return cityFeedFromRoutes(date,prototypes,groups,routeResults,services,missing);
}
async function nextCityBusBatch(env,date){
  const {groups}=await cityContext(date),{missing}=await cachedCityRoutes(env,date,groups),set=new Set(missing);for(let i=0;i<CITYBUS_ROUTE_BATCHES.length;i++)if(CITYBUS_ROUTE_BATCHES[i].some(route=>set.has(route)))return i;return -1;
}
export async function buildCityBusFallback(env,date,fetcher=officialFetcher(env)){
  for(let i=0;i<CITYBUS_ROUTE_BATCHES.length;i++)await refreshCityBusBatch(env,date,i,fetcher);return finalizeCityBusFallback(env,date);
}
function kyotoRouteMatch'''
s=rex(s,r"export async function buildCityBusFallback\(env,date,fetcher=officialFetcher\(env\)\)\{.*?\n\}\nfunction kyotoRouteMatch",new_city,'replace city builder')
old_end="export async function readOfficialFallback(env,operator,date,{force=false}={}){\n  const key=`static:fallback:${operator}:${date}`,raw=!force?await env.LIVE_KV?.get(key):null;if(raw){try{return JSON.parse(raw);}catch{}}\n  const value=await buildOfficialFallback(env,operator,date);if(env.LIVE_KV)await env.LIVE_KV.put(key,JSON.stringify(value),{expirationTtl:value.meta?.partial?PARTIAL_TTL:CACHE_TTL});return value;\n}\n"
new_end="""export async function readOfficialFallback(env,operator,date,{force=false}={}){
  const key=`static:fallback:${operator}:${date}`,raw=!force?await env.LIVE_KV?.get(key):null;if(raw){try{return JSON.parse(raw);}catch{}}
  if(operator==='citybus'){
    try{return await finalizeCityBusFallback(env,date);}catch{}
    const batch=await nextCityBusBatch(env,date);if(batch>=0)await refreshCityBusBatch(env,date,batch);
    try{return await finalizeCityBusFallback(env,date);}catch{return partialCityBusFallback(env,date);}
  }
  const value=await buildOfficialFallback(env,operator,date);if(env.LIVE_KV)await env.LIVE_KV.put(key,JSON.stringify(value),{expirationTtl:value.meta?.partial?PARTIAL_TTL:CACHE_TTL});return value;
}
"""
s=one(s,old_end,new_end,'read fallback')
p.write_text(s)

p=Path('worker/static-refresh.js'); s=p.read_text()
s=one(s,"import {readOfficialFallback} from './official-static-fallback.js';","import {readOfficialFallback,refreshCityBusBatch,finalizeCityBusFallback} from './official-static-fallback.js';",'static import')
s=rex(s,r"export const REFRESH_STEPS=\[.*?\];",'''export const REFRESH_STEPS=[
  'odpt:kyotobus','odpt:citybus','citybus:batch:1','citybus:batch:2','citybus:finalize','odpt:subway',
  'subway:current','subway:opposite',
  'kintetsu:current:south','kintetsu:current:north',
  'kintetsu:opposite:south','kintetsu:opposite:north'
];''','refresh steps')
old_branch="""if(name.startsWith('odpt:')){const operator=name.split(':')[1];if(!env.ODPT_CONSUMER_KEY&&['citybus','kyotobus'].includes(operator)){const feed=await readOfficialFallback(env,operator,base,{force:true});detail={operator,source:'official_fallback',services:feed.services.length,trips:feed.services.reduce((n,s)=>n+s.trips.length,0)};}else if(!env.ODPT_CONSUMER_KEY&&operator==='subway'){const feed=await readSubwayPattern(env,base);detail={operator,source:'official_timetable',trips:feed.meta?.tripCount??feed.services?.reduce((n,s)=>n+s.trips.length,0)??0};}else{const feed=await refreshOne(env,operator,base);detail={operator,revisionDate:feed.revisionDate,validFrom:feed.validFrom,validTo:feed.validTo,trips:feed.trips.length};}}
    else if(name==='subway:current')"""
new_branch="""if(name==='odpt:citybus'&&!env.ODPT_CONSUMER_KEY){detail={operator:'citybus',source:'official_fallback',...(await refreshCityBusBatch(env,base,0))};}
    else if(name==='citybus:batch:1'){detail={operator:'citybus',source:'official_fallback',...(await refreshCityBusBatch(env,base,1))};}
    else if(name==='citybus:batch:2'){detail={operator:'citybus',source:'official_fallback',...(await refreshCityBusBatch(env,base,2))};}
    else if(name==='citybus:finalize'){const feed=await finalizeCityBusFallback(env,base);detail={operator:'citybus',source:'official_fallback',services:feed.services.length,trips:feed.services.reduce((n,s)=>n+s.trips.length,0),partial:false};}
    else if(name.startsWith('odpt:')){const operator=name.split(':')[1];if(!env.ODPT_CONSUMER_KEY&&operator==='kyotobus'){const feed=await readOfficialFallback(env,operator,base,{force:true});detail={operator,source:'official_fallback',services:feed.services.length,trips:feed.services.reduce((n,s)=>n+s.trips.length,0)};}else if(!env.ODPT_CONSUMER_KEY&&operator==='subway'){const feed=await readSubwayPattern(env,base);detail={operator,source:'official_timetable',trips:feed.meta?.tripCount??feed.services?.reduce((n,s)=>n+s.trips.length,0)??0};}else{const feed=await refreshOne(env,operator,base);detail={operator,revisionDate:feed.revisionDate,validFrom:feed.validFrom,validTo:feed.validTo,trips:feed.trips.length};}}
    else if(name==='subway:current')"""
s=one(s,old_branch,new_branch,'refresh branch')
p.write_text(s)

p=Path('tests/official-static-fallback.test.js'); s=p.read_text()
s=s.replace("import {chooseCityBoard,offsetTrips,groupCityServices} from '../worker/official-static-fallback.js';","import {chooseCityBoard,offsetTrips,groupCityServices,CITYBUS_ROUTE_BATCHES} from '../worker/official-static-fallback.js';")
s += "\ntest('市バスCronバッチは全対応系統を重複なく4+4+3で網羅する',()=>{\n  assert.deepEqual(CITYBUS_ROUTE_BATCHES.map(x=>x.length),[4,4,3]);\n  assert.deepEqual([...new Set(CITYBUS_ROUTE_BATCHES.flat())].sort((a,b)=>Number(a)-Number(b)),['10','13','43','46','78','93','202','204','205','206','208'].sort((a,b)=>Number(a)-Number(b)));\n});\n"
p.write_text(s)

Path('tests/static-refresh-plan.test.js').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import {REFRESH_STEPS} from '../worker/static-refresh.js';

test('静的更新は市バスを3バッチと確定処理へ分割する',()=>{
  assert.deepEqual(REFRESH_STEPS.slice(0,6),['odpt:kyotobus','odpt:citybus','citybus:batch:1','citybus:batch:2','citybus:finalize','odpt:subway']);
  assert.equal(REFRESH_STEPS.length,12);
});
""")
print('patched batched citybus static refresh')
