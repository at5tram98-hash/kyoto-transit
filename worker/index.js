// Public transport endpoints. Arbitrary URLs and browser credentials are never accepted.
import {boundedText,searchJourney,validateJourneyRequest} from './journeys.js';
import {parseApproach} from './bus.js';
import {findMeeting,validateMeeting} from './meeting.js';
import {LOCATION_URL,parseRailLocation} from './rail.js';
import {timetableOptions,readTimetable,readOfficialTrip,officialFetcher} from './timetables.js';
import {operationInformation} from './operations.js';
import {riderCandidates} from './rider-candidates.js';
import {decodeGtfsRealtime,filterKyotoBusVehicles} from './gtfs-rt.js';
import {layoutChanged,requireRows,shouldExpectRail,fallbackDiagnostic} from './layout.js';
import {refreshAll,readStatic,tokyoDate} from './static-refresh.js';
import {visualBusApproach,visualRailSnapshot} from './visual-fallback.js';
import {BUS_CHOICE_CACHE_TTL,BUS_CHOICE_LIVE_AGE,oldestChoiceIndexes} from './bus-refresh.js';

const POC='https://kyotocity.bus-navigation.jp/wgsys/wgs_kyt/';
const KYOTO_BUS_VEHICLE='https://api.odpt.org/api/v4/gtfs/realtime/odpt_KyotoBus_AllLines_vehicle';
const KYOTO_BUS_TRIP='https://api.odpt.org/api/v4/gtfs/realtime/odpt_KyotoBus_AllLines_trip_update';
const ROUTES=new Set(['10','13','43','46','78','93','202','204','205','206','208']);
const clean=s=>s.replace(/\s+/g,' ').trim();
const error=(message,status=400,code=null)=>Response.json({error:message,...(code?{code}:{})},{status});
const iso=ms=>new Date(ms).toISOString();

export function selectionURL(stop){
  const p=new URLSearchParams({tabName:'strainSelectionTab',from:stop,fromType:'1',to:'',toType:'',locale:'ja',bsid:'1',targetTabName:'busStopSearchTab',mapFlag:'false',existYn:'N'});
  for(const key of ['selectedLandmarkCatCd','fromlat','fromlng','tolat','tolng','fromSignpoleKey','routeLayoutCd','fromBusStopCd','toBusStopCd','routeKey','nextDiagramFlag','diaRevisedDate','timeTableDirevtionCd','searchDate','searchTime','fromBusStopKey','toBusStopKey','lineSelected','informationTextId','busStopName','search_map_from','search_map_to','routeKeys','fromDisplayPassNo','toDisplayPassNo','routeKeynum','busCode','formerApproachLat','formerApproachLng','formerApproachGuidance','informationFromTextId','informationToTextId','informationRouteId','busstopCdnum','autoRefreshTime','vehicleScrollPosition','destinationCd','fromSignpoleStringKey','routeSelectNo'])p.set(key,'');
  return `${POC}selection.htm?${p}`;
}
export function approachURL(stop,value){
  if(!/^\d{9};\d+:\d+:\d+(,\d+:\d+:\d+)*$/.test(value))throw Error('系統の情報が変更されています。停留所を選び直してください。');
  const [dest,raw]=value.split(';'),parts=raw.split(',').map(v=>v.split(':'));
  if(!ROUTES.has(String(Number(dest.slice(0,3)))))throw Error('対象外の系統です。');
  const p=new URLSearchParams({tabName:'approachGuidance',from:stop,fromType:'1',locale:'ja',bsid:'1',targetTabName:'busStopSearchTab',busStopName:stop,routeKeys:parts.map(v=>v[0]).join(','),fromDisplayPassNo:parts.map(v=>v[2]).join(','),fromSignpoleStringKey:parts.map(v=>v[1]).join(','),destinationCd:dest,routeKeynum:'1',autoRefreshTime:'0'});
  p.set('to','');p.set('toType','');p.set('mapFlag','false');p.set('existYn','N');
  for(const key of ['selectedLandmarkCatCd','fromlat','fromlng','tolat','tolng','fromSignpoleKey','routeLayoutCd','fromBusStopCd','toBusStopCd','routeKey','nextDiagramFlag','diaRevisedDate','timeTableDirevtionCd','searchDate','searchTime','fromBusStopKey','toBusStopKey','lineSelected','informationTextId','search_map_from','search_map_to','toDisplayPassNo','busCode','formerApproachLat','formerApproachLng','formerApproachGuidance','informationFromTextId','informationToTextId','informationRouteId','busstopCdnum','vehicleScrollPosition','routeSelectNo'])p.set(key,'');
  return `${POC}approachGuidance.htm?${p}`;
}
export function parseBusChoices(html){
  const rows=[];let board='';
  for(const match of html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)){
    const block=match[0],b=block.match(/([A-ZＡ-Ｚ]\s*のりば)/);if(b)board=clean(b[1]);if(!block.includes('route-row-data'))continue;
    const input=block.match(/<input\b[^>]*name="rowCheckDataItem"[^>]*value="([^"]+)"/i);if(!input)continue;
    const value=input[1],route=String(Number(value.slice(0,3)));if(!ROUTES.has(route))continue;
    const dest=block.match(/id="destinationAbbreviation_data"[^>]*>([\s\S]*?)<\/p>/i)?.[1]??'',destination=clean(dest.replace(/<[^>]+>/g,' ')).replace(/&amp;/g,'&').replace(/&nbsp;/g,' ');
    if(destination)rows.push({boarding:board,value,destination,route});
  }
  return rows;
}
async function options(stop){
  const response=await fetch(selectionURL(stop),{headers:{'User-Agent':'My Map/1.0 (transport page reader)','Accept':'text/html'},signal:AbortSignal.timeout(7000)});
  if(!response.ok){await response.body?.cancel();throw Error(`停留所情報を取得できませんでした（HTTP ${response.status}）。`);}
  return requireRows('citybus',parseBusChoices(await boundedText(response)),'市バスの系統選択要素が見つかりません。');
}
async function recordVisualRecovery(env,source){
  if(!env.LIVE_KV)return;
  await env.LIVE_KV.put(`diag:visual:${source}`,JSON.stringify({code:'visual_recovery',source,at:new Date().toISOString()}),{expirationTtl:86400});
}
async function busDataObject(env,stop,choice,allowVisual=true){
  const url=approachURL(stop,choice.value),captured=()=>new Date().toISOString();let directError=null;
  try{
    const plain=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 My Map transit reader','Accept':'text/html,application/xhtml+xml'},signal:AbortSignal.timeout(7000),cache:'no-store'});
    if(plain.ok){const html=await boundedText(plain);return {kind:'bus-data',stop,...choice,...parseApproach(html),capturedAt:captured(),sourceURL:url};}
    await plain.body?.cancel();directError=Error('接近情報を取得できませんでした。');
  }catch(e){directError=e;}
  try{
    const response=await env.BROWSER.quickAction('content',{url,gotoOptions:{waitUntil:'domcontentloaded',timeout:8000},waitForSelector:{selector:'body',visible:true,timeout:7000},actionTimeout:8000});
    if(response.ok){let html=await boundedText(response);if(response.headers.get('content-type')?.includes('json')){const body=JSON.parse(html);html=typeof body.result==='string'?body.result:typeof body.content==='string'?body.content:'';}return {kind:'bus-data',stop,...choice,...parseApproach(html),capturedAt:captured(),sourceURL:url};}
    await response.body?.cancel();
  }catch(e){directError=e;}
  if(allowVisual){try{const recovered=await visualBusApproach(env,url);await recordVisualRecovery(env,'citybus');return {kind:'bus-data',stop,...choice,...recovered,capturedAt:captured(),sourceURL:url};}catch{}}
  throw layoutChanged('citybus',directError instanceof Error?directError.message:'市バスの接近要素を読み取れません。');
}
async function busData(env,stop,choice){return Response.json(await busDataObject(env,stop,choice,true));}
async function busChoiceCached(env,stop,choice){if(!env.LIVE_KV)return null;const raw=await env.LIVE_KV.get(`citybus:choice:${stop}:${choice.value}`);if(!raw)return null;try{return JSON.parse(raw);}catch{return null;}}
async function saveBusChoice(env,stop,choice,value){if(env.LIVE_KV)await env.LIVE_KV.put(`citybus:choice:${stop}:${choice.value}`,JSON.stringify(value),{expirationTtl:BUS_CHOICE_CACHE_TTL});}
async function bulkBusData(env,stop,choices){
  const unique=[...new Map(choices.map(c=>[c.value,c])).values()].slice(0,24),cached=await Promise.all(unique.map(c=>busChoiceCached(env,stop,c))),results=cached.slice();
  let available=cached.filter(Boolean).length,cursor=0;const refresh=oldestChoiceIndexes(cached,2);
  async function directRun(){while(true){const n=cursor++;if(n>=refresh.length)return;const i=refresh[n],choice=unique[i];try{const value=await busDataObject(env,stop,choice,false);results[i]=value;if(!cached[i])available++;await saveBusChoice(env,stop,choice,value);}catch(e){if(!results[i])results[i]={kind:'bus-data',stop,...choice,buses:[],error:e instanceof Error?e.message:'接近情報を取得できませんでした。',capturedAt:new Date().toISOString()};}}}
  await Promise.all(Array.from({length:Math.min(2,refresh.length)},()=>directRun()));
  if(available===0&&unique.length){const i=refresh[0]??0;try{const value=await busDataObject(env,stop,unique[i],true);results[i]=value;available++;await saveBusChoice(env,stop,unique[i],value);}catch{}}
  for(let i=0;i<unique.length;i++)if(!results[i])results[i]={kind:'bus-data',stop,...unique[i],buses:[],capturedAt:new Date().toISOString()};
  return {unique,results,success:available};
}
async function busAll(env,stop,choices){const {results}=await bulkBusData(env,stop,choices);return Response.json({kind:'bus-all',stop,results,capturedAt:new Date().toISOString()});}

async function sha256(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function jsonETag(request,data,ttl=12){const body=JSON.stringify(data),etag=`"${(await sha256(body)).slice(0,24)}"`,headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':`public, max-age=0, s-maxage=${ttl}, stale-if-error=300`,'ETag':etag,'Vary':'Origin, Accept-Encoding'});if(request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers});return new Response(body,{headers});}
async function cachedJSON(request,env,key,producer,ttl=12){
  const cache=caches.default,cacheKey=new Request(`https://mymap-cache.invalid/${encodeURIComponent(key)}`),hit=await cache.match(cacheKey);
  if(hit){const etag=hit.headers.get('ETag');if(etag&&request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers:hit.headers});return hit;}
  let data;
  try{data=await producer();if(env.LIVE_KV)await env.LIVE_KV.put(key,JSON.stringify(data),{expirationTtl:900});}
  catch(e){
    const diagnostic=fallbackDiagnostic(e,key);if(env.LIVE_KV)await env.LIVE_KV.put(`diag:${key}`,JSON.stringify(diagnostic),{expirationTtl:86400});
    const raw=env.LIVE_KV?await env.LIVE_KV.get(key):null;if(!raw)throw e;data={...JSON.parse(raw),stale:true,source:'prediction',diagnostic};
  }
  const response=await jsonETag(request,data,ttl);if(response.status===200)await cache.put(cacheKey,response.clone());return response;
}
async function fetchProto(url,key){const u=new URL(url);u.searchParams.set('acl:consumerKey',key);const r=await fetch(u,{headers:{Accept:'application/x-protobuf'},signal:AbortSignal.timeout(4000),cf:{cacheTtl:10,cacheEverything:true}});if(!r.ok){await r.body?.cancel();throw Error(`ODPT ${r.status}`);}return new Uint8Array(await r.arrayBuffer());}
async function kyotoBusRealtime(request,env){
  if(!env.ODPT_CONSUMER_KEY)return error('京都バスのリアルタイム連携を準備中です。',503,'odpt_not_configured');
  return cachedJSON(request,env,'rt:kyotobus',async()=>{const [vehicleBytes,tripBytes]=await Promise.all([fetchProto(KYOTO_BUS_VEHICLE,env.ODPT_CONSUMER_KEY),fetchProto(KYOTO_BUS_TRIP,env.ODPT_CONSUMER_KEY).catch(()=>null)]),vehicleFeed=decodeGtfsRealtime(vehicleBytes),tripFeed=tripBytes?decodeGtfsRealtime(tripBytes):{tripUpdates:[]},filtered=filterKyotoBusVehicles(vehicleFeed.vehicles,tripFeed.tripUpdates),timestamps=filtered.vehicles.map(v=>v.timestamp).filter(Number.isFinite),latest=timestamps.length?Math.max(...timestamps)*1000:Date.now(),hasFresh=filtered.vehicles.some(v=>v.fresh);return {kind:'kyotobus-rt',source:hasFresh?'live':'prediction',stale:!hasFresh,asOf:iso(latest),vehicles:filtered.vehicles.map(v=>({id:v.id,trip:v.trip,route:v.route,lat:v.lat,lon:v.lon,bearing:v.bearing,speed:v.speed,timestamp:v.timestamp,stop:v.stop,stopSequence:v.stopSequence,congestion:v.congestion,occupancy:v.occupancy,occupancyPct:v.occupancyPct,delay:v.delay})),meta:{tripUpdates:tripFeed.tripUpdates.length,unmapped:filtered.unmapped}};},12);
}
function normalizedCityRow(item,bus,index,now){const direct=Number.isFinite(bus?.minutes),observed=direct||Number.isFinite(bus?.stopsAway),minutes=direct?bus.minutes:Number.isFinite(bus?.stopsAway)?Math.max(1,bus.stopsAway*2):null,at=Date.parse(item.capturedAt),fresh=Number.isFinite(at)&&now-at<=BUS_CHOICE_LIVE_AGE;return {key:`${item.value}:${index}`,route:String(item.route),dest:item.destination,minutes,status:minutes===null?(item.noBus?'接近なし':null):null,delay:null,eta:Number.isFinite(minutes)?iso(now+minutes*60000):null,asOf:item.capturedAt,confidence:direct?0.96:observed?0.72:0.45,source:observed||item.noBus?(fresh?'live':'prediction'):'schedule',etaEstimated:observed&&!direct};}
async function cityBusArrivals(request,env,url){
  const stop=url.searchParams.get('stop');
  if(!env.STOP_NAMES.includes(stop))return error('対象の停留所を選択してください。');
  return cachedJSON(request,env,`citybus:${stop}`,async()=>{
    const choices=await options(stop),{unique,results:items,success}=await bulkBusData(env,stop,choices);
    if(unique.length&&success===0)throw layoutChanged('citybus','市バスの接近表を1件も読み取れませんでした。');
    const now=Date.now(),results=items.flatMap(item=>item.buses?.length?item.buses.slice(0,2).map((b,i)=>normalizedCityRow(item,b,i,now)):[normalizedCityRow(item,null,0,now)]).slice(0,40),asOf=results.map(r=>Date.parse(r.asOf)).filter(Number.isFinite).sort((a,b)=>b-a)[0]??now;
    return {kind:'citybus-arrivals',stop,source:results.some(r=>r.source==='live')?'live':'prediction',stale:false,asOf:iso(asOf),results};
  },12);
}
async function directRailSnapshot(env){
  const r=await env.BROWSER.quickAction('content',{url:LOCATION_URL,gotoOptions:{waitUntil:'networkidle2',timeout:4000},waitForSelector:{selector:'#stations .station-name',visible:true,timeout:4000},actionTimeout:4000});if(!r.ok){await r.body?.cancel();throw Error('近鉄の列車位置を取得できませんでした。');}
  let html=await boundedText(r);if(r.headers.get('content-type')?.includes('json')){const b=JSON.parse(html);html=typeof b.result==='string'?b.result:typeof b.content==='string'?b.content:'';}
  const parsed=parseRailLocation(html);if(shouldExpectRail()&&(!Array.isArray(parsed.trains)||parsed.trains.length===0))throw layoutChanged('kintetsu','運行時間帯に列車要素が0件でした。');return parsed;
}
async function railSnapshot(env){
  let directError=null;try{return await directRailSnapshot(env);}catch(e){directError=e;}
  try{const recovered=await visualRailSnapshot(env,LOCATION_URL);if(shouldExpectRail()&&!recovered.trains.length)throw Error('視覚情報にも列車がありません。');await recordVisualRecovery(env,'kintetsu');return recovered;}catch{}
  if(directError?.code==='layout_changed')throw directError;throw layoutChanged('kintetsu',directError instanceof Error?directError.message:'近鉄の列車要素を読み取れません。');
}
async function railLive(request,env){return cachedJSON(request,env,'rail:kintetsu',async()=>{const d=await railSnapshot(env),asOf=d.sourceUpdatedAt??new Date().toISOString();return {kind:'rail-live',source:'live',stale:false,asOf,trains:d.trains.map((t,i)=>({key:`${t.direction}:${t.position}:${t.destination}:${t.label}:${i}`,position:t.position,from:t.from,to:t.to,atStation:t.atStation,direction:t.direction,dest:t.destination,category:t.category,label:t.label,delay:t.delay}))};},12);}

function corsHeaders(env){return {'Access-Control-Allow-Origin':env.APP_ORIGIN,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, If-None-Match','Access-Control-Expose-Headers':'ETag','Vary':'Origin','X-Content-Type-Options':'nosniff'};}
function finalize(request,response,env){for(const[k,v]of Object.entries(corsHeaders(env)))response.headers.set(k,v);return response;}

export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin'),allowed=origin===env.APP_ORIGIN,url=new URL(request.url),sourceFetch=officialFetcher(env);
    if(url.pathname==='/health')return Response.json({service:'My Map transit data',version:8,browser:Boolean(env.BROWSER),kv:Boolean(env.LIVE_KV),odpt:Boolean(env.ODPT_CONSUMER_KEY),visualFallback:true});
    if(request.method==='OPTIONS')return allowed?new Response(null,{status:204,headers:corsHeaders(env)}):error('許可されていないオリジンです。',403);
    const publicLegacy=['/timetable/options','/timetable','/timetable/trip','/operations'].includes(url.pathname)&&!origin;if(!allowed&&!publicLegacy)return error('My Mapからご利用ください。',403);
    let response;
    try{
      if(request.method!=='GET')response=error('GETのみ利用できます。',405);
      else if(!(await env.LIMIT.limit({key:request.headers.get('CF-Connecting-IP')??'unknown'})).success)response=error('更新が続いています。少し待ってから再度お試しください。',429);
      else if(url.pathname==='/api/bus/rt')response=await kyotoBusRealtime(request,env);
      else if(url.pathname==='/api/citybus/arrivals')response=await cityBusArrivals(request,env,url);
      else if(url.pathname==='/api/rail/live')response=await railLive(request,env);
      else if(url.pathname==='/api/static/feed'){
        const operator=url.searchParams.get('operator'),date=url.searchParams.get('date')||tokyoDate(),data=await readStatic(env,operator,date);response=data?await jsonETag(request,data,60):error('静的時刻データをまだ準備できていません。',503,'static_not_ready');
      }
      else if(url.pathname==='/api/static/status'){
        const raw=await env.LIVE_KV?.get('static:last-refresh');response=Response.json(raw?JSON.parse(raw):{updatedAt:null,operators:{}});
      }
      else if(url.pathname==='/timetable/options')response=Response.json(await timetableOptions(url.searchParams.get('stop'),sourceFetch));
      else if(url.pathname==='/timetable')response=Response.json(await readTimetable(url.searchParams.get('stop'),url.searchParams.get('direction'),url.searchParams.get('day'),sourceFetch,url.searchParams.get('date')));
      else if(url.pathname==='/operations')response=Response.json(await operationInformation(sourceFetch));
      else if(url.pathname==='/rider/candidates')response=Response.json(await riderCandidates(url.searchParams.get('stop'),url.searchParams.get('date'),Number(url.searchParams.get('minute')),sourceFetch));
      else if(url.pathname==='/timetable/trip')response=Response.json(await readOfficialTrip(url.searchParams.get('stop'),url.searchParams.get('direction'),url.searchParams.get('day'),url.searchParams.get('trip'),sourceFetch));
      else if(url.pathname==='/meeting'){const raw=url.searchParams.get('request');if(!raw||raw.length>4000)response=error('合流条件を確認してください。');else{let r;try{r=validateMeeting(JSON.parse(raw));}catch(e){response=error(e.message??'合流条件を確認してください。');}if(r)response=Response.json(await findMeeting(r));}}
      else if(url.pathname==='/journeys'){const raw=url.searchParams.get('request');if(!raw||raw.length>2500)response=error('検索条件を確認してください。');else{let r;try{r=validateJourneyRequest(JSON.parse(raw));}catch(e){response=error(e.message??'検索条件を確認してください。');}if(r)response=Response.json(await searchJourney(r));}}
      else if(['/bus/options','/bus/data','/bus/all'].includes(url.pathname)){const stop=url.searchParams.get('stop');if(!env.STOP_NAMES.includes(stop))response=error('対象の停留所を選択してください。');else{const choices=await options(stop);if(url.pathname==='/bus/options')response=Response.json({stop,choices});else if(url.pathname==='/bus/all')response=await busAll(env,stop,choices);else{const value=url.searchParams.get('choice'),choice=choices.find(c=>c.value===value);if(!choice)response=error('現在の系統・行先を選び直してください。');else response=await busData(env,stop,choice);}}}
      else if(url.pathname==='/rail/location')response=Response.json({kind:'rail-location',...(await railSnapshot(env)),capturedAt:new Date().toISOString(),sourceURL:LOCATION_URL});
      else response=error('ページがありません。',404);
    }catch(e){console.error('transit fetch failed',e instanceof Error?e.message:'unknown');response=error(e instanceof Error?e.message:'データの取得に失敗しました。',502,e?.code??null);}
    return finalize(request,response,env);
  },
  async scheduled(controller,env,ctx){ctx.waitUntil(refreshAll(env).catch(async e=>{console.error('static refresh failed',e);if(env.LIVE_KV)await env.LIVE_KV.put('static:last-error',JSON.stringify({at:new Date().toISOString(),error:String(e?.message??e)}),{expirationTtl:604800});}));}
};
