import {normalize} from './network.js';
const simple=s=>normalize(String(s??'').replace(/（.*?）|\(.*?\)|駅$/g,'').replaceAll('松ケ崎','松ヶ崎'));
export function officialTripLeg(trip,network){
  const rail=trip.operator==='kintetsu',northThrough=rail&&/国際会館/.test(trip.destination);let metro=rail&&/^K/.test(trip.boardStop??'')&&trip.boardStop!=='K15';
  const stops=trip.stops.map(s=>{const n=simple(s.name),preferred=rail?(metro?'subway':'kintetsu'):trip.operator;
    const candidates=[...network.stops.values()].filter(x=>[x.name,x.fullName,...x.aliases].filter(Boolean).some(a=>simple(a)===n));
    const match=candidates.find(x=>x.type===preferred)||candidates.find(x=>rail&&['subway','kintetsu'].includes(x.type))||candidates[0];
    if(n===simple('竹田'))metro=northThrough;
    return {...s,id:match?.id??null,time:s.arrival??s.departure};
  });
  if(stops.length<2||!stops[0].id)return null;const last=stops.at(-1),depart=stops[0].departure??stops[0].arrival,arrive=last.arrival??last.departure;
  if(!Number.isFinite(depart)||!Number.isFinite(arrive)||arrive<depart)return null;
  return {kind:'ride',operator:rail&&northThrough?'through':trip.operator,category:trip.category,route:trip.route,label:trip.title,destination:trip.destination,from:stops[0].id,to:last.id??stops.filter(s=>s.id).at(-1)?.id,depart,arrive,minutes:arrive-depart,intermediate:stops.slice(1,-1),officialStops:stops,officialTrip:trip,fullTerminus:true,platform:null};
}
// Require a strong, unique match on distinct GPS updates; keep that identified train underground.
export function createAutoBoarding(){
  let key=null,since=0,lastFix=0;
  return {reset(){key=null;since=0;lastFix=0;},update(ranked,fix,mode){
    const best=ranked[0],strong=best&&best.geometry&&best.score>=80&&best.score-(ranked[1]?.score??0)>=20&&['rail','bus'].includes(mode);
    if(!strong||!fix){key=null;since=0;return null;}
    const next=JSON.stringify([best.leg.from,best.leg.depart,best.leg.destination]);if(next!==key){key=next;since=fix.timestamp;}
    if(fix.timestamp===lastFix)return null;lastFix=fix.timestamp;
    return fix.timestamp-since>=15000?best.leg:null;
  }};
}
