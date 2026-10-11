import {parseApproachAll} from './bus.js';

const POC='https://kyotocity.bus-navigation.jp/wgsys/wgs_kyt/';
const VALUE=/^\d{9};\d+:\d+:\d+(,\d+:\d+:\d+)*$/;
const DEFAULT_ROUTES=new Set(['10','13','43','46','78','93','202','204','205','206','208']);
const blankKeys=['selectedLandmarkCatCd','fromlat','fromlng','tolat','tolng','fromSignpoleKey','routeLayoutCd','fromBusStopCd','toBusStopCd','routeKey','nextDiagramFlag','diaRevisedDate','timeTableDirevtionCd','searchDate','searchTime','fromBusStopKey','toBusStopKey','lineSelected','informationTextId','search_map_from','search_map_to','toDisplayPassNo','busCode','formerApproachLat','formerApproachLng','formerApproachGuidance','informationFromTextId','informationToTextId','informationRouteId','busstopCdnum','vehicleScrollPosition','routeSelectNo'];

export function uniqueBusChoices(choices=[]){return [...new Map(choices.filter(c=>c?.value).map(c=>[c.value,c])).values()];}
function parsedChoice(choice,allowedRoutes=DEFAULT_ROUTES){
  const value=String(choice?.value??'');if(!VALUE.test(value))throw Error('市バスの系統情報が変更されています。');
  const [dest,raw]=value.split(';'),route=String(Number(dest.slice(0,3)));if(!allowedRoutes.has(route))throw Error(`対象外の市バス系統です（${route}）。`);
  const parts=raw.split(',').map(v=>v.split(':'));if(parts.some(v=>v.length!==3))throw Error('市バスの方面情報を解析できません。');
  return {dest,route,parts};
}
export function approachAllURL(stop,choices,{allowedRoutes=DEFAULT_ROUTES}={}){
  const selected=uniqueBusChoices(choices);if(!selected.length)throw Error('接近情報の方面がありません。');if(selected.length>10)throw Error('市バス公式画面は一度に10方面までです。');
  const parsed=selected.map(choice=>parsedChoice(choice,allowedRoutes));
  const p=new URLSearchParams({
    tabName:'approachGuidance',from:stop,fromType:'',to:'',toType:'',locale:'ja',bsid:'1',targetTabName:'busStopSearchTab',busStopName:stop,mapFlag:'false',existYn:'',
    destinationCd:parsed.map(x=>x.dest).join(','),
    routeKeys:parsed.map(x=>x.parts.map(v=>v[0]).join(',')).join('_'),
    fromDisplayPassNo:parsed.map(x=>x.parts.map(v=>v[2]).join(',')).join('_'),
    fromSignpoleStringKey:parsed.map(x=>x.parts.map(v=>v[1]).join(',')).join('_'),
    routeKeynum:String(selected.length),autoRefreshTime:'0'
  });
  for(const key of blankKeys)p.set(key,'');
  return `${POC}approachGuidance.htm?${p}`;
}
export function batchBusChoices(choices=[],size=10){const selected=uniqueBusChoices(choices),out=[];for(let i=0;i<selected.length;i+=Math.max(1,size))out.push(selected.slice(i,i+Math.max(1,size)));return out;}
async function htmlText(response){const text=await response.text();if(text.length>2_000_000)throw Error('市バス接近ページが大きすぎます。');return text;}
export async function fetchAllSelectedApproach(stop,choices,{fetcher=fetch,timeout=9000,allowedRoutes=DEFAULT_ROUTES}={}){
  const selected=uniqueBusChoices(choices),url=approachAllURL(stop,selected,{allowedRoutes}),controller=new AbortController(),timer=setTimeout(()=>controller.abort('timeout'),timeout);
  try{
    const response=await fetcher(url,{headers:{'User-Agent':'Mozilla/5.0 My Map transit reader','Accept':'text/html,application/xhtml+xml'},signal:controller.signal,cache:'no-store'});
    if(!response.ok){await response.body?.cancel?.();throw Error(`市バス接近情報 HTTP ${response.status}`);}
    const capturedAt=new Date().toISOString(),parsed=parseApproachAll(await htmlText(response),selected);
    return {stop,capturedAt,sourceURL:url,results:parsed.map(item=>({kind:'bus-data',stop,...item,capturedAt,sourceURL:url}))};
  }finally{clearTimeout(timer);}
}
