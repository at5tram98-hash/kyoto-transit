import {getBusAll,getBusData,getRailLocation,getOfficialImage} from './live.js';
import {recognizeImage} from './ocr.js';
import {searchStops} from './network.js';
import {$,esc,icon,state,nearest,toast} from './vnext-state.js';

const STORE='mymap-arrivals-v2';
const REFRESH_MS=20000;
const saved=()=>{try{return JSON.parse(localStorage.getItem(STORE)||'{}');}catch{return {};}};
const persist=value=>localStorage.setItem(STORE,JSON.stringify(value));
const cityStops=network=>[...network.stops.values()].filter(s=>s.type==='citybus');
const stopName=stop=>stop?.fullName??stop?.name??'';
const timeLabel=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const delayText=t=>t.delay===null?'遅れ不明':t.delay>0?`+${t.delay}分`:'定刻';

export function compactBusHTML(data){
  if(!data)return '';
  const buses=(data.buses??[]).slice(0,3);
  return `<div class="approach-compact"><div><span class="bus-number">${esc(data.route??'')}</span><b>${esc(data.destination??'')}</b><small>${esc(data.boarding??'')}・${esc(data.stop??'')}</small></div>${buses.length?`<div class="approach-pills">${buses.map(b=>`<span><b>${b.stopsAway}</b>停留所前<small>${esc(b.congestion??'混雑情報なし')}</small></span>`).join('')}</div>`:`<p>${esc(data.message??'6停留所以内に接近中のバスはありません。')}</p>`}<small class="approach-time">${timeLabel(data.capturedAt)}取得</small></div>`;
}

function busChoiceCard(item){
  if(item.error)return `<article class="all-arrival-row error"><div class="all-arrival-head"><span class="bus-number">${esc(item.route??'')}</span><div><b>${esc(item.destination??'行先不明')}</b><small>${esc(item.boarding??'のりば不明')}</small></div></div><p>${esc(item.error)}</p></article>`;
  const buses=(item.buses??[]).slice().sort((a,b)=>a.stopsAway-b.stopsAway);
  return `<article class="all-arrival-row"><div class="all-arrival-head"><span class="bus-number">${esc(item.route??'')}</span><div><b>${esc(item.destination??'')}</b><small>${esc(item.boarding??'')}・${timeLabel(item.capturedAt)}取得</small></div><button class="mini-action" data-bus-image-value="${esc(item.value??'')}" aria-label="公式画面を確認">公式</button></div>${buses.length?`<div class="all-arrival-buses">${buses.map((b,i)=>`<div class="all-arrival-bus"><span>${i+1}台目</span><strong>${b.stopsAway}<small>停留所前</small></strong><em>${esc(b.congestion??'混雑情報なし')}</em></div>`).join('')}</div>`:`<p class="no-approach">${esc(item.message??'6停留所以内に接近中のバスはありません。')}</p>`}</article>`;
}

function renderBusAll(data){
  const rows=data?.results??[];
  const approaching=rows.reduce((n,r)=>n+(r.buses?.length??0),0);
  const failed=rows.filter(r=>r.error).length;
  return `<div class="arrival-summary"><div><strong>${approaching}</strong><span>台接近中</span></div><div><strong>${rows.length}</strong><span>系統・行先</span></div><div><strong>${failed}</strong><span>取得失敗</span></div></div><div class="arrival-all-list">${rows.map(busChoiceCard).join('')||'<p class="empty-state">この停留所で表示できる対象系統がありません。</p>'}</div><p class="source-note">京都市バス ポケロケ plus+。この停留所に表示される対応系統・行先・のりばをまとめて表示しています。</p>`;
}

function railChip(train){
  return `<span class="rail-train-chip ${train.delay>0?'late':''}"><b>${train.direction==='north'?'↑':'↓'} ${esc(train.label)}</b><small>${esc(train.destination)}行・${delayText(train)}</small></span>`;
}

function renderRailDiagram(data,ocr=null){
  const stations=data?.stations??[],trains=data?.trains??[];
  if(!stations.length)return '<p class="empty-state">列車位置を確認できません。</p>';
  const at=new Map(),between=new Map();
  for(const t of trains){
    if(t.atStation){if(!at.has(t.from))at.set(t.from,[]);at.get(t.from).push(t);}
    else{
      const a=stations.findIndex(s=>s.id===t.from),b=stations.findIndex(s=>s.id===t.to);
      if(a<0||b<0)continue;
      const key=`${Math.min(a,b)}-${Math.max(a,b)}`;
      if(!between.has(key))between.set(key,[]);
      between.get(key).push(t);
    }
  }
  const rows=[];
  stations.forEach((s,i)=>{
    rows.push(`<div class="rail-map-station"><div class="rail-map-axis"><i></i></div><div class="rail-map-name"><b>${esc(s.name)}</b><small>${esc(s.id)}</small></div><div class="rail-map-trains">${(at.get(s.id)??[]).map(railChip).join('')}</div></div>`);
    if(i<stations.length-1)rows.push(`<div class="rail-map-segment"><div class="rail-map-axis"><span></span></div><div class="rail-map-segment-trains">${(between.get(`${i}-${i+1}`)??[]).map(railChip).join('')}</div></div>`);
  });
  return `${ocr?`<div class="ocr-verified"><span>OCR確認済み</span><b>${Math.round(ocr.confidence)}%</b><small>${timeLabel(ocr.recognizedAt)}</small></div>`:''}<div class="rail-map">${rows.join('')}</div><p class="source-note">近鉄公式列車走行位置・${timeLabel(data.sourceUpdatedAt??data.capturedAt)}現在。↑京都方面 / ↓大和西大寺方面。</p>`;
}

export function mountArrivals({network}){
  const root=$('#arrivals-root');
  let stopId=saved().stopId??null,busAll=null,busBusy=false,railBusy=false,lastBusAt=0,lastRailAt=0,auto=true,imageJob=0,choicesByValue=new Map();

  root.innerHTML=`<section class="section-block arrival-card"><div class="section-heading"><div><span class="section-label">京都市バス</span><h3>この停留所の接近情報</h3></div><button class="round-action" data-arrival-nearest aria-label="現在地から停留所を選ぶ">${icon('location')}</button></div><button class="arrival-stop" data-arrival-change><span><small>停留所</small><b id="arrival-stop-name">現在地から選択</b></span><span class="chevron">›</span></button><div id="arrival-stop-picker" hidden><div class="native-search"><span>⌕</span><input id="arrival-stop-search" type="search" placeholder="停留所名・系統を検索" autocomplete="off"></div><div id="arrival-stop-results"></div></div><div class="arrival-toolbar"><span class="live-refresh-badge"><i></i>20秒ごとに自動更新</span><label class="arrival-auto"><input type="checkbox" id="arrival-auto" checked><span>自動</span></label><button class="round-action" data-arrival-refresh aria-label="今すぐ更新">${icon('refresh')}</button></div><div id="arrival-live"><p class="empty-state">現在地に近い停留所を自動で選びます。</p></div><div id="arrival-image"></div></section><section class="section-block arrival-card"><div class="section-heading"><div><span class="section-label">近鉄京都線</span><h3>列車接近・走行位置</h3></div><button class="round-action" data-rail-refresh aria-label="更新">${icon('refresh')}</button></div><div class="arrival-toolbar rail-toolbar"><span class="live-refresh-badge"><i></i>20秒ごとに自動更新</span><button class="plain-action" data-rail-ocr>OCR→図</button></div><div id="arrival-rail"><p class="loading-line">公式列車位置を取得中…</p></div><div id="rail-image"></div></section>`;

  const stopEl=()=>root.querySelector('#arrival-stop-name'),liveEl=()=>root.querySelector('#arrival-live');
  function currentStop(){return network.stops.get(stopId);}
  function renderStop(){stopEl().textContent=currentStop()?.name??'現在地から選択';}
  function renderSearch(q=''){const items=searchStops(network,q,'bus').filter(s=>s.type==='citybus').slice(0,24);root.querySelector('#arrival-stop-results').innerHTML=`<div class="native-list">${items.map(s=>`<button class="native-row" data-arrival-stop="${esc(s.id)}"><span class="mode-symbol bus">${icon('bus')}</span><span><b>${esc(s.name)}</b><small>${esc(s.lines.join('・'))}</small></span><span class="chevron">›</span></button>`).join('')}</div>${!items.length?'<p class="empty-state">停留所が見つかりません。</p>':''}`;}
  function chooseNearest(){const n=nearest().all.find(x=>x.stop.type==='citybus');if(!n){toast('近くの市バス停を確認できません');return false;}return selectStop(n.id,true);}
  async function selectStop(id,close=false){if(!network.stops.has(id)||network.stops.get(id).type!=='citybus')return false;stopId=id;busAll=null;lastBusAt=0;renderStop();if(close)root.querySelector('#arrival-stop-picker').hidden=true;persist({stopId});await refreshBus(true);return true;}

  async function refreshBus(force=false){
    if(busBusy||!currentStop()||(!force&&Date.now()-lastBusAt<18000))return;
    busBusy=true;root.querySelector('[data-arrival-refresh]').disabled=true;
    if(!busAll)liveEl().innerHTML='<p class="loading-line">この停留所の全接近情報を取得中…</p>';
    try{
      const data=await getBusAll(stopName(currentStop()),AbortSignal.timeout(65000));
      busAll=data;lastBusAt=Date.now();choicesByValue=new Map((data.results??[]).filter(r=>r.value).map(r=>[r.value,r]));
      const first=(data.results??[]).find(r=>(r.buses?.length??0)>0&&!r.error);
      if(first){state.busLive=first;state.busLiveAt=Date.now();}
      liveEl().innerHTML=renderBusAll(data);
    }catch(e){liveEl().innerHTML=`<p class="empty-state">${esc(e.message)}</p>`;}
    finally{busBusy=false;root.querySelector('[data-arrival-refresh]').disabled=false;}
  }

  async function refreshRail(force=false){
    if(railBusy||(!force&&Date.now()-lastRailAt<18000))return;
    railBusy=true;
    try{const data=await getRailLocation(AbortSignal.timeout(35000));state.railFeed=data;state.railFeedAt=Date.now();lastRailAt=Date.now();root.querySelector('#arrival-rail').innerHTML=renderRailDiagram(data);}
    catch(e){root.querySelector('#arrival-rail').innerHTML=`<p class="empty-state">${esc(e.message)}</p>`;}
    finally{railBusy=false;}
  }

  async function captureBus(value){
    const box=root.querySelector('#arrival-image'),item=choicesByValue.get(value),job=++imageJob;
    if(!item)return;
    box.innerHTML='<p class="loading-line">公式接近画面を取得中…</p>';
    try{
      const d=await getOfficialImage('bus',{stop:stopName(currentStop()),choice:value},AbortSignal.timeout(45000));if(job!==imageJob)return;
      box.innerHTML=`<details class="official-shot" open><summary>${esc(item.route)}系統 ${esc(item.destination)}・公式画面</summary><img src="${d.image}" alt="公式接近画面"><small>${timeLabel(d.capturedAt)}取得</small></details>`;
    }catch(e){box.innerHTML=`<p class="empty-state">${esc(e.message)}</p>`;}
  }

  async function railOCR(button){
    const box=root.querySelector('#rail-image'),job=++imageJob;button.disabled=true;box.innerHTML='<p class="loading-line">公式列車位置画面を取得中…</p>';
    try{
      const d=await getOfficialImage('rail-location',undefined,AbortSignal.timeout(45000));if(job!==imageJob)return;
      box.innerHTML='<p class="loading-line" id="rail-ocr-progress">OCRを準備中…</p>';
      const r=await recognizeImage(d.image,(label,p)=>{const el=root.querySelector('#rail-ocr-progress');if(el)el.textContent=`${label} ${Math.round((p??0)*100)}%`;});
      const data=await getRailLocation(AbortSignal.timeout(35000));state.railFeed=data;state.railFeedAt=Date.now();lastRailAt=Date.now();
      root.querySelector('#arrival-rail').innerHTML=renderRailDiagram(data,r);
      box.innerHTML=`<details class="ocr-source"><summary>OCR読み取り内容</summary><pre>${esc(r.rowText||r.text)}</pre><img src="${d.image}" alt="OCR元の近鉄公式列車位置画面"></details>`;
    }catch(e){box.innerHTML=`<p class="empty-state">${esc(e.message)}</p>`;}
    finally{button.disabled=false;}
  }

  root.addEventListener('input',e=>{if(e.target.id==='arrival-stop-search')renderSearch(e.target.value);});
  root.addEventListener('change',e=>{if(e.target.id==='arrival-auto')auto=e.target.checked;});
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-arrival-change')){const picker=root.querySelector('#arrival-stop-picker');picker.hidden=!picker.hidden;if(!picker.hidden){renderSearch('');root.querySelector('#arrival-stop-search').focus();}}
    else if(b.dataset.arrivalStop)selectStop(b.dataset.arrivalStop,true);
    else if(b.hasAttribute('data-arrival-nearest'))chooseNearest();
    else if(b.hasAttribute('data-arrival-refresh'))refreshBus(true);
    else if(b.hasAttribute('data-rail-refresh'))refreshRail(true);
    else if(b.dataset.busImageValue)captureBus(b.dataset.busImageValue);
    else if(b.hasAttribute('data-rail-ocr'))railOCR(b);
  });

  async function show(){
    if(!stopId){
      const n=nearest().all.find(x=>x.stop.type==='citybus');
      stopId=n?.id??cityStops(network).find(s=>s.name.includes('烏丸丸太町'))?.id??cityStops(network)[0]?.id;renderStop();persist({stopId});
    }
    await Promise.all([refreshBus(false),refreshRail(false)]);
  }
  setInterval(()=>{if(document.hidden||state.tab!=='now'||!auto)return;refreshBus(false);refreshRail(false);},REFRESH_MS);
  renderStop();
  return {show,selectStop,refreshBus,refreshRail,get data(){return busAll;}};
}
