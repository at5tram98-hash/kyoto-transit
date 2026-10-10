const railRideOperators=new Set(['kintetsu','through']);
const routeNumber=value=>{const n=Number(String(value??'').match(/\d+/)?.[0]);return Number.isFinite(n)?n:9999;};
export function busDirectionLabel(route,dest=''){
  const text=String(dest).normalize('NFKC').replace(/\s+/g,'').replace(/方面$/,'');
  if(String(route)==='204'){
    if(/銀閣寺|高野/.test(text))return '高野・銀閣寺方面';
    if(/金閣寺|円町/.test(text))return '金閣寺方面';
  }
  if(!text)return '方面未確認';
  return `${text}方面`;
}
export function busServiceLabel(row){return `${row.route}（${busDirectionLabel(row.route,row.dest)}）`;}
export function groupCityBusRows(rows=[]){
  const groups=new Map();
  for(const row of rows){
    const key=`${row.route}|${String(row.dest??'').normalize('NFKC')}`;
    if(!groups.has(key))groups.set(key,{...row,key,arrivals:[],source:'schedule'});
    const group=groups.get(key);
    group.arrivals.push(row);
    if(row.source==='live')group.source='live';else if(group.source!=='live'&&row.source==='prediction')group.source='prediction';
    if(Number.isFinite(row.delay)&&(group.delay==null||Math.abs(row.delay)>Math.abs(group.delay)))group.delay=row.delay;
  }
  for(const group of groups.values())group.arrivals.sort((a,b)=>(Number.isFinite(a.minutes)?a.minutes:999)-(Number.isFinite(b.minutes)?b.minutes:999)||String(a.key).localeCompare(String(b.key)));
  return [...groups.values()].sort((a,b)=>routeNumber(a.route)-routeNumber(b.route)||busDirectionLabel(a.route,a.dest).localeCompare(busDirectionLabel(b.route,b.dest),'ja'));
}
export function busArrivalText(row){
  const minutes=(row.arrivals??[row]).map(x=>x.minutes).filter(Number.isFinite).map(x=>Math.max(0,Math.round(x)));
  if(minutes.length)return `あと${minutes.slice(0,2).join('・')}分`;
  const status=(row.arrivals??[row]).map(x=>x.status).find(Boolean);return status??'—';
}
export function shouldShowKintetsuArrival({locationStatus,rideOperator,kintetsuMeters=Infinity}={}){
  if(railRideOperators.has(rideOperator))return true;
  return locationStatus==='rail'&&Number.isFinite(kintetsuMeters)&&kintetsuMeters<=500;
}
export function relevantMissingOperators(missing=[],planned=[],fromType='',toType='',fromId='',toId=''){
  const used=new Set(planned.flatMap(route=>(route.legs??[]).filter(l=>l.kind==='ride').map(l=>l.operator)));
  if(used.size)return missing.filter(item=>used.has(item.operator));
  const needed=new Set();
  const addType=type=>{if(type==='subway')needed.add('subway');else if(type==='kintetsu')needed.add('kintetsu');else if(type==='citybus')needed.add('citybus');else if(type==='kyotobus')needed.add('kyotobus');};
  addType(fromType);addType(toType);if(fromId==='ksu'||toId==='ksu')needed.add('kyotobus');
  return missing.filter(item=>needed.has(item.operator));
}
