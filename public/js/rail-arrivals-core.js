import {kintetsuIds} from './network.js';
import {railTimetableEta} from './vnext-core.js';

export function buildRailArrivalRows(predicted,timetable,target,nowMinute){
  const targetIndex=kintetsuIds.indexOf(target),targetCell=targetIndex>=0?targetIndex*2+1:null;if(targetCell===null)return [];
  const rows=[];
  for(const t of predicted?.trains??[]){
    const pos=Number(t.position),approaching=t.direction==='south'?pos<=targetCell:pos>=targetCell;if(!Number.isFinite(pos)||!approaching)continue;
    const matched=Number.isFinite(nowMinute)?railTimetableEta(timetable,t,target,nowMinute):null,minutes=matched?Math.max(0,matched.minutes):null;
    if(Number.isFinite(minutes)&&minutes>30)continue;
    rows.push({...t,key:t.key??`${t.direction}:${pos}:${t.dest}`,minutes,status:matched?null:'時刻未確定',etaSource:matched?'timetable':null,source:t.predicted?'prediction':'live'});
  }
  rows.sort((a,b)=>(Number.isFinite(a.minutes)?a.minutes:Infinity)-(Number.isFinite(b.minutes)?b.minutes:Infinity)||String(a.dest).localeCompare(String(b.dest),'ja'));
  return rows.slice(0,12);
}
