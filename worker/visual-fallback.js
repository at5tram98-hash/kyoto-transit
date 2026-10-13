import {KINTETSU_NAMES,kintetsuIds,normalize} from '../public/js/network.js';
import {parseRailLocation} from './rail.js';

const RAIL_NAMES=KINTETSU_NAMES.slice(0,26),RAIL_IDS=kintetsuIds.slice(0,26);
const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const stationToken=value=>normalize(clean(value).replace(/近鉄/g,'').replace(/駅/g,''));
const stationIndex=value=>{const token=stationToken(value);return RAIL_NAMES.findIndex(name=>stationToken(name)===token);};
const finite=(value,min,max)=>{if(value===null||value===undefined||value===''||typeof value==='boolean')return null;const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:null;};

async function quickActionJSON(response,label){
  if(!response?.ok){await response?.body?.cancel?.();throw Error(`${label}を取得できませんでした。`);}
  const text=await response.text();if(text.length>1024*1024)throw Error(`${label}の応答が大きすぎます。`);
  let parsed=JSON.parse(text),value=parsed?.result??parsed?.data??parsed;
  if(typeof value==='string')value=JSON.parse(value);
  if(!value||typeof value!=='object')throw Error(`${label}の形式を確認できませんでした。`);
  return value;
}

async function quickActionContent(response,label){
  if(!response?.ok){await response?.body?.cancel?.();throw Error(`${label}を取得できませんでした。`);}
  let text=await response.text();if(text.length>2*1024*1024)throw Error(`${label}の応答が大きすぎます。`);
  if(response.headers.get('content-type')?.includes('json')){
    const parsed=JSON.parse(text),value=parsed?.result??parsed?.content??parsed?.data;
    if(typeof value!=='string')throw Error(`${label}のHTMLを確認できませんでした。`);
    text=value;
  }
  return text;
}

export function normalizeVisualBus(value){
  const noBus=value?.noBus===true,buses=[];
  for(const row of Array.isArray(value?.buses)?value.buses.slice(0,8):[]){
    const stopsAway=finite(row?.stopsAway,0,6),minutes=finite(row?.minutes,0,60),congestion=['空席あり','やや混雑','混雑','満員'].includes(clean(row?.congestion))?clean(row.congestion):null;
    if(stopsAway===null&&minutes===null)continue;
    buses.push({stopsAway,minutes,congestion,text:''});
  }
  buses.sort((a,b)=>(a.minutes??a.stopsAway??99)-(b.minutes??b.stopsAway??99));
  if(!buses.length&&!noBus)throw Error('視覚情報から接近位置を確認できませんでした。');
  return {buses,noBus,message:noBus?'現在、6停留所以内に接近しているバスはありません。':null};
}

export function normalizeVisualRail(value,{now=new Date()}={}){
  const trains=[];
  for(const row of Array.isArray(value?.trains)?value.trains.slice(0,40):[]){
    const direction=row?.direction==='north'||row?.direction==='south'?row.direction:null,fromIndex=stationIndex(row?.from),toIndex=stationIndex(row?.to),destination=clean(row?.destination),category=['local','express','other'].includes(row?.category)?row.category:'other',label=clean(row?.label)||(category==='local'?'普通':category==='express'?'急行':'種別未確認'),atStation=row?.atStation===true;
    if(!direction||fromIndex<0||toIndex<0||!destination)continue;
    if(atStation&&fromIndex!==toIndex)continue;
    if(!atStation&&Math.abs(fromIndex-toIndex)!==1)continue;
    if(!atStation&&direction==='south'&&toIndex<=fromIndex)continue;
    if(!atStation&&direction==='north'&&toIndex>=fromIndex)continue;
    const delay=finite(row?.delay,-30,180),position=atStation?fromIndex*2+1:Math.min(fromIndex,toIndex)*2+2;
    trains.push({position,from:RAIL_IDS[fromIndex],to:RAIL_IDS[toIndex],atStation,direction,destination,category,label,delay,delayText:Number.isFinite(delay)&&delay?`${delay>0?'+':''}${delay}`:''});
  }
  return {stations:RAIL_IDS.map((id,i)=>({id,name:RAIL_NAMES[i]})),trains,sourceUpdatedAt:now.toISOString(),visualFallback:true,notice:'公式画面の視覚情報から復旧した列車位置。'};
}

const BUS_SCHEMA={type:'json_schema',json_schema:{type:'object',properties:{noBus:{type:'boolean'},buses:{type:'array',items:{type:'object',properties:{stopsAway:{type:'integer'},minutes:{type:'integer'},congestion:{type:'string'}},required:[]}}},required:['noBus','buses']}};
const RAIL_SCHEMA={type:'json_schema',json_schema:{type:'object',properties:{trains:{type:'array',items:{type:'object',properties:{direction:{type:'string',enum:['north','south']},from:{type:'string'},to:{type:'string'},atStation:{type:'boolean'},destination:{type:'string'},category:{type:'string',enum:['local','express','other']},label:{type:'string'},delay:{type:'number'}},required:['direction','from','to','atStation','destination','category','label']}}},required:['trains']}};

export async function visualBusApproach(env,url){
  const response=await env.BROWSER.quickAction('json',{url,prompt:'京都市バスの接近案内画面に現在表示されているバスだけを読み取ってください。各車両について何停留所前か、表示があればあと何分か、混雑表示を返してください。画面にない値は推測しないでください。6停留所以内にバスがないと明示されている場合だけnoBusをtrueにしてください。',response_format:BUS_SCHEMA});
  return normalizeVisualBus(await quickActionJSON(response,'市バスの視覚情報'));
}

export async function visualRailSnapshot(env,url){
  // Prefer the rendered official DOM. Kintetsu's page loads advertising and
  // analytics continuously, so waiting for network-idle is brittle even when
  // the train diagram itself is ready. DOMContentLoaded + the station marker
  // gives us the same official markup with deterministic parsing.
  try{
    const rendered=await env.BROWSER.quickAction('content',{
      url,
      gotoOptions:{waitUntil:'domcontentloaded',timeout:10000},
      waitForSelector:{selector:'#stations .station-name',visible:true,timeout:8000},
      waitForTimeout:1200,
      actionTimeout:10000,
    });
    const parsed=parseRailLocation(await quickActionContent(rendered,'近鉄の公式画面'));
    return {...parsed,visualFallback:true};
  }catch{}

  // Keep the visual/structured extractor as a final recovery path if Kintetsu
  // changes how the DOM is rendered but the visible diagram remains readable.
  const response=await env.BROWSER.quickAction('json',{url,gotoOptions:{waitUntil:'domcontentloaded',timeout:10000},waitForTimeout:1200,actionTimeout:12000,prompt:'近鉄京都線の列車位置画面に現在表示されている列車だけを読み取ってください。northは京都方面、southは大和西大寺方面です。停車中はfromとtoを同じ駅名にし、駅間は隣接する2駅を進行順にfrom,toへ入れてください。普通はlocal、急行はexpress、それ以外はother。行先と画面に明示された遅れだけを返し、見えない情報を推測しないでください。',response_format:RAIL_SCHEMA});
  return normalizeVisualRail(await quickActionJSON(response,'近鉄の視覚情報'));
}
