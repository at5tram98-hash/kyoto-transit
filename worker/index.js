// Public transport endpoints. Arbitrary URLs and browser credentials are never accepted.
import {boundedText,searchJourney,validateJourneyRequest} from './journeys.js';
import {parseApproach} from './bus.js';
import {findMeeting,validateMeeting} from './meeting.js';
import {LOCATION_URL,parseRailLocation} from './rail.js';
import {timetableOptions,readTimetable,readOfficialTrip,officialFetcher} from './timetables.js';
import {operationInformation} from './operations.js';
import {riderCandidates} from './rider-candidates.js';
import {decodeGtfsRealtime,filterKyotoBusVehicles} from './gtfs-rt.js';

const POC='https://kyotocity.bus-navigation.jp/wgsys/wgs_kyt/';
const RAIL='https://www.kintetsu.jp/unkou/unkou.html';
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
  const response=await fetch(selectionURL(stop),{headers:{'User-Agent':'My Map/1.0 (transport page reader)','Accept':'text/html'},signal:AbortSignal.timeout(4000)});
  if(!response.ok){await response.body?.cancel();throw Error(`停留所情報を取得できませんでした（HTTP ${response.status}）。`);}return parseBusChoices(await boundedText(response));
}
async function busDataObject(env,stop,choice){
  const url=approachURL(stop,choice.value),response=await env.BROWSER.quickAction('content',{url,gotoOptions:{waitUntil:'networkidle2',timeout:4000},waitForSelector:{selector:'#approach_table',visible:true,timeout:4000},actionTimeout:4000});
  if(!response.ok){await response.body?.cancel();throw Error('接近情報を取得できませんでした。');}
  let html=await boundedText(response);if(response.headers.get('content-type')?.includes('json')){const body=JSON.parse(html);html=typeof body.result==='string'?body.result:typeof body.content==='string'?body.content:'';}
  return {kind:'bus-data',stop,...choice,...parseApproach(html),capturedAt:new Date().toISOString(),sourceURL:url};
}
async function busData(env,stop,choice){return Response.json(await busDataObject(env,stop,choice));}
async function busAll(env,stop,choices){const unique=[...new Map(choices.map(c=>[c.value,c])).values()].slice(0,24),results=new Array(unique.length);let cursor=0;async function run(){while(true){const i=cursor++;if(i>=unique.length)return;const choice=unique[i];try{results[i]=await busDataObject(env,stop,choice);}catch(e){results[i]={kind:'bus-data',stop,...choice,buses:[],error:e instanceof Error?e.message:'接近情報を取得できませんでした。',capturedAt:new Date().toISOString()};}}}await Promise.all(Array.from({length:Math.min(3,unique.length)},()=>run()));return Response.json({kind:'bus-all',stop,results,capturedAt:new Date().toISOString()});}
async function capture(env,url,source){const params={url,viewport:{width:480,height:1000,deviceScaleFactor:2},gotoOptions:{waitUntil:'networkidle2',timeout:8000},screenshotOptions:{type:'png',fullPage:true},actionTimeout:8000};if(source==='bus')params.waitForSelector={selector:'#approach_table',visible:true,timeout:5000};const r=await env.BROWSER.quickAction('screenshot',params);if(!r.ok){await r.body?.cancel();throw Error('公式画面を取得できませんでした。');}if(!r.headers.get('content-type')?.startsWith('image/')){await r.body?.cancel();throw Error('画像データを取得できませんでした。');}const headers=new Headers({'Content-Type':'image/png','Cache-Control':'private, no-store','X-Captured-At':new Date().toISOString(),'X-Source-URL':encodeURIComponent(url),'X-Content-Type-Options':'nosniff'});return new Response(r.body,{headers});}

async function sha256(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function jsonETag(request,data,ttl=12){const body=JSON.stringify(data),etag=`"${(await sha256(body)).slice(0,24)}"`,headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':`public, max-age=0, s-maxage=${ttl}, stale-if-error=300`,'ETag':etag,'Vary':'Origin, Accept-Encoding'});if(request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers});return new Response(body,{headers});}
async function cachedJSON(request,env,key,producer,ttl=12){
  const cache=caches.default,cacheKey=new Request(`https://mymap-cache.invalid/${encodeURIComponent(key)}`),hit=await cache.match(cacheKey);
  if(hit){const etag=hit.headers.get('ETag');if(etag&&request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers:hit.headers});return hit;}
  let data;
  try{data=await producer();if(env.LIVE_KV)await env.LIVE_KV.put(key,JSON.stringify(data),{expirationTtl:900});}
  catch(e){const raw=env.LIVE_KV?await env.LIVE_KV.get(key):null;if(!raw)throw e;data={...JSON.parse(raw),stale:true,source:'prediction'};}
  const response=await jsonETag(request,data,ttl);if(response.status===200)await cache.put(cacheKey,response.clone());return response;
}
async function fetchProto(url,key){const u=new URL(url);u.searchParams.set('acl:consumerKey',key);const r=await fetch(u,{headers:{Accept:'application/x-protobuf'},signal:AbortSignal.timeout(4000),cf:{cacheTtl:10,cacheEverything:true}});if(!r.ok){await r.body?.cancel();throw Error(`ODPT ${r.status}`);}return new Uint8Array(await r.arrayBuffer());}
async function kyotoBusRealtime(request,env){
  if(!env.ODPT_CONSUMER_KEY)return error('京都バスのリアルタイム連携を準備中です。',503,'odpt_not_configured');
  return cachedJSON(request,env,'rt:kyotobus',async()=>{const [vehicleBytes,tripBytes]=await Promise.all([fetchProto(KYOTO_BUS_VEHICLE,env.ODPT_CONSUMER_KEY),fetchProto(KYOTO_BUS_TRIP,env.ODPT_CONSUMER_KEY).catch(()=>null)]),vehicleFeed=decodeGtfsRealtime(vehicleBytes),tripFeed=tripBytes?decodeGtfsRealtime(tripBytes):{tripUpdates:[]},filtered=filterKyotoBusVehicles(vehicleFeed.vehicles,tripFeed.tripUpdates),timestamps=filtered.vehicles.map(v=>v.timestamp).filter(Number.isFinite),latest=timestamps.length?Math.max(...timestamps)*1000:Date.now(),hasFresh=filtered.vehicles.some(v=>v.fresh);return {kind:'kyotobus-rt',source:hasFresh?'live':'prediction',stale:!hasFresh,asOf:iso(latest),vehicles:filtered.vehicles.map(v=>({id:v.id,trip:v.trip,route:v.route,lat:v.lat,lon:v.lon,bearing:v.bearing,speed:v.speed,timestamp:v.timestamp,stop:v.stop,stopSequence:v.stopSequence,congestion:v.congestion,occupancy:v.occupancy,occupancyPct:v.occupancyPct,delay:v.delay})),meta:{tripUpdates:tripFeed.tripUpdates.length,unmapped:filtered.unmapped}};},12);
}
function normalizedCityRow(item,bus,index,now){const direct=Number.isFinite(bus?.minutes),minutes=direct?bus.minutes:Number.isFinite(bus?.stopsAway)?Math.max(1,bus.stopsAway*2):null;return {key:`${item.value}:${index}`,route:String(item.route),dest:item.destination,minutes,status:minutes===null?(item.noBus?'接近なし':null):null,delay:null,eta:Number.isFinite(minutes)?iso(now+minutes*60000):null,asOf:item.capturedAt,confidence:direct?0.96:Number.isFinite(bus?.stopsAway)?0.62:0.45,source:direct?'live':Number.isFinite(minutes)?'prediction':'schedule'};}
async function cityBusArrivals(request,env,url){
  const stop=url.searchParams.get('stop');
  if(!env.STOP_NAMES.includes(stop))return error('対象の停留所を選択してください。');
  return cachedJSON(request,env,`citybus:${stop}`,async()=>{
    const choices=await options(stop),unique=[...new Map(choices.map(c=>[c.value,c])).values()].slice(0,24),items=new Array(unique.length);
    let cursor=0;
    async function run(){
      while(true){
        const i=cursor++;
        if(i>=unique.length)return;
        try{items[i]=await busDataObject(env,stop,unique[i]);}
        catch{items[i]={...unique[i],buses:[],capturedAt:new Date().toISOString()};}
      }
    }
    await Promise.all(Array.from({length:Math.min(3,unique.length)},()=>run()));
    const now=Date.now(),results=items.flatMap(item=>item.buses?.length?item.buses.slice(0,2).map((b,i)=>normalizedCityRow(item,b,i,now)):[normalizedCityRow(item,null,0,now)]).slice(0,40),asOf=results.map(r=>Date.parse(r.asOf)).filter(Number.isFinite).sort((a,b)=>b-a)[0]??now;
    return {kind:'citybus-arrivals',stop,source:results.some(r=>r.source==='live')?'live':'prediction',stale:false,asOf:iso(asOf),results};
  },12);
}
async function railSnapshot(env){const r=await env.BROWSER.quickAction('content',{url:LOCATION_URL,gotoOptions:{waitUntil:'networkidle2',timeout:4000},waitForSelector:{selector:'#stations .station-name',visible:true,timeout:4000},actionTimeout:4000});if(!r.ok){await r.body?.cancel();throw Error('近鉄の列車位置を取得できませんでした。');}let html=await boundedText(r);if(r.headers.get('content-type')?.includes('json')){const b=JSON.parse(html);html=typeof b.result==='string'?b.result:typeof b.content==='string'?b.content:'';}return parseRailLocation(html);}
async function railLive(request,env){return cachedJSON(request,env,'rail:kintetsu',async()=>{const d=await railSnapshot(env),asOf=d.sourceUpdatedAt??new Date().toISOString();return {kind:'rail-live',source:'live',stale:false,asOf,trains:d.trains.map((t,i)=>({key:`${t.direction}:${t.position}:${t.destination}:${t.label}:${i}`,position:t.position,from:t.from,to:t.to,atStation:t.atStation,direction:t.direction,dest:t.destination,category:t.category,label:t.label,delay:t.delay}))};},12);}

function corsHeaders(env){return {'Access-Control-Allow-Origin':env.APP_ORIGIN,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, If-None-Match','Access-Control-Expose-Headers':'ETag, X-Captured-At, X-Source-URL','Vary':'Origin','X-Content-Type-Options':'nosniff'};}
async function finalize(request,response,env){for(const[k,v]of Object.entries(corsHeaders(env)))response.headers.set(k,v);if(response.status===200&&response.body&&request.headers.get('Accept-Encoding')?.includes('gzip')&&response.headers.get('Content-Type')?.includes('application/json')&&typeof CompressionStream!=='undefined'){const headers=new Headers(response.headers);headers.set('Content-Encoding','gzip');headers.delete('Content-Length');return new Response(response.body.pipeThrough(new CompressionStream('gzip')),{status:response.status,headers});}return response;}

export default {async fetch(request,env){
  const origin=request.headers.get('Origin'),allowed=origin===env.APP_ORIGIN,url=new URL(request.url),sourceFetch=officialFetcher(env);
  if(url.pathname==='/health')return Response.json({service:'My Map transit data',version:5,browser:Boolean(env.BROWSER),kv:Boolean(env.LIVE_KV),odpt:Boolean(env.ODPT_CONSUMER_KEY)});
  if(request.method==='OPTIONS')return allowed?new Response(null,{status:204,headers:corsHeaders(env)}):error('許可されていないオリジンです。',403);
  const publicLegacy=['/timetable/options','/timetable','/timetable/trip','/operations'].includes(url.pathname)&&!origin;if(!allowed&&!publicLegacy)return error('My Mapからご利用ください。',403);
  let response;
  try{
    if(request.method!=='GET')response=error('GETのみ利用できます。',405);
    else if(!(await env.LIMIT.limit({key:request.headers.get('CF-Connecting-IP')??'unknown'})).success)response=error('更新が続いています。少し待ってから再度お試しください。',429);
    else if(url.pathname==='/api/bus/rt')response=await kyotoBusRealtime(request,env);
    else if(url.pathname==='/api/citybus/arrivals')response=await cityBusArrivals(request,env,url);
    else if(url.pathname==='/api/rail/live')response=await railLive(request,env);
    else if(url.pathname==='/timetable/options')response=Response.json(await timetableOptions(url.searchParams.get('stop'),sourceFetch));
    else if(url.pathname==='/timetable')response=Response.json(await readTimetable(url.searchParams.get('stop'),url.searchParams.get('direction'),url.searchParams.get('day'),sourceFetch,url.searchParams.get('date')));
    else if(url.pathname==='/operations')response=Response.json(await operationInformation(sourceFetch));
    else if(url.pathname==='/rider/candidates')response=Response.json(await riderCandidates(url.searchParams.get('stop'),url.searchParams.get('date'),Number(url.searchParams.get('minute')),sourceFetch));
    else if(url.pathname==='/timetable/trip')response=Response.json(await readOfficialTrip(url.searchParams.get('stop'),url.searchParams.get('direction'),url.searchParams.get('day'),url.searchParams.get('trip'),sourceFetch));
    else if(url.pathname==='/meeting'){const raw=url.searchParams.get('request');if(!raw||raw.length>4000)response=error('合流条件を確認してください。');else{let r;try{r=validateMeeting(JSON.parse(raw));}catch(e){response=error(e.message??'合流条件を確認してください。');}if(r)response=Response.json(await findMeeting(r));}}
    else if(url.pathname==='/journeys'){const raw=url.searchParams.get('request');if(!raw||raw.length>2500)response=error('検索条件を確認してください。');else{let r;try{r=validateJourneyRequest(JSON.parse(raw));}catch(e){response=error(e.message??'検索条件を確認してください。');}if(r)response=Response.json(await searchJourney(r));}}
    else if(['/bus/options','/bus/capture','/bus/data','/bus/all'].includes(url.pathname)){const stop=url.searchParams.get('stop');if(!env.STOP_NAMES.includes(stop))response=error('対象の停留所を選択してください。');else{const choices=await options(stop);if(url.pathname==='/bus/options')response=Response.json({stop,choices});else if(url.pathname==='/bus/all')response=await busAll(env,stop,choices);else{const value=url.searchParams.get('choice'),choice=choices.find(c=>c.value===value);if(!choice)response=error('現在の系統・行先を選び直してください。');else response=url.pathname==='/bus/data'?await busData(env,stop,choice):await capture(env,approachURL(stop,value),'bus');}}}
    else if(url.pathname==='/rail/location')response=Response.json({kind:'rail-location',...(await railSnapshot(env)),capturedAt:new Date().toISOString(),sourceURL:LOCATION_URL});
    else if(url.pathname==='/rail/location/capture')response=await capture(env,LOCATION_URL,'rail');
    else if(url.pathname==='/rail/capture')response=await capture(env,RAIL,'rail');
    else response=error('ページがありません。',404);
  }catch(e){console.error('transit fetch failed',e instanceof Error?e.message:'unknown');response=error(e instanceof Error?e.message:'データの取得に失敗しました。',502);}
  return finalize(request,response,env);
}};
