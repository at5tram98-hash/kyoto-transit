import {searchStops,kintetsuIds} from './network.js';
import {$,esc,icon,state,nearest,toast,tokyoNow} from './vnext-state.js';
import {ARRIVAL_INTERVAL,getCached,fetchRealtime,predictCityBus,predictRail,isFresh,createLiveLoop,realtimeLog,interpolateCityBusRecovery,interpolateRailRecovery} from './realtime.js';
import {CAPTURE_API} from './live.js';
import {railTimetableEta} from './vnext-core.js';

const STORE='mymap-arrivals-v3';
const saved=()=>{try{return JSON.parse(localStorage.getItem(STORE)||'{}');}catch{return {};}};
const persist=value=>localStorage.setItem(STORE,JSON.stringify(value));
const cityStops=network=>[...network.stops.values()].filter(s=>s.type==='citybus');
const stopName=stop=>stop?.fullName??stop?.name??'';
const sourceDot=source=>`<i class="source-dot ${source==='live'?'live':source==='prediction'?'prediction':'schedule'}" aria-hidden="true"></i>`;
const delayText=d=>Number.isFinite(d)?Math.abs(Math.round(d))<1?'定刻':`${Math.abs(Math.round(d))}分${d>0?'遅れ':'早め'}`:'—';
const minuteText=r=>Number.isFinite(r.minutes)?`あと${Math.max(0,Math.round(r.minutes))}分`:r.status??'—';

function keyedRows(root,rows,render){
  [...root.children].filter(el=>!el.dataset.key).forEach(el=>el.remove());
  const old=new Map([...root.querySelectorAll('[data-key]')].map(el=>[el.dataset.key,el]));
  for(const row of rows){const key=String(row.key),html=render(row),hash=JSON.stringify(row);let el=old.get(key);if(!el){el=document.createElement('article');el.dataset.key=key;el.className='arrival-line';}if(el.dataset.hash!==hash){el.dataset.hash=hash;el.innerHTML=html;}root.append(el);old.delete(key);}for(const el of old.values())el.remove();
}
function busRow(r){return `<div class="arrival-service">${sourceDot(r.source)}<b>${esc(r.route)}系統</b></div><div class="arrival-dest">${esc(r.dest??'')}</div><strong class="arrival-minutes">${esc(minuteText(r))}</strong><span class="arrival-delay">${esc(delayText(r.delay))}</span>`;}
function railRow(r){return `<div class="arrival-service">${sourceDot(r.source)}<b>${esc(r.label??r.category??'列車')}</b></div><div class="arrival-dest">${esc(r.dest??'')}</div><strong class="arrival-minutes">${esc(minuteText(r))}</strong><span class="arrival-delay">${esc(delayText(r.delay))}</span>`;}
function stale(data,limit){return Boolean(data?.stale)||!isFresh(data?.asOf,limit);}
function railTarget(){const n=nearest().all.find(x=>x.stop.type==='kintetsu');return n?.id??'K15';}
export function railArrivalRows(predicted,timetable,target,nowMinute){
  const targetIndex=kintetsuIds.indexOf(target),targetCell=targetIndex>=0?targetIndex*2+1:null;if(targetCell===null)return [];
  const rows=[];
  for(const t of predicted?.trains??[]){
    const pos=Number(t.position),approaching=t.direction==='south'?pos<=targetCell:pos>=targetCell;if(!Number.isFinite(pos)||!approaching)continue;
    const matched=Number.isFinite(nowMinute)?railTimetableEta(timetable,t,target,nowMinute):null,minutes=matched?Math.max(0,matched.minutes):null;
    if(Number.isFinite(minutes)&&minutes>30)continue;
    rows.push({...t,key:t.key??`${t.direction}:${pos}:${t.dest}`,minutes,status:matched?null:'時刻未確定',etaSource:matched?'timetable':null,source:t.predicted?'prediction':'live'});
  }
  rows.sort((a,b)=>(Number.isFinite(a.minutes)?a.minutes:Infinity)-(Number.isFinite(b.minutes)?b.minutes:Infinity)||String(a.dest).localeCompare(String(b.dest),'ja'));return rows.slice(0,12);
}
function normalizeRail(data,timetable=null,nowMinute=null){
  if(!data)return null;
  const predicted=stale(data,120000)?predictRail(data):data,target=railTarget(),results=railArrivalRows(predicted,timetable,target,nowMinute);return {...predicted,target,results};
}

export function compactBusHTML(data){const rows=(data?.results??[]).slice(0,3);if(!rows.length)return '';return `<div class="arrival-compact">${rows.map(r=>`<div>${sourceDot(r.source)}<b>${esc(r.route)}</b><span>${esc(r.dest)}</span><strong>${esc(minuteText(r))}</strong></div>`).join('')}</div>`;}

export function mountArrivals({network}){
  const root=$('#arrivals-root');let stopId=saved().stopId??null,busData=null,railData=null,railSchedule=null,railScheduleDate=null,railScheduleAt=0,busBusy=false,railBusy=false;
  root.innerHTML=`<section class="section-block arrival-card"><div class="section-heading"><div><span class="section-label">京都市バス</span><h3>接近情報</h3></div><button class="round-action" data-arrival-nearest aria-label="現在地から停留所を選ぶ">${icon('location')}</button></div><button class="arrival-stop" data-arrival-change><span><small>停留所</small><b id="arrival-stop-name">停留所を選択</b></span><span class="chevron">›</span></button><div id="arrival-stop-picker" hidden><div class="native-search"><span>⌕</span><input id="arrival-stop-search" type="search" placeholder="停留所名・系統を検索" autocomplete="off"></div><div id="arrival-stop-results"></div></div><p class="stale-warning" id="bus-stale" hidden>データが古くなっています</p><div class="arrival-columns"><span>系統</span><span>行先</span><span>到着</span><span>遅延</span></div><div class="arrival-lines" id="arrival-live" aria-live="polite"></div></section><section class="section-block arrival-card"><div class="section-heading"><div><span class="section-label">近鉄京都線</span><h3>接近情報</h3></div><button class="round-action" data-rail-refresh aria-label="更新">${icon('refresh')}</button></div><p class="stale-warning" id="rail-stale" hidden>データが古くなっています</p><div class="arrival-columns"><span>種別</span><span>行先</span><span>到着</span><span>遅延</span></div><div class="arrival-lines" id="arrival-rail" aria-live="polite"></div></section>`;
  const stopEl=()=>root.querySelector('#arrival-stop-name'),busRoot=()=>root.querySelector('#arrival-live'),railRoot=()=>root.querySelector('#arrival-rail');
  const currentStop=()=>network.stops.get(stopId);
  function renderStop(){stopEl().textContent=currentStop()?.name??'停留所を選択';}
  function renderSearch(q=''){const items=searchStops(network,q,'bus').filter(s=>s.type==='citybus').slice(0,24);root.querySelector('#arrival-stop-results').innerHTML=`<div class="native-list">${items.map(s=>`<button class="native-row" data-arrival-stop="${esc(s.id)}"><span class="mode-symbol bus">${icon('bus')}</span><span><b>${esc(s.name)}</b><small>${esc(s.lines.join('・'))}</small></span><span class="chevron">›</span></button>`).join('')}</div>${!items.length?'<p class="empty-state">停留所が見つかりません。</p>':''}`;}
  function renderBus(data){if(!data){busRoot().innerHTML='<p class="empty-state">接近情報を取得できません。</p>';return;}const recovered=interpolateCityBusRecovery(busData,data);busData=recovered;const projected=stale(recovered,45000)?predictCityBus(recovered):recovered;root.querySelector('#bus-stale').hidden=!stale(recovered,45000);keyedRows(busRoot(),projected.results??[],busRow);state.busLive=projected;state.busLiveAt=Date.now();}
  function renderRail(data){if(!data){railRoot().innerHTML='<p class="empty-state">接近情報を取得できません。</p>';return;}const recovered=interpolateRailRecovery(railData,data);railData=recovered;const view=normalizeRail(recovered,railSchedule,tokyoNow().minute);root.querySelector('#rail-stale').hidden=!view||!stale(recovered,120000);keyedRows(railRoot(),view?.results??[],railRow);if(view&&!view.results.length)railRoot().innerHTML='<p class="empty-state">接近中の列車はありません。</p>';state.railFeed={...recovered,sourceUpdatedAt:recovered.asOf,capturedAt:recovered.asOf,trains:(recovered.trains??[]).map(t=>({...t,destination:t.destination??t.dest}))};state.railFeedAt=Date.now();}
  function chooseNearest(){const n=nearest().all.find(x=>x.stop.type==='citybus');if(!n){toast('近くの市バス停を確認できません');return false;}return selectStop(n.id,true);}
  async function selectStop(id,close=false){if(!network.stops.has(id)||network.stops.get(id).type!=='citybus')return false;stopId=id;renderStop();persist({stopId});if(close)root.querySelector('#arrival-stop-picker').hidden=true;await loadBusCache();busLoop.poke();return true;}
  async function loadBusCache(){if(!currentStop())return;const c=await getCached(`citybus:${stopName(currentStop())}`);if(c?.data)renderBus(c.data);}
  async function loadRailCache(){const c=await getCached('rail:kintetsu');if(c?.data)renderRail(c.data);}
  async function loadRailSchedule(force=false){
    const date=tokyoNow().date;if(!force&&railSchedule&&railScheduleDate===date&&Date.now()-railScheduleAt<30*60*1000)return railSchedule;
    const u=new URL('/api/static/feed',CAPTURE_API);u.searchParams.set('operator','kintetsu');u.searchParams.set('date',date);
    const r=await fetch(u,{signal:AbortSignal.timeout(5000),cache:'no-store'});if(!r.ok)throw Error('近鉄の時刻データを取得できませんでした。');const d=await r.json();railSchedule=d;railScheduleDate=date;railScheduleAt=Date.now();return d;
  }
  async function refreshBus(){if(busBusy||!currentStop())return;busBusy=true;try{const data=await fetchRealtime(`citybus:${stopName(currentStop())}`,'/api/citybus/arrivals',{stop:stopName(currentStop())});renderBus(data);}catch(e){const cached=e.cached?.data??busData;if(cached)renderBus(predictCityBus(cached));else renderBus(null);throw e;}finally{busBusy=false;}}
  async function refreshRail(){if(railBusy)return;railBusy=true;try{const schedule=loadRailSchedule().catch(()=>null),data=await fetchRealtime('rail:kintetsu','/api/rail/live');await schedule;renderRail(data);}catch(e){const cached=e.cached?.data??railData;if(cached)renderRail(predictRail(cached));else renderRail(null);throw e;}finally{railBusy=false;}}
  const active=()=>!document.hidden&&state.tab==='now';
  const busLoop=createLiveLoop({run:refreshBus,active,interval:ARRIVAL_INTERVAL}),railLoop=createLiveLoop({run:refreshRail,active,interval:ARRIVAL_INTERVAL});
  root.addEventListener('input',e=>{if(e.target.id==='arrival-stop-search')renderSearch(e.target.value);});
  root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-arrival-change')){const picker=root.querySelector('#arrival-stop-picker');picker.hidden=!picker.hidden;if(!picker.hidden){renderSearch('');root.querySelector('#arrival-stop-search').focus();}}else if(b.dataset.arrivalStop)selectStop(b.dataset.arrivalStop,true);else if(b.hasAttribute('data-arrival-nearest'))chooseNearest();else if(b.hasAttribute('data-rail-refresh')){railScheduleAt=0;railLoop.poke();}});
  async function show(){if(!stopId){const n=nearest().all.find(x=>x.stop.type==='citybus');stopId=n?.id??cityStops(network).find(s=>s.name.includes('烏丸丸太町'))?.id??cityStops(network)[0]?.id;persist({stopId});renderStop();}await Promise.all([loadBusCache(),loadRailCache(),loadRailSchedule().catch(()=>null)]);busLoop.start();railLoop.start();busLoop.poke();railLoop.poke();}
  renderStop();window.addEventListener('mymap-realtime-log',()=>{state.realtimeLog=realtimeLog();});
  return {show,selectStop,refreshBus,refreshRail,dispose(){busLoop.stop();railLoop.stop();},get data(){return busData;}};
}
