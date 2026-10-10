import {subwayIds,kintetsuIds} from './network.js';
// 普通運賃は大人・片道。アプリの経路検索では未設定の定期を自動適用しない。
export const DEFAULT_PASSES={citybus:true,kyotobus:true,subway:true,subwayFrom:'K01',subwayTo:'K11',expires:''};
export const FARE_SOURCES={
  citybus:{checkedAt:'2026-10-10',label:'京都市交通局 市バス運賃',url:'https://www2.city.kyoto.lg.jp/kotsu/webguide/ja/bus/howtoride_bus.html'},
  subway:{checkedAt:'2026-10-10',label:'京都市交通局 地下鉄普通運賃',url:'https://www2.city.kyoto.lg.jp/kotsu/webguide/ja/tika/howtoride_tika.html'},
  kintetsu:{checkedAt:'2026-10-10',label:'近鉄 旅客運賃表・営業キロ程表',url:'https://www.kintetsu.co.jp/gyoumu/kippu/pdf/kirotei_20260314.pdf'},
  kyotobus:{checkedAt:'2026-10-10',label:'京都バス 普通旅客運賃表 2026年3月20日実施',url:'https://www.kyotobus.jp/common/pdf/fare.pdf'}
};
export function subwayFare(km) {if(km<=0)return 0;return km<=3?220:km<=7?260:km<=11?290:km<=15?330:360;}
export function kintetsuFare(km) {if(km<=0)return 0;const rounded=Math.ceil(Math.round(km*10)/10);return [[3,180],[6,240],[10,300],[14,360],[18,430],[22,490],[26,530],[30,590],[35,680],[40,760],[45,830]].find(([max])=>rounded<=max)?.[1]??null;}
export function kyotoBusFare(block){const route=String(block.route??'').normalize('NFKC').replaceAll(' ','');if(['40','特40','直行40'].includes(route))return 230;if(new Set(block.path??[]).size<=2&&[block.from,block.to].every(id=>['kyotobus-kokusai','ksu'].includes(id)))return 230;return null;}
export function activePasses(passes,date) {return passes.expires&&date>passes.expires?{...passes,citybus:false,kyotobus:false,subway:false}:passes;}
export function estimateDirectFare(from,to,network,passes,date){
  const a=network.stops.get(from),b=network.stops.get(to);if(!a||!b||from===to)return null;
  const segment=(ids,x,y)=>{const i=ids.indexOf(x),j=ids.indexOf(y);if(i<0||j<0)return null;const path=ids.slice(Math.min(i,j),Math.max(i,j)+1);return i>j?path.reverse():path;};
  let path,operator,label,route;
  if(a.subwayKm!=null&&b.subwayKm!=null){path=segment(subwayIds,from,to);operator='subway';label='地下鉄で直行する場合';}
  else if(a.kintetsuKm!=null&&b.kintetsuKm!=null){path=segment(kintetsuIds,from,to);operator='kintetsu';label='近鉄で移動する場合';}
  else if(a.subwayKm!=null&&b.kintetsuKm>=3.6){path=[...segment(subwayIds,from,'K15'),...segment(kintetsuIds,'K15',to).slice(1)];operator='through';label='竹田経由で移動する場合';}
  else if(b.subwayKm!=null&&a.kintetsuKm>=3.6){path=[...segment(kintetsuIds,from,'K15'),...segment(subwayIds,'K15',to).slice(1)];operator='through';label='竹田経由で移動する場合';}
  else if(a.type==='kyotobus'&&b.type==='kyotobus'){path=[from,to];operator='kyotobus';route='40';label='京都バスで直行する場合';}
  else if(a.type==='citybus'&&b.type==='citybus'&&a.lines.some(line=>b.lines.includes(line))){path=[from,to];operator='citybus';label='同一市バス系統で直行する場合';}
  if(!path)return null;return {label,...summarizeFares([{kind:'ride',from,to,path,operator,route,serviceId:'direct',tripId:'direct'}],network,passes,date)};
}
export function summarizeFares(legs,network,passes,date) {
  const p=activePasses(passes,date),blocks=[];let current=null;const flush=()=>{if(current)blocks.push(current);current=null;};
  for(const leg of legs) {
    if(leg.kind==='dwell'){if(leg.exitGate)flush();continue;}if(leg.kind==='walk'){flush();continue;}
    const path=leg.path??[leg.from,leg.to];for(let i=0;i<path.length-1;i++) {
      const a=network.stops.get(path[i]),b=network.stops.get(path[i+1]);if(!a||!b)continue;
      const op=a.subwayKm!=null&&b.subwayKm!=null?'subway':a.kintetsuKm!=null&&b.kintetsuKm!=null?'kintetsu':leg.operator,kmKey=op==='subway'?'subwayKm':'kintetsuKm',dir=op==='citybus'||op==='kyotobus'?leg.serviceId:Math.sign(b[kmKey]-a[kmKey]),sameBus=op==='citybus'||op==='kyotobus';
      if(!current||current.operator!==op||current.direction!==dir||(sameBus&&current.tripId!==leg.tripId)){flush();current={operator:op,direction:dir,from:a.id,to:b.id,path:[a.id,b.id],tripId:leg.tripId,route:leg.route??null};}else{current.to=b.id;current.path.push(b.id);}
    }
  }
  flush();
  const details=blocks.map(block=>{let normal,additional,covered=false;const a=network.stops.get(block.from),b=network.stops.get(block.to);
    if(block.operator==='citybus'){normal=230;covered=Boolean(p.citybus);additional=covered?0:normal;}
    else if(block.operator==='kyotobus'){normal=kyotoBusFare(block);covered=Boolean(p.kyotobus);additional=covered?0:normal;}
    else if(block.operator==='subway'){normal=subwayFare(Math.abs(a.subwayKm-b.subwayKm));additional=normal;if(p.subway){const from=network.stops.get(p.subwayFrom)?.subwayKm,to=network.stops.get(p.subwayTo)?.subwayKm;if(from!=null&&to!=null){const lo=Math.min(a.subwayKm,b.subwayKm),hi=Math.max(a.subwayKm,b.subwayKm),passLo=Math.min(from,to),passHi=Math.max(from,to);if(lo>=passLo&&hi<=passHi){covered=true;additional=0;}else if(hi>=passLo&&lo<=passHi)additional=subwayFare(Math.max(0,passLo-lo))+subwayFare(Math.max(0,hi-passHi));}}}
    else if(a.kintetsuKm!=null&&b.kintetsuKm!=null){normal=kintetsuFare(Math.abs(a.kintetsuKm-b.kintetsuKm));additional=normal;}
    else{normal=null;additional=null;}return {...block,normal,additional,covered};});
  const sum=field=>details.some(d=>d[field]===null)?null:details.reduce((n,d)=>n+d[field],0);return {normal:sum('normal'),additional:sum('additional'),details,estimated:false};
}
