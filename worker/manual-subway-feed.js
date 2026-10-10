import catalog from '../public/data/bus-catalog.json' with {type:'json'};
import {createNetwork,subwayIds} from '../public/js/network.js';
import {calendarDay} from './service-calendar.js';
import {officialFetcher,readTimetable} from './timetables.js';

const network=createNetwork(catalog);
const SOURCE='https://www2.city.kyoto.lg.jp/kotsu/tikadia/hyperdia/menu022.htm';
// Kyoto City announced the current Karasuma-line timetable revision for weekends
// from 2025-02-22 and weekdays from 2025-02-25. The fallback is regenerated from
// station departure boards and does not retain the ODPT GTFS archive.
const REVISION='2025-02-22';
const EXPECTED_RUN=2;
const MAX_GAP=4;
const serviceDay=day=>day==='weekday'?'weekday':'weekend';
const directionIds=direction=>direction==='south'?[...subwayIds]:[...subwayIds].reverse();

function uniqueTimes(entries){return [...new Set((entries??[]).map(e=>e.depart).filter(Number.isFinite))].sort((a,b)=>a-b);}
function matchNext(times,used,previous){
  let best=-1,bestScore=Infinity;
  for(let i=0;i<times.length;i++){
    if(used.has(i))continue;const gap=times[i]-previous;if(gap<1)continue;if(gap>MAX_GAP)break;
    const score=Math.abs(gap-EXPECTED_RUN);if(score<bestScore){best=i;bestScore=score;}
  }
  if(best>=0)used.add(best);return best>=0?times[best]:null;
}

export function compileSubwayDirection(boardByStop,{direction,date,checkedAt=new Date().toISOString()}={}){
  const ids=directionIds(direction),origin=ids[0],terminal=ids.at(-1),originTimes=uniqueTimes(boardByStop.get(origin));
  if(!originTimes.length)throw Error(`地下鉄${direction}の始発駅時刻がありません。`);
  const timesByStop=new Map(ids.slice(1,-1).map(id=>[id,uniqueTimes(boardByStop.get(id))]));
  const usedByStop=new Map([...timesByStop].map(([id])=>[id,new Set()])),trips=[];
  for(let n=0;n<originTimes.length;n++){
    const stops=[origin],times=[originTimes[n]];let previous=originTimes[n];
    for(const id of ids.slice(1,-1)){
      const matched=matchNext(timesByStop.get(id)??[],usedByStop.get(id)??new Set(),previous);if(!Number.isFinite(matched))break;
      stops.push(id);times.push(matched);previous=matched;
    }
    // Only add the terminal when the train was observed at every intermediate
    // station. The terminal's arrival minute is the sole derived value because
    // there is no same-direction departure board at the terminal.
    if(stops.at(-1)===ids.at(-2)){stops.push(terminal);times.push(previous+EXPECTED_RUN);}
    if(stops.length<2)continue;
    trips.push({id:`subway:${direction}:${date}:${n}:${originTimes[n]}`,date,stops,arrivals:times,departures:times,headsign:network.stops.get(stops.at(-1))?.name??''});
  }
  const complete=trips.filter(t=>t.stops.at(-1)===terminal).length;
  if(complete<Math.min(10,Math.max(1,Math.floor(originTimes.length*.5))))throw Error(`地下鉄${direction}の全線時刻を十分に照合できませんでした（${complete}/${originTimes.length}）。`);
  const groups=new Map();
  for(const trip of trips){const signature=trip.stops.join(',');if(!groups.has(signature))groups.set(signature,{id:`manual:subway:${direction}:${signature}`,operator:'subway',label:'地下鉄烏丸線',category:'local',stops:trip.stops,trips:[]});const {stops,...row}=trip;groups.get(signature).trips.push(row);}
  return {services:[...groups.values()],tripCount:trips.length,completeCount:complete};
}

export function compileSubwayBoards(boardByStop,{date,day,checkedAt=new Date().toISOString()}={}){
  const north=compileSubwayDirection(boardByStop.north,{direction:'north',date,checkedAt}),south=compileSubwayDirection(boardByStop.south,{direction:'south',date,checkedAt}),used=new Set([...north.services,...south.services].flatMap(s=>s.stops));
  return {schemaVersion:1,source:SOURCE,revisionDate:REVISION,lastUpdated:checkedAt,validDates:[date],stops:[...used].map(id=>({id,name:network.stops.get(id)?.name??id,type:'subway'})),services:[...north.services,...south.services],walks:[],meta:{operator:'subway',revisionDate:REVISION,lastUpdated:checkedAt,stale:false,warning:null,method:'official-station-timetable-json',day:serviceDay(day),tripCount:north.tripCount+south.tripCount,completeCount:north.completeCount+south.completeCount,terminalArrivalDerived:true}};
}

async function mapLimit(items,limit,fn){const out=new Array(items.length);let cursor=0;async function run(){for(;;){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i]);}catch(e){out[i]={error:String(e?.message??e)};}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return out;}
async function readDirection(fetcher,date,day,direction){
  const ids=directionIds(direction).slice(0,-1),rows=await mapLimit(ids,4,async id=>({id,board:await readTimetable(id,direction,day,fetcher,date)})),map=new Map(),errors=[];
  for(const row of rows){if(row?.error)errors.push(row.error);else map.set(row.id,row.board.entries??[]);}if(errors.length)throw Error(`地下鉄公式時刻表の取得に失敗しました（${errors.length}駅）。`);return map;
}
export async function buildSubwayPattern(env,date){
  const day=calendarDay(date,'subway');if(!day)throw Error('地下鉄の曜日種別を判定できません。');const fetcher=officialFetcher(env),[north,south]=await Promise.all([readDirection(fetcher,date,day,'north'),readDirection(fetcher,date,day,'south')]);
  return compileSubwayBoards({north,south},{date,day});
}
export async function refreshSubwayPattern(env,date){if(!env.LIVE_KV)throw Error('LIVE_KVが未設定です。');const feed=await buildSubwayPattern(env,date),key=`manual:subway:${serviceDay(calendarDay(date,'subway'))}`;await env.LIVE_KV.put(key,JSON.stringify(feed));await env.LIVE_KV.put('manual:subway:status',JSON.stringify({checkedAt:feed.lastUpdated,revisionDate:feed.revisionDate,tripCount:feed.meta.tripCount,completeCount:feed.meta.completeCount,day:feed.meta.day,terminalArrivalDerived:true}));return feed;}
export async function readSubwayPattern(env,date){const day=calendarDay(date,'subway');if(!day)return null;const raw=await env.LIVE_KV?.get(`manual:subway:${serviceDay(day)}`);if(!raw)return null;const source=JSON.parse(raw),age=Date.now()-Date.parse(source.lastUpdated),stale=!Number.isFinite(age)||age>14*86400_000;return {...source,validDates:[date],services:source.services.map(s=>({...s,trips:s.trips.map(t=>({...t,date}))})),meta:{...source.meta,stale,warning:stale?'地下鉄の時刻データを確認してください。':null}};}
