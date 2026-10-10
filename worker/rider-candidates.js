import catalog from '../public/data/bus-catalog.json' with {type:'json'};
import {createNetwork,kintetsuIds,normalize} from '../public/js/network.js';
import {timetableOptions,readTimetable,readOfficialTrip} from './timetables.js';
const network=createNetwork(catalog);
export async function riderCandidates(stopId,date,minute,fetcher=fetch){
  const stop=network.stops.get(stopId);if(!stop||!Number.isInteger(minute)||minute<0||minute>=1440)throw Error('現在の駅・時刻を確認してください。');
  const ids=[stopId];if(stop.type==='kintetsu'){const i=kintetsuIds.indexOf(stopId);if(i>0)ids.push(kintetsuIds[i-1]);if(i<25)ids.push(kintetsuIds[i+1]);}
  const trips=[],unavailable=[];
  // Bound fan-out; one app request, at most six official trip detail reads.
  for(const id of ids){
    try{const options=await timetableOptions(id,fetcher);
      for(const direction of options.boards.slice(0,3)){
        const board=await readTimetable(id,direction.key,'auto',fetcher,date);
        const entries=board.entries.filter(e=>e.tripId&&e.category!=='other'&&e.depart>=minute-25&&e.depart<=minute+2).sort((a,b)=>b.depart-a.depart).slice(0,id===stopId?2:1);
        for(const e of entries){if(trips.length>=6)break;const trip=await readOfficialTrip(id,direction.key,board.day,e.tripId,fetcher);if(!trips.some(t=>t.tripId===trip.tripId))trips.push({...trip,boardStop:id,direction:direction.key,date,day:board.day});}
      }
    }catch(e){unavailable.push({stop:id,message:e.message});}
  }
  return {kind:'rider-candidates',trips,unavailable,fetchedAt:new Date().toISOString(),notice:'公式の便候補です。乗車便は端末内の位置・進行方向と照合して推定します。'};
}
