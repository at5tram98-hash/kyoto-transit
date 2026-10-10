import {timetableOptions,readTimetable,officialFetcher} from './timetables.js';
import {createNetwork} from '../public/js/network.js';
import catalog from '../public/data/bus-catalog.json' with {type:'json'};

const network=createNetwork(catalog);
const isoDateFromLabel=value=>{const m=String(value??'').match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:null;};
const groupHours=entries=>Object.fromEntries([...new Set(entries.map(e=>Math.floor(e.depart/60)))].sort((a,b)=>a-b).map(h=>[String(h),entries.filter(e=>Math.floor(e.depart/60)===h).map(e=>({minute:e.depart%60,category:e.category??'local',destination:e.destination??null,tripId:e.tripId??null}))]));
export async function buildOfficialBoard(env,{operator,stop,direction,day='auto',date}){
  const s=network.stops.get(stop);if(!s||s.type!==operator)throw Error('駅を確認してください。');if(!['subway','kintetsu'].includes(operator))throw Error('対象外の鉄道です。');
  const fetcher=officialFetcher(env),options=await timetableOptions(stop,fetcher),boardInfo=options.boards.find(b=>b.key===direction);if(!boardInfo)throw Error('方面を確認してください。');
  const board=await readTimetable(stop,direction,day,fetcher,date),revisionDate=isoDateFromLabel(board.effective)||isoDateFromLabel(board.legend)||null;
  return {schemaVersion:1,operator,station:{id:stop,name:s.name},direction,day:board.day,date:date??null,revisionDate,checkedAt:new Date().toISOString(),sourceURL:board.sourceURL,platform:board.platform??null,hours:groupHours(board.entries??[])};
}
export async function readOfficialBoard(env,params){
  const date=params.date,key=`manual:${params.operator}:${params.stop}:${params.direction}:${params.day??'auto'}:${date??'today'}`,saved=await env.LIVE_KV?.get(key);if(saved){const data=JSON.parse(saved),age=Date.now()-Date.parse(data.checkedAt);if(Number.isFinite(age)&&age<6*3600_000)return {...data,cached:true};}
  const data=await buildOfficialBoard(env,params);await env.LIVE_KV?.put(key,JSON.stringify(data),{expirationTtl:30*86400});return data;
}
export function boardWarning(board,now=Date.now()){const checked=Date.parse(board?.checkedAt),revision=Date.parse(board?.revisionDate);if(!Number.isFinite(checked)||now-checked>14*86400_000)return '時刻表の確認日が古くなっています。';if(Number.isFinite(revision)&&now-revision>400*86400_000)return 'ダイヤ改正情報を確認してください。';return null;}
