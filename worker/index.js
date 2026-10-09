// Public transport pages only. Browser credentials and arbitrary URLs are never accepted.
import {boundedText,searchJourney,validateJourneyRequest} from './journeys.js';
import {parseApproach} from './bus.js';
const POC='https://kyotocity.bus-navigation.jp/wgsys/wgs_kyt/';
const RAIL='https://www.kintetsu.jp/unkou/unkou.html';
const ROUTES=new Set(['10','13','43','78','202','204','205','206','208']);
const clean=s=>s.replace(/\s+/g,' ').trim();
const error=(message,status=400)=>Response.json({error:message},{status});

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
    const block=match[0];
    const b=block.match(/([A-ZＡ-Ｚ]\s*のりば)/);if(b)board=clean(b[1]);
    if(!block.includes('route-row-data'))continue;
    const input=block.match(/<input\b[^>]*name="rowCheckDataItem"[^>]*value="([^"]+)"/i);
    if(!input)continue;const value=input[1],route=String(Number(value.slice(0,3)));
    if(!ROUTES.has(route))continue;
    const dest=block.match(/id="destinationAbbreviation_data"[^>]*>([\s\S]*?)<\/p>/i)?.[1]??'';
    const destination=clean(dest.replace(/<[^>]+>/g,' ')).replace(/&amp;/g,'&').replace(/&nbsp;/g,' ');
    if(destination)rows.push({boarding:board,value,destination,route});
  }
  return rows;
}
async function options(stop){
  const response=await fetch(selectionURL(stop),{headers:{'User-Agent':'My Map/1.0 (transport page reader)','Accept':'text/html'},signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();throw Error(`ポケロケの停留所検索を取得できませんでした（HTTP ${response.status}）。`);}
  return parseBusChoices(await boundedText(response));
}
async function busData(env,stop,choice){
  const url=approachURL(stop,choice.value);
  const response=await env.BROWSER.quickAction('content',{url,gotoOptions:{waitUntil:'networkidle2',timeout:20000},waitForSelector:{selector:'#approach_table',visible:true,timeout:10000},actionTimeout:12000});
  if(!response.ok){await response.body?.cancel();throw Error('公式の接近情報を取得できませんでした。時間をおいて再度お試しください。');}
  let html=await boundedText(response);
  if(response.headers.get('content-type')?.includes('json')){const body=JSON.parse(html);html=typeof body.result==='string'?body.result:typeof body.content==='string'?body.content:'';}
  return Response.json({kind:'bus-data',stop,...choice,...parseApproach(html),capturedAt:new Date().toISOString(),sourceURL:url});
}
async function capture(env,url,source){
  const params={url,viewport:{width:480,height:1000,deviceScaleFactor:2},gotoOptions:{waitUntil:'networkidle2',timeout:20000},screenshotOptions:{type:'png',fullPage:true},actionTimeout:12000};
  if(source==='bus')params.waitForSelector={selector:'#approach_table',visible:true,timeout:10000};
  const r=await env.BROWSER.quickAction('screenshot',params);
  if(!r.ok){await r.body?.cancel();throw Error('公式画面を取得できませんでした。時間をおいて再度お試しください。');}
  if(!r.headers.get('content-type')?.startsWith('image/')){await r.body?.cancel();throw Error('画像として取得できませんでした。');}
  const headers=new Headers({'Content-Type':'image/png','Cache-Control':'private, no-store','X-Captured-At':new Date().toISOString(),'X-Source-URL':encodeURIComponent(url),'X-Content-Type-Options':'nosniff'});
  return new Response(r.body,{headers});
}
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin'),allowed=origin===env.APP_ORIGIN;
    const cors={'Access-Control-Allow-Origin':env.APP_ORIGIN,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Expose-Headers':'X-Captured-At, X-Source-URL','Vary':'Origin','Cache-Control':'no-store'};
    const url=new URL(request.url);
    if(url.pathname==='/health')return Response.json({service:'My Map 乗換・接近情報',version:2,browser:Boolean(env.BROWSER)});
    if(!allowed)return error('My Mapからご利用ください。',403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    let response;
    try{
      if(request.method!=='GET')response=error('GETのみ利用できます。',405);
      else if(!(await env.LIMIT.limit({key:request.headers.get('CF-Connecting-IP')??'unknown'})).success)response=error('更新が続いています。1分ほど待ってください。',429);
      else if(url.pathname==='/journeys'){
        const raw=url.searchParams.get('request');if(!raw||raw.length>2500)response=error('検索条件を確認してください。');
        else{let r;try{r=validateJourneyRequest(JSON.parse(raw));}catch(e){response=error(e.message??'検索条件を確認してください。');}if(r)response=Response.json(await searchJourney(r));}
      }
      else if(['/bus/options','/bus/capture','/bus/data'].includes(url.pathname)){
        const stop=url.searchParams.get('stop');
        if(!env.STOP_NAMES.includes(stop))response=error('対象の停留所を選択してください。');
        else{
          const choices=await options(stop);
          if(url.pathname==='/bus/options')response=Response.json({stop,choices});
          else{
            const value=url.searchParams.get('choice');
            const choice=choices.find(c=>c.value===value);
            if(!choice)response=error('現在の系統・行先を選び直してください。');
            else response=url.pathname==='/bus/data'?await busData(env,stop,choice):await capture(env,approachURL(stop,value),'bus');
          }
        }
      }else if(url.pathname==='/rail/capture')response=await capture(env,RAIL,'rail');
      else response=error('ページがありません。',404);
    }catch(e){console.error('capture failed',e instanceof Error?e.message:'unknown');response=error(e instanceof Error?e.message:'公式画面の取得に失敗しました。',502);}
    for(const [k,v]of Object.entries(cors))response.headers.set(k,v);
    return response;
  }
};
