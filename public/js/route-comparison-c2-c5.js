// Presentation-only route metrics. No synthetic journeys, costs or timings.
export function routeFacts(route) {
  const rideLegs=(route?.legs??[]).filter(l=>l.kind==="ride");
  const walking=(route?.legs??[]).filter(l=>l.kind==="walk").reduce((v,l)=>v+(Number.isFinite(l.minutes)?l.minutes:0),0);
  const waits=(route?.legs??[]).filter(l=>l.kind==="wait").reduce((v,l)=>v+(Number.isFinite(l.minutes)?l.minutes:0),0);
  const transfers=Number.isFinite(route?.transfers)?route.transfers:Math.max(0,rideLegs.length-1);
  const fare=Number.isFinite(route?.fare?.additional)?route.fare.additional:null;
  const arrival=Number.isFinite(route?.time)?route.time:null;
  // Use the same displayed departure as the route card. If the first leg
  // is a train, the card starts at the actual departure, not an earlier
  // planner-ready time; walking routes retain their start time.
  const initial = route?.legs?.[0];
  const displayed = initial?.kind==="ride" ? initial.depart : route?.start;
  const departure=Number.isFinite(displayed)?displayed:null;
  const duration=departure!==null&&arrival!==null?Math.max(0,arrival-departure):null;
  return {walking,waits,transfers,fare,arrival,departure,duration,rideLegs:rideLegs.length};
}
export function routeComparison(routes=[]){
  const metrics=routes.map(routeFacts);
  const best=(key)=>Math.min(...metrics.map(m=>m[key]).filter(Number.isFinite));
  return metrics.map(m=>({
    ...m,
    fastest: Number.isFinite(m.duration)&&m.duration===best("duration"),
    fewestTransfers:Number.isFinite(m.transfers)&&m.transfers===best("transfers"),
    leastWalking:Number.isFinite(m.walking)&&m.walking===best("walking"),
    cheapest:m.fare!==null&&m.fare===best("fare"),
  }));
}
export function transferRisk(route,bufferMinutes=3){
  const legs=route?.legs??[];
  const gaps=[];
  for(let i=1;i<legs.length;i++){
    const next=legs[i];
    if(next.kind!=="ride")continue;
    let j=i-1;
    while(j>=0 && legs[j].kind!=="ride")j--;
    if(j<0)continue;
    const previous=legs[j];
    // The time between two rides already includes walking and dwell; count
    // actual usable margin after required intermediate movements.
    const required=legs.slice(j+1,i)
      .reduce((sum,leg)=>sum+(Number.isFinite(leg.minutes)?leg.minutes:0),0);
    const gap=next.depart-previous.arrive-required;
    if(Number.isFinite(gap))gaps.push(gap);
  }
  const shortest=gaps.length?Math.min(...gaps):null;
  return {
    shortest,
    critical:shortest!==null&&shortest<bufferMinutes,
    tight:shortest!==null&&shortest<bufferMinutes+2,
    hasTransfer:gaps.length>0,
  };
}
