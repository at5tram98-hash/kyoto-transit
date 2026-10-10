import {CAPTURE_API} from './live.js';
import {normalize,searchStops} from './network.js';
import {formatTime} from './router.js';
import {applyRealtime,mergeTimetableFeeds,searchTimetable,staleWarnings} from './search-core.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=n=>Number.isFinite(n)?`${Math.round(n).toLocaleString('ja-JP')}円`:'—';
const dot=source=>`<i class="source-dot ${source==='live'?'live':source==='prediction'?'prediction':'schedule'}" aria-hidden="true"></i>`;
const operatorLabel={subway:'地下鉄烏丸線',kintetsu:'近鉄京都線',through:'烏丸線・近鉄直通',citybus:'京都市バス',kyotobus:'京都バス'};

async function api(path,params={},signal){const u=new URL(path,CAPTURE_API);for(const[k,v]of Object.entries(params))if(v!==undefined&&v!==null)u.searchParams.set(k,v);const r=await fetch(u,{signal,cache:'no-store'});let data=null;try{data=await r.json();}catch{}if(!r.ok)throw Object.assign(Error(data?.error??'データを取得できませんでした。'),{status:r.status,code:data?.code});return data;}
const minuteValue=value=>{const m=String(value).match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null;};
const exactStop=(network,value)=>{const q=normalize(value);return [...network.stops.values()].find(s=>[s.name,s.fullName,...(s.aliases??[])].filter(Boolean).some(n=>normalize(n)===q))??null;};
const passState=settings=>({citybus:Boolean(settings.passCityBus),kyotobus:Boolean(settings.passKyotoBus),subway:Boolean(settings.passSubway),subwayFrom:settings.passSubwayFrom??'K01',subwayTo:settings.passSubwayTo??'K11',expires:settings.passExpires??''});

async function loadFeeds(date,signal){
  const operators=['subway','kintetsu','citybus','kyotobus'],feeds=[],missing=[];
  await Promise.all(operators.map(async operator=>{try{feeds.push(await api('/api/static/feed',{operator,date},signal));}catch(e){missing.push({operator,error:e.message,status:e.status});}}));
  return {feeds,missing};
}
async function loadRealtime(network,request,signal){
  const result={};
  const tasks=[api('/api/rail/live',{},signal).then(x=>result.rail=x).catch(()=>{}),api('/api/bus/rt',{},signal).then(x=>result.kyotobus=x).catch(()=>{})];
  const cityStop=[request.from,...request.via.map(v=>v.stop),request.to].map(id=>network.stops.get(id)).find(s=>s?.type==='citybus');
  if(cityStop)tasks.push(api('/api/citybus/arrivals',{stop:cityStop.fullName??cityStop.name},signal).then(x=>result.citybus=x).catch(()=>{}));
  await Promise.all(tasks);return result;
}
function routeHTML(route,network){
  const name=id=>network.stops.get(id)?.name??id,source=route.realtimeSource??'schedule';
  const legs=route.legs.map(leg=>{
    if(leg.kind==='walk')return `<div class="planner-leg walk"><time>${formatTime(leg.depart)}</time><span class="planner-line"></span><div><b>徒歩 ${leg.minutes}分</b><small>${esc(name(leg.from))} → ${esc(name(leg.to))}</small></div></div>`;
    if(leg.kind==='dwell')return `<div class="planner-leg dwell"><time>${formatTime(leg.depart)}</time><span class="planner-line"></span><div><b>待ち ${leg.minutes}分</b><small>${esc(name(leg.from))}</small></div></div>`;
    const realtime=leg.realtime,service=operatorLabel[leg.operator]??leg.label??'交通機関',kind=leg.category==='express'?'急行':leg.category==='local'&&['kintetsu','through'].includes(leg.operator)?'普通':'',delay=realtime?.delay?` · +${realtime.delay}分`:'';
    return `<div class="planner-leg ride"><time>${formatTime(leg.depart)}</time><span class="planner-line"></span><div><b>${dot(realtime?.source??'schedule')}${esc(service)}${kind?` ${kind}`:''}</b><small>${esc(name(leg.from))} → ${esc(name(leg.to))}${leg.destination?` · ${esc(leg.destination)}行`:''}${delay}</small><em>${formatTime(leg.arrive)}</em></div></div>`;
  }).join('');
  return `<article class="planner-result"><div class="planner-result-head"><span class="planner-badge">${esc(route.optionLabel??'候補')}</span><span class="planner-quality">${dot(source)}${source==='live'?'実測反映':source==='prediction'?'予測反映':'予定'}</span></div><div class="planner-times"><strong>${formatTime(route.start)}</strong><span>→</span><strong>${formatTime(route.time)}</strong><small>${route.duration}分</small></div><div class="planner-metrics"><span>追加 <b>${route.fare.additional===0?'0円':yen(route.fare.additional)}</b></span><span>通常 ${yen(route.fare.normal)}</span><span>乗換 ${route.transfers}回</span></div><div class="planner-timeline">${legs}</div></article>`;
}

export function mountRouteSearch({network,settings,tokyoNow}){
  const root=document.querySelector('#route-search-root'),timetable=document.querySelector('#timetable-root');if(!root)return {show(){}};
  const stopOptions=[...network.stops.values()].map(s=>`<option value="${esc(s.name)}"></option>`).join('');let controller=null,lastMode='route';
  const now=tokyoNow();root.innerHTML=`<div class="planner-switch" role="tablist"><button class="active" data-planner-view="route" type="button">経路検索</button><button data-planner-view="board" type="button">駅時刻表</button></div><section id="planner-search"><form class="planner-form" id="planner-form"><datalist id="planner-stops">${stopOptions}</datalist><div class="planner-place-pair"><label><span>出発</span><input name="from" list="planner-stops" value="丸太町" autocomplete="off" required></label><button type="button" class="planner-swap" aria-label="出発と到着を入れ替える">⇅</button><label><span>到着</span><input name="to" list="planner-stops" value="国際会館" autocomplete="off" required></label></div><div class="planner-date-row"><label><span>日付</span><input type="date" name="date" value="${now.date}" required></label><label><span>時刻</span><input type="time" name="time" value="${now.time}" required></label><label><span>指定</span><select name="timeMode"><option value="departure">出発</option><option value="arrival">到着</option></select></label></div><details class="planner-options"><summary>検索条件</summary><div><label><span>近鉄</span><select name="trainType"><option value="all">普通・急行</option><option value="local">普通のみ</option><option value="express">急行のみ</option></select></label><label><span>乗換余裕</span><select name="buffer"><option value="1">1分</option><option value="3" selected>3分</option><option value="5">5分</option><option value="10">10分</option></select></label><label><span>徒歩上限</span><select name="maxWalk"><option value="10">10分</option><option value="20" selected>20分</option><option value="30">30分</option></select></label></div></details><button class="primary-action planner-submit" type="submit">この条件で検索</button></form><div id="planner-status" aria-live="polite"></div><div id="planner-results"></div></section>`;
  const status=root.querySelector('#planner-status'),results=root.querySelector('#planner-results'),form=root.querySelector('#planner-form');
  function setMode(mode){lastMode=mode;root.querySelectorAll('[data-planner-view]').forEach(b=>b.classList.toggle('active',b.dataset.plannerView===mode));root.querySelector('#planner-search').hidden=mode!=='route';if(timetable)timetable.hidden=mode!=='board';}
  root.addEventListener('click',e=>{const b=e.target.closest('[data-planner-view]');if(b)setMode(b.dataset.plannerView);if(e.target.closest('.planner-swap')){const a=form.elements.from,b2=form.elements.to,[a.value,b2.value]=[b2.value,a.value];}});
  form.addEventListener('submit',async e=>{e.preventDefault();controller?.abort();controller=new AbortController();const signal=controller.signal,from=exactStop(network,form.elements.from.value),to=exactStop(network,form.elements.to.value),start=minuteValue(form.elements.time.value);results.innerHTML='';if(!from||!to||!Number.isFinite(start)){status.innerHTML='<p class="planner-warning">駅・停留所と時刻を確認してください。</p>';return;}
    const request={from:from.id,to:to.id,date:form.elements.date.value,start,timeMode:form.elements.timeMode.value,via:[],buffer:Number(form.elements.buffer.value),maxWalk:Number(form.elements.maxWalk.value),trainType:form.elements.trainType.value};status.innerHTML='<p class="loading-note">時刻データを読み込み中…</p>';
    try{const {feeds,missing}=await loadFeeds(request.date,signal);if(signal.aborted)return;if(!feeds.length)throw Error('時刻データを準備できていません。');const base={...network,services:[],mode:'timetable',source:'静的時刻表'},searchNetwork=mergeTimetableFeeds(base,feeds),planned=searchTimetable(searchNetwork,request,passState(settings));if(!planned.length){status.innerHTML=`<p class="planner-warning">この条件で利用できる経路がありません。</p>${missing.length?`<p class="source-caption">未準備: ${esc(missing.map(x=>operatorLabel[x.operator]??x.operator).join('・'))}</p>`:''}`;return;}status.innerHTML='<p class="loading-note">運行状況を反映中…</p>';const live=await loadRealtime(searchNetwork,request,signal);if(signal.aborted)return;const current=tokyoNow(),adjusted=planned.map(r=>applyRealtime(r,live,{nowMinute:request.date===current.date?current.minute:null})),warnings=staleWarnings(searchNetwork);status.innerHTML=`${warnings.map(w=>`<p class="planner-warning">${esc(w)}</p>`).join('')}${missing.length?`<p class="source-caption">一部の時刻データは未準備です: ${esc(missing.map(x=>operatorLabel[x.operator]??x.operator).join('・'))}</p>`:''}`;results.innerHTML=adjusted.map(r=>routeHTML(r,searchNetwork)).join('');}
    catch(err){if(!signal.aborted)status.innerHTML=`<p class="planner-warning">${esc(err.message)}</p>`;}
  });
  setMode('route');return {show(){setMode(lastMode);},openBoard(){setMode('board');}};
}
