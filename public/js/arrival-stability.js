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
export function busServiceLabel(row){const board=String(row?.boarding??'').trim();return `${row.route}（${busDirectionLabel(row.route,row.dest)}）${board?` ${board}`:''}`;}
const effectiveBusSource=row=>row.source??'schedule';
const congestionRank=value=>({満員:5,'大変混雑':4,混雑:3,'ゆったり立てる':2,'空席あり':1}[value]??0);
export function normalizeCongestion(value){
  const text=String(value??'').normalize('NFKC').trim();
  if(/満員/.test(text))return '満員';
  if(/大変混雑|たいへん混雑/.test(text))return '大変混雑';
  if(/ゆったり立て/.test(text))return 'ゆったり立てる';
  if(/混雑/.test(text))return '混雑';
  if(/空席|すいて|空いて|通常|普通/.test(text))return '空席あり';
  return '';
}
export function groupCityBusRows(rows=[]){
  const groups=new Map();
  for(const row of rows){
    const key=`${row.route}|${String(row.dest??'').normalize('NFKC')}|${String(row.boarding??'').normalize('NFKC')}`;
    if(!groups.has(key))groups.set(key,{...row,key,arrivals:[],source:'schedule',congestion:''});
    const group=groups.get(key),source=effectiveBusSource(row);
    group.arrivals.push({...row,source});
    if(source==='live')group.source='live';else if(group.source!=='live'&&source==='prediction')group.source='prediction';
    if(Number.isFinite(row.delay)&&(group.delay==null||Math.abs(row.delay)>Math.abs(group.delay)))group.delay=row.delay;
    const c=normalizeCongestion(row.congestion);if(congestionRank(c)>congestionRank(group.congestion))group.congestion=c;
  }
  for(const group of groups.values())group.arrivals.sort((a,b)=>{
    const am=Number.isFinite(a.minutes)?a.minutes:Infinity,bm=Number.isFinite(b.minutes)?b.minutes:Infinity;if(am!==bm)return am-bm;
    const as=Number.isFinite(a.stopsAway)?a.stopsAway:Infinity,bs=Number.isFinite(b.stopsAway)?b.stopsAway:Infinity;return as-bs||String(a.key).localeCompare(String(b.key));
  });
  return [...groups.values()].sort((a,b)=>routeNumber(a.route)-routeNumber(b.route)||busDirectionLabel(a.route,a.dest).localeCompare(busDirectionLabel(b.route,b.dest),'ja')||String(a.boarding??'').localeCompare(String(b.boarding??''),'ja'));
}
function arrivalLabel(row){
  if(Number.isFinite(row?.minutes))return `あと${Math.max(0,Math.round(row.minutes))}分`;
  if(Number.isFinite(row?.stopsAway))return `${Math.max(0,Math.round(row.stopsAway))}停留所前`;
  return row?.status??'';
}
export function busArrivalText(row){
  const labels=(row.arrivals??[row]).map(arrivalLabel).filter(Boolean).slice(0,2);
  return labels.length?labels.join('・'):'—';
}
export function busCongestionText(row){
  const first=(row.arrivals??[row]).find(x=>normalizeCongestion(x.congestion));
  return normalizeCongestion(first?.congestion??row?.congestion)||'—';
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
