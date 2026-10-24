// Per-stop official boards for the city bus fallback. Each route's stops have
// their own published departure board; times read from them replace the
// segment-minute estimates, so a stop shows the time the operator prints.
// Boards are gathered a few at a time by a separate cron (subrequest limits)
// and kept per route in KV.
import catalog from '../public/data/bus-catalog.json' with {type:'json'};
import {normalize} from '../public/js/network.js';
import {officialText,parseCityCatalog,parseHyperdia} from './timetables.js';

export const BOARD_FILL_BUDGET=36;
export const BOARD_FILL_CRON='45 * * * *';
const BOARD_MAX_AGE=4*86400_000;
const BOARD_TTL=14*86400;
const DAYS=['weekday','saturday','holiday'];
const boardKey=route=>`static:citybus-boards:${route}`;
const tokyoDate=ms=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
const rebuildDates=now=>[tokyoDate(now-86400_000),tokyoDate(now),tokyoDate(now+86400_000)];

export async function readRouteBoards(env,route){
  const raw=await env.LIVE_KV?.get(boardKey(route));if(!raw)return {boards:{}};
  try{const value=JSON.parse(raw);return value&&typeof value.boards==='object'?value:{boards:{}};}catch{return {boards:{}};}
}
const compactDays=parsed=>Object.fromEntries(DAYS.map(day=>[day,(parsed.days?.[day]??[]).map(e=>e.depart).filter(Number.isFinite).sort((a,b)=>a-b)]));

// Fetches up to `budget` missing or old boards of the route with the most
// missing, and writes that route once.
export async function fillCityBusBoards(env,fetcher,{budget=BOARD_FILL_BUDGET,now=Date.now(),routes=Object.keys(catalog)}={}){
  if(!env.LIVE_KV)throw Error('LIVE_KVが未設定です。');
  const plans=[];
  for(const route of routes){
    const source=catalog[route]?.source;if(!source)continue;
    const record=await readRouteBoards(env,route),urls=[...new Set(parseCityCatalog(await officialText(source,fetcher,3600),source).flatMap(r=>r.boards.map(b=>b.sourceURL)))];
    const due=urls.filter(url=>!(now-Date.parse(record.boards[url]?.at??0)<BOARD_MAX_AGE));
    plans.push({route,record,urls,due,missing:urls.filter(url=>!record.boards[url]).length});
    budget--;
  }
  plans.sort((a,b)=>b.missing-a.missing||b.due.length-a.due.length);
  const out=[];
  for(const plan of plans){
    if(budget<=0||!plan.due.length)continue;
    const boards=Object.fromEntries(Object.entries(plan.record.boards).filter(([url])=>plan.urls.includes(url)));let fetched=0;
    for(const url of plan.due){if(budget<=0)break;budget--;try{boards[url]={at:new Date(now).toISOString(),days:compactDays(parseHyperdia(await officialText(url,fetcher,1800)))};fetched++;}catch{}}
    await env.LIVE_KV.put(boardKey(plan.route),JSON.stringify({route:plan.route,updatedAt:new Date(now).toISOString(),boards}),{expirationTtl:BOARD_TTL});
    // Once a route's boards are all in, its day records are rebuilt from them
    // at the next refresh step (the published feed stays until then).
    if(fetched&&Object.keys(boards).length===plan.urls.length)for(const date of rebuildDates(now))await env.LIVE_KV.delete(`static:fallback:citybus-route:${plan.route}:${date}`);
    out.push({route:plan.route,fetched,stored:Object.keys(boards).length,total:plan.urls.length});
    // One route per run keeps KV writes to one an hour (free-plan quota).
    break;
  }
  return {routes:out};
}

// Pairs the predicted times with a board's departures in order, each within
// `tolerance` minutes. Returns the matched time per trip (or null).
export function matchBoard(predicted,departs,tolerance=7,floors=[]){
  const out=predicted.map(()=>null);let cursor=0,last=-Infinity;
  predicted.forEach((p,i)=>{
    if(!Number.isFinite(p))return;
    while(cursor<departs.length&&(departs[cursor]<p-tolerance||departs[cursor]<=last))cursor++;
    let best=-1;
    for(let j=cursor;j<departs.length&&departs[j]<=p+tolerance;j++)if(departs[j]>last&&departs[j]>=(floors[i]??-Infinity)&&(best<0||Math.abs(departs[j]-p)<Math.abs(departs[best]-p)))best=j;
    // Leave the closer board time to the next trip when it fits that trip better.
    const next=predicted[i+1];
    if(best>=0&&Number.isFinite(next)&&departs[best]>p&&Math.abs(departs[best]-next)<Math.abs(departs[best]-p)){
      const earlier=departs.slice(cursor,best).findLastIndex(t=>t>last&&t>=p-tolerance&&t>=(floors[i]??-Infinity));best=earlier>=0?cursor+earlier:-1;
    }
    if(best>=0){out[i]=departs[best];last=departs[best];cursor=best+1;}
  });
  return out;
}

// Replaces estimated stop times with each stop's official board where the
// board's departures line up with the trips. Times between two read stops
// are spread by the segment minutes. Returns the stop indexes read.
export function anchorTrips(trips,service,boardsFor,day){
  const offsets=service.offsets??[],count=service.stops?.length??0;if(!trips.length||count<2)return [];
  const anchors=trips.map(t=>new Map([[0,t.departures[0]]])),read=[0];
  for(let k=1;k<count-1;k++){
    // A bus never leaves a stop before it left the previous one.
    // The further the last read stop, the looser the segment estimate.
    const lastRead=anchors.map(a=>[...a].at(-1)),predicted=lastRead.map(([j,at])=>at+(offsets[k]-offsets[j])),floors=lastRead.map(([,at])=>at);
    const tolerance=Math.min(15,7+0.3*Math.max(0,...lastRead.map(([j])=>offsets[k]-offsets[j])));
    let bestMatch=null,bestCount=0;
    for(const days of boardsFor(k)){
      const match=matchBoard(predicted,days?.[day]??[],tolerance,floors),hits=match.filter(v=>v!==null).length;
      if(hits>bestCount){bestCount=hits;bestMatch=match;}
    }
    if(!bestMatch||bestCount<Math.max(2,Math.ceil(trips.length*0.5)))continue;
    bestMatch.forEach((time,i)=>{if(time!==null)anchors[i].set(k,time);});read.push(k);
  }
  trips.forEach((trip,i)=>{
    const points=[...anchors[i]],times=[];
    for(let s=0;s<count;s++){
      const after=points.findIndex(([k])=>k>=s);
      if(after>=0&&points[after][0]===s){times.push(points[after][1]);continue;}
      const [j,tj]=points[after>0?after-1:points.length-1];
      if(after<0){times.push(Math.round(tj+(offsets[s]-offsets[j])));continue;}
      const [k,tk]=points[after],span=offsets[k]-offsets[j];
      times.push(Math.round(span>0?tj+(tk-tj)*(offsets[s]-offsets[j])/span:tj));
    }
    trip.departures=times;trip.arrivals=times;
  });
  return read;
}

// The boards to try at each stop index of a service: those of the stop's
// row in the route catalog that are already stored. A board is named by the
// destinations it serves, so boards naming stops still ahead on this service
// are preferred; the opposite direction's board is never tried when one fits.
const labelWords=label=>String(label??'').split(/[・、\s]+/).map(w=>normalize(w.replace(/(?:行き?|方面|経由)$/,''))).filter(w=>w.length>=2);
export function stopBoards(service,rows,record,stopName){
  return k=>{
    const row=rows.find(r=>normalize(r.name)===normalize(stopName(service.stops[k])));
    const ahead=service.stops.slice(k+1).map(id=>normalize(stopName(id))).filter(Boolean);
    const scored=(row?.boards??[]).filter(b=>record.boards?.[b.sourceURL]?.days).map(b=>({days:record.boards[b.sourceURL].days,score:labelWords(b.label).filter(w=>ahead.some(n=>n.includes(w)||w.includes(n))).length}));
    const top=Math.max(0,...scored.map(b=>b.score));
    return scored.filter(b=>b.score===top).map(b=>b.days);
  };
}
