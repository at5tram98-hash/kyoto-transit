import {createNetwork,searchStops,subwayIds} from './network.js';
import {planRoutes,formatTime} from './router.js';
import {activePasses,summarizeFares,estimateDirectFare} from './fares.js';
import {loadState,saveState,getFile,putFile,deleteFile} from './storage.js';
import {yahooURL,departureAfterDwell,applyFeed,validateFeed} from './providers.js';
import {recognizeImage,cancelOCR,freshness,summarizeOCR} from './ocr.js';
import {getBusChoices,getOfficialImage,getBusData} from './live.js';
import {getJourneys,journeyHTML,journeyFare,busHTML} from './journey.js';
import {schoolRequest} from './mobility.js';
import {mountMobility} from './assistant.js';
import {createRefreshLoop} from './refresh.js';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={location:'<path d="m3 10 18-7-7 18-3-8Z"/>',settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="var(--bg)"/><circle cx="15" cy="12" r="2" fill="var(--bg)"/><circle cx="9" cy="18" r="2" fill="var(--bg)"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',train:'<rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 10h14M12 3v7M8 21l2-3m6 3-2-3"/><path d="M8 14h.01M16 14h.01"/>',bus:'<rect x="4" y="4" width="16" height="14" rx="3"/><path d="M4 11h16M12 4v7M7 18v3m10-3v3M7 14h.01M17 14h.01"/>',star:'<path d="m12 3 2.7 5.8 6.3.8-4.6 4.4 1.1 6.2-5.5-3-5.5 3 1.1-6.2L3 9.6l6.3-.8Z"/>',ticket:'<path d="M3 7h18v4a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4Z"/><path d="M15 7v2m0 3v1m0 3v2"/>',swap:'<path d="M8 3v16m-4-4 4 4 4-4m4-12v18m-4-14 4-4 4 4"/>',plus:'<path d="M12 5v14M5 12h14"/>',chevron:'<path d="m6 9 6 6 6-6"/>',arrow:'<path d="m9 5 7 7-7 7"/>',return:'<path d="M5 17V9a5 5 0 0 1 10 0v10m-4-4 4 4 4-4"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',check:'<path d="m5 12 4 4L19 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',external:'<path d="M14 3h7v7m0-7L11 13M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-7 5 6"/>',walk:'<circle cx="13" cy="4" r="2"/><path d="m10 9 3-2 3 6 4 1m-10-5-2 5H4m8-2-2 5-4 4m6-9 3 5v4"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]??icons.info}</svg>`;
function paintIcons(root=document){root.querySelectorAll('[data-icon]').forEach(e=>{e.innerHTML=icon(e.dataset.icon);});}
let state=loadState(),base,network,query={from:'K07',to:'K01',via:[]},currentRequest=null,results=[],sort='fast',openRoute=0,pickerTarget=null,pickerFilter='all',toastTimer,cropImage;
const names={today:'いま',search:'乗換検索',live:'接近・運行情報',favorites:'お気に入り',settings:'定期・設定'};
let liveStop='烏丸丸太町（地下鉄丸太町駅）',choices=[],choicesController,ocrController,ocrBusy=false,ocrJob=0;
let routeMode='real',searchController,searchJob=0,routeUpdatedAt,routeNotice='';
let mobility;
let choicesBusy=false,savedBusReport,busRefresh;
const name=id=>network?.stops.get(id)?.name??'場所を選択';
const line=id=>network?.stops.get(id)?.lines?.join('・')??'';
const yen=v=>v===null?'要確認':`${Math.round(v).toLocaleString('ja-JP')}円`;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3200);}
function commit(change){const next=structuredClone(state);change(next);try{saveState(next);state=next;return true;}catch{toast('保存できませんでした。端末の空き容量・保存設定を確認してください。');return false;}}
function tokyoNow(){const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).split(' ');return {date:parts[0],time:parts[1]};}
function setNow(){const n=tokyoNow();$('#date').value=n.date;$('#time').value=n.time;}
function setTab(tab,autoLive=true){if(!names[tab])return;$$('.view').forEach(e=>{e.hidden=e.id!==`${tab}-view`;});$$('[data-tab]').forEach(e=>{e.classList.toggle('active',e.dataset.tab===tab);if(e.closest('nav'))e.setAttribute('aria-current',e.dataset.tab===tab?'page':'false');});$('#screen-title').textContent=tab==='today'?'My Map':names[tab];$('#tab-label').textContent=tab==='today'?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'long',day:'numeric',weekday:'long'}).format(new Date())+'・京都': 'My Map・京都のいつもの移動に';if(tab==='favorites')renderFavorites();if(tab==='live'&&autoLive&&!choices.length)loadLiveChoices();$('.scroll').scrollTo({top:0,behavior:'instant'});moveTabSelection();}
function moveTabSelection(){const active=$('.tabbar .tab.active'),nav=$('.tabbar'),pill=$('.tab-selection');if(!active){nav.classList.remove('tab-ready');return;}const rect=active.getBoundingClientRect(),parent=nav.getBoundingClientRect();pill.style.width=`${rect.width}px`;pill.style.transform=`translate3d(${rect.left-parent.left}px,0,0)`;nav.classList.add('tab-ready');}
function renderFarePreview(){if(!network)return;const fare=query.via.length?null:estimateDirectFare(query.from,query.to,network,state.passes,$('#date').value),el=$('#fare-preview');el.classList.toggle('free',fare?.additional===0);el.classList.toggle('small',!fare);el.innerHTML=fare?`${Math.round(fare.additional).toLocaleString('ja-JP')}<span>円</span>`:query.via.length?'経由地あり':'経路を確認';$('#fare-preview-note').textContent=fare?`通常 ${yen(fare.normal)} ・ ${fare.additional===0?'定期券を適用':'大人運賃の目安'}`:'検索すると実際の経路と運賃を表示します';}
function renderLocations(){
  for(const role of ['from','to']){$(`#${role}-name`).textContent=name(query[role]);$(`#${role}-line`).textContent=line(query[role]);}
  $('#waypoints').innerHTML=query.via.map((v,i)=>`<div class="waypoint"><div class="waypoint-top"><span class="waypoint-index">${i+1}</span><button type="button" class="waypoint-place" data-pick="via-${i}">${esc(name(v.stop))}</button><div class="waypoint-tools"><button type="button" data-via-up="${i}" aria-label="経由地を上へ移動" ${i?'':'disabled'}>${icon('swap')}</button><button type="button" data-via-remove="${i}" aria-label="経由地を削除">${icon('close')}</button></div></div><div class="waypoint-bottom"><label>滞在・折り返し<input type="number" min="0" max="180" step="1" value="${v.dwell}" data-dwell="${i}">分</label><label><input type="checkbox" data-exit="${i}" ${v.exitGate?'checked':''}>改札を出る</label><span>必ずこの場所で下車</span></div></div>`).join('');
  $('#add-via').disabled=query.via.length>=3;
  renderFarePreview();
}
function renderPasses(){
  const p=activePasses(state.passes,$('#date').value),rows=[['市バスフリー','対象市バスの乗車分','citybus'],['京都バス','国際会館駅前〜京都産業大学前','kyotobus'],['地下鉄',`${name(p.subwayFrom)}〜${name(p.subwayTo)}`,'subway']];
  $('#pass-summary').innerHTML=rows.map(([title,desc,key])=>`<div class="pass-item"><div><span>${title}</span><span class="applied">${p[key]?'追加 0円':'適用なし'}</span></div><small>${esc(desc)}</small></div>`).join('');
  $('#quick-favorites').innerHTML=state.favorites.filter(id=>network.stops.has(id)).slice(0,5).map(id=>`<button class="quick-stop" data-quick="${esc(id)}"><span>${esc(name(id))}<small>${esc(line(id))}</small></span>${icon('arrow')}</button>`).join('')||'<p class="fine">お気に入りから場所を追加できます。</p>';
  renderFarePreview();
}
function openPicker(target){
  pickerTarget=target;const railOnly=['meet-from','track-from'].includes(target);pickerFilter=target==='live'?'bus':railOnly?'rail':'all';
  const titles={from:'出発地を選択',to:'到着地を選択',favorite:'お気に入りを追加',live:'接近情報の停留所','assist-from':'出発する駅・バス停','meet-from':'自分が出発する駅','track-from':'乗った駅を選択','work-muji':'無印良品の最寄り駅・バス停','work-gu':'GUの最寄り駅・バス停'};
  $('#picker-title').textContent=target==='ride-to'?'降りる駅・停留所を選択':target==='ride-from'?'乗った駅・停留所を選択':titles[target]??'経由・折り返しの場所';$('#picker-search').value='';$('#picker-filters').hidden=target==='live'||railOnly;$$('#picker-filters button').forEach(e=>e.classList.toggle('active',e.dataset.filter===pickerFilter));renderPicker();$('#stop-dialog').showModal();$('#picker-search').focus();
}
function renderPicker(){
  const q=$('#picker-search').value,all=searchStops(network,q,pickerFilter).filter(s=>pickerTarget!=='live'||s.type==='citybus');
  const favorites=q?[]:state.favorites.map(id=>network.stops.get(id)).filter(s=>s&&all.some(a=>a.id===s.id));
  const rest=all.filter(s=>!favorites.some(f=>f.id===s.id));
  const row=s=>`<button class="picker-stop" data-stop="${esc(s.id)}"><span class="stop-icon ${s.type?.includes('bus')?'bus':s.type==='subway'?'subway':'rail'}">${icon(s.type?.includes('bus')?'bus':'train')}</span><span><strong>${esc(s.name)}${s.id==='B01'?'（近鉄）':s.id==='K11'?'（地下鉄）':s.id==='B03'?'（近鉄）':s.id==='K13'?'（地下鉄）':''}</strong><small>${esc(s.lines?.join('・')??'')}</small></span>${state.favorites.includes(s.id)?`<span class="fav-mark">${icon('star')}</span>`:''}</button>`;
  $('#picker-results').innerHTML=(favorites.length?'<div class="picker-label">お気に入り</div>'+favorites.map(row).join(''):'')+(rest.length?`<div class="picker-label">${q?`${all.length}件の候補`:'対応している駅・停留所'}</div>`+rest.map(row).join(''):'')+(!all.length?'<p class="muted">対応する場所が見つかりませんでした。96系統は要確認です。</p>':'');
}
function selectStop(id){
  if(!network.stops.has(id))return;
  if(pickerTarget==='favorite'){if(state.favorites.includes(id))toast('すでに登録されています');else if(commit(s=>s.favorites.push(id)))toast('お気に入りに追加しました');renderFavorites();}
  else if(pickerTarget==='live'){liveStop=base.stops.get(id)?.fullName??name(id);$('#live-stop-name').textContent=liveStop;$('#bus-live-result').innerHTML='';loadLiveChoices();}
  else if(mobility?.selectStop(pickerTarget,id)){}
  else if(pickerTarget==='via-add')query.via.push({stop:id,dwell:5,exitGate:false});
  else if(pickerTarget?.startsWith('via-'))query.via[+pickerTarget.slice(4)].stop=id;
  else query[pickerTarget]=id;
  $('#stop-dialog').close();renderLocations();renderPasses();
}
function request(){
  const [h,m]=$('#time').value.split(':').map(Number);
  if(!$('#date').value||!Number.isFinite(h)||!Number.isFinite(m))throw new Error('日付と出発時刻を入力してください。');
  if(query.from===query.to&&!query.via.length)throw new Error('出発地と到着地が同じです。折り返す場合は経由地を追加してください。');
  if(query.via.some(v=>!Number.isFinite(v.dwell)||v.dwell<0||v.dwell>180))throw new Error('滞在時間は0〜180分で入力してください。');
  return schoolRequest({...structuredClone(query),date:$('#date').value,start:h*60+m,trainType:$('#train-type').value,buffer:+$('#buffer').value,maxWalk:+$('#max-walk').value});
}
function launchURL(url){window.open(url,'_blank','noopener,noreferrer');}
async function searchYahoo(event){
  event?.preventDefault();$('#form-error').textContent='';let r;try{r=request();}catch(e){$('#form-error').textContent=e.message;return;}
  searchController?.abort();searchController=new AbortController();const controller=searchController,job=++searchJob;
  currentRequest=r;routeMode='real';results=[];$('#search-submit').disabled=true;$('#demo-search').disabled=true;
  $('#results-section').innerHTML='<div class="loading-card" role="status"><span class="spinner"></span>実際の経路を取得しています…<p class="fine">経由地がある場合は、到着と滞在をつないで検索します。</p><button class="plain" data-cancel-search>中止</button></div>';
  const timeout=setTimeout(()=>controller.abort(),90000);
  try{const data=await getJourneys(r,controller.signal);if(job!==searchJob)return;results=data.routes;routeUpdatedAt=data.updatedAt;routeNotice=data.notice;openRoute=0;sort='fast';renderResults();mobility?.routesChanged(results,r);}
  catch(e){if(job!==searchJob)return;$('#form-error').textContent=e.name==='AbortError'?'検索を中止しました。または時間切れです。再検索してください。':e.message;$('#results-section').innerHTML='';}
  finally{clearTimeout(timeout);if(job===searchJob){$('#search-submit').disabled=false;$('#demo-search').disabled=false;}}
}
function directFare(from,to,date){
  const f=estimateDirectFare(from,to,network,state.passes,date);
  if(!f)return '';
  return `<div class="direct-fare"><span>${esc(f.label)}<br>大人運賃の目安</span><div><b class="${f.additional===0?'free':''}">追加 ${yen(f.additional)}</b><small>通常 ${yen(f.normal)}</small></div></div>`;
}
function renderYahoo(r){
  const places=[r.from,...r.via.map(v=>v.stop),r.to];
  const hasDwell=r.via.some(v=>v.dwell>0);
  $('#results-section').innerHTML=`<div class="results-title"><h2>Yahoo!乗換案内へ</h2><small>実際のダイヤで検索</small></div><section class="card yahoo-card"><div class="badge">条件を入力済み</div><h2 class="yahoo-path">${places.map(id=>esc(name(id))).join('<span> → </span>')}</h2><p class="muted">${esc(r.date)} ${formatTime(r.start)}出発。時刻・所要時間・乗換・通常運賃は、Yahoo!の検索結果で確認できます。</p><a class="primary link-button" href="${esc(yahooURL(r,network))}" target="_blank" rel="noopener noreferrer">Yahoo!で全体検索${icon('external')}</a>${r.trainType!=='all'?'<p class="fine">普通のみ／急行のみの厳密な指定はYahoo!へ渡せません。結果の列車種別をご確認ください。</p>':''}${hasDwell?'<p class="fine">全体検索は経由地点を渡します。滞在時間・折り返し待ちはYahoo!に反映されないため、下の区間検索で出発時刻をつなげてください。</p>':''}${!r.via.length?directFare(r.from,r.to,r.date):''}<div class="pass-benefit">${icon('ticket')}市バス・京都バス・地下鉄の定期区間は追加0円</div><p class="fine">Yahoo!の運賃表示には、このアプリの定期券設定は反映されません。</p><button class="plain" data-save-query>この検索を保存</button></section>${r.via.length?`<h2 class="subheading">折り返し・滞在を区間ごとに検索</h2><p class="fine">次の区間は、Yahoo!で確認した到着時刻に滞在時間を加えて検索します。実際の到着時刻の自動取得は未接続です。</p>${places.slice(0,-1).map((id,i)=>`<section class="card leg-search"><div class="section-title"><span class="waypoint-index">${i+1}</span><h2>${esc(name(id))} → ${esc(name(places[i+1]))}</h2></div>${i?`<label class="block-label">前の区間の到着時刻<input type="datetime-local" data-leg-arrival="${i}"></label><p class="fine">到着後に ${r.via[i-1].dwell}分滞在します。改札${r.via[i-1].exitGate?'を出る':'内で下車'}。</p>`:`<p class="fine">${esc(r.date)} ${formatTime(r.start)}出発</p>`}<button class="secondary link-button" data-yahoo-leg="${i}">この区間をYahoo!で検索${icon('external')}</button>${directFare(id,places[i+1],r.date)}</section>`).join('')}`:''}`;
}
function launchLeg(i){
  const r=currentRequest,places=[r.from,...r.via.map(v=>v.stop),r.to];let date=r.date,start=r.start;
  if(i>0){const value=$(`[data-leg-arrival="${i}"]`).value;if(!value){toast('前の区間の到着日時を入力してください');return;}
    try{({date,start}=departureAfterDwell(value,r.via[i-1].dwell));}catch(e){toast(e.message);return;}
  }
  launchURL(yahooURL({...r,date},network,places[i],places[i+1],start,[]));
}
async function searchDemo(){
  $('#form-error').textContent='';let r;try{r=request();}catch(e){$('#form-error').textContent=e.message;return;}
  $('#search-submit').disabled=true;$('#demo-search').disabled=true;
  $('#results-section').innerHTML='<div class="loading-card"><span class="spinner"></span>試作データで比較しています…</div>';
  await new Promise(resolve=>setTimeout(resolve,35));
  try{routeMode='demo';currentRequest=r;results=planRoutes(network,r,state.passes);openRoute=0;sort='fast';renderResults();}
  catch(e){$('#form-error').textContent=e.message;$('#results-section').innerHTML='';}
  finally{$('#search-submit').disabled=false;$('#demo-search').disabled=false;}
}
function orderedResults(){return results.map((r,i)=>({...r,index:i})).sort((a,b)=>sort==='transfers'?a.transfers-b.transfers||a.time-b.time:sort==='wait'?a.wait-b.wait||a.time-b.time:sort==='walk'?a.walk-b.walk||a.time-b.time:a.time-b.time);}
function renderResults(){
  if(routeMode==='real'){$('#results-section').innerHTML=journeyHTML({routes:results,request:currentRequest,sort,openRoute,network:base,passes:state.passes,updatedAt:routeUpdatedAt,notice:routeNotice});return;}
  if(!results.length){$('#results-section').innerHTML=`<div class="card no-routes"><h2>試作条件でルートが見つかりませんでした</h2><p>急行が停まらない駅や対象日のデータ不足が考えられます。実際の経路はYahoo!でご確認ください。</p><a class="secondary" target="_blank" rel="noopener" href="${esc(yahooURL(currentRequest,network))}">Yahoo!で検索</a></div>`;return;}
  const labels={fast:'早い',transfers:'乗換が少ない',wait:'待ちが少ない',walk:'歩きが少ない'};
  $('#results-section').innerHTML=`<div class="results-title"><h2>試作データの比較 <span class="badge orange">実ダイヤではありません</span></h2><small>${results.length}案</small></div><div class="segmented">${Object.entries(labels).map(([v,l])=>`<button data-sort="${v}" class="${sort===v?'active':''}">${l}</button>`).join('')}</div>`+orderedResults().map((r,i)=>{
    const rides=r.legs.filter(l=>l.kind==='ride'),chips=rides.map(l=>`<span class="line-chip ${['through','kintetsu'].includes(l.operator)?'k':''}">${esc(l.label)}${l.category==='express'?' 急行':l.operator==='kintetsu'?' 普通':''}</span>`).join('<span>›</span>');
    return `<article class="card route-card ${r.index===openRoute?'open':''}"><button class="route-summary" data-open-route="${r.index}" aria-expanded="${r.index===openRoute}"><span class="route-chevron">${icon('chevron')}</span><div class="route-top"><span class="badge">${i===0?'この条件の候補1':`候補${i+1}`}</span>${r.filter==='local'?'<span class="badge neutral">近鉄 普通のみ</span>':r.filter==='express'?'<span class="badge orange">近鉄 急行のみ</span>':''}${currentRequest.via.length?'<span class="badge neutral">経由・下車あり</span>':''}</div><div class="route-times">${formatTime(r.start)}<span>→</span>${formatTime(r.time)}<small>約${r.duration}分</small></div><div class="route-metrics"><span>追加 <b class="${r.fare.additional===0?'free':''}">${yen(r.fare.additional)}</b></span><span>通常 ${yen(r.fare.normal)}</span><span>乗換 <b>${r.transfers}</b>回</span><span>徒歩 ${Math.ceil(r.walk)}分・待ち ${Math.ceil(r.wait)}分</span></div><div class="route-path">${chips}</div></button><div class="route-detail" ${r.index===openRoute?'':'hidden'}>${renderTimeline(r)}<div class="route-actions"><a class="secondary" href="${esc(yahooURL(currentRequest,network))}" target="_blank" rel="noopener noreferrer">実際の時刻をYahoo!で確認${icon('external')}</a><button class="secondary" data-save-query>${icon('star')}検索を保存</button><button class="secondary" data-copy-route="${r.index}">コピー</button></div></div></article>`;
  }).join('');
}
function renderTimeline(r){
  const body=r.legs.map(l=>{
    const k=['through','kintetsu'].includes(l.operator),css=k?'k':l.kind==='walk'?'walk':'';
    let text;
    if(l.kind==='dwell')text=`<h3>${esc(name(l.from))}で下車・${l.minutes}分滞在</h3><p>${formatTime(l.arrive)}以降に次の区間へ。${l.exitGate?'改札を出る':'改札内で待つ'}設定。</p>`;
    else if(l.kind==='walk')text=`<h3>${esc(name(l.from))} → ${esc(name(l.to))}</h3><p>徒歩 約${l.minutes}分（試作の目安）</p>`;
    else text=`<h3>${esc(name(l.from))}</h3><div class="timeline-service ${k?'k':''}">${esc(l.label)} ${l.category==='express'?'急行':'普通'}${l.through?'・直通':''}</div><p>${esc(name(l.direction))}方面 → ${esc(name(l.to))}<br>出発の${currentRequest.buffer}分前、${formatTime(l.depart-currentRequest.buffer)}までに乗り場へ</p><div class="platform-note">${l.platform?`${esc(l.platform)}番線（取込データ）`:'番線・のりば：未取得'}</div><details class="stop-list"><summary>途中の${Math.max(0,l.path.length-2)}駅・停留所を見る（推定時刻）</summary>${l.path.slice(1,-1).map((id,i)=>`<div><span>${esc(name(id))}</span><time>${formatTime(l.times[i+1])}</time></div>`).join('')}</details>`;
    return `<div class="timeline-leg"><time class="timeline-time">${formatTime(l.depart).replace('翌日 ','翌')}</time><div class="timeline-rail ${css}"><i></i><span></span></div><div class="timeline-body">${text}</div></div>`;
  }).join('');
  return `<div class="timeline">${body}<div class="arrival-node"><time>${formatTime(r.time)}</time><i></i><b>${esc(name(currentRequest.to))}</b></div></div><table class="fare-table"><thead><tr><th>運賃の目安</th><th>通常</th><th>定期適用後</th></tr></thead><tbody>${r.fare.details.map(d=>`<tr><td>${esc(name(d.from))}〜${esc(name(d.to))}<br><span class="fine">${d.covered?'定期の範囲内':''}</span></td><td>${yen(d.normal)}</td><td>${d.additional===0?'0円（定期）':yen(d.additional)}</td></tr>`).join('')}<tr><td>合計</td><td>${yen(r.fare.normal)}</td><td><b>${yen(r.fare.additional)}</b></td></tr></tbody></table><p class="fine">折り返しの運賃は方向ごとに合算した目安です。乗継割引や乗車券による精算条件は未反映です。</p>`;
}
function renderFavorites(){
  $('#favorites-list').innerHTML=state.favorites.filter(id=>network.stops.has(id)).map(id=>`<div class="favorite-row"><div><strong>${esc(name(id))}</strong><small>${esc(line(id))}</small></div><div><button class="secondary" data-fav-from="${esc(id)}">出発</button><button class="secondary" data-fav-to="${esc(id)}">到着</button><button class="plain" data-fav-remove="${esc(id)}" aria-label="${esc(name(id))}をお気に入りから削除">${icon('close')}</button></div></div>`).join('')||'<p class="muted">よく使う場所を追加してください。</p>';
  $('#saved-routes').innerHTML=state.savedRoutes.map((r,i)=>`<div class="card saved-route"><button class="plain" data-load-route="${i}"><span><h3>${esc(name(r.from))} → ${esc(name(r.to))}</h3><p>${r.via.length?`${r.via.map(v=>esc(name(v.stop))).join('・')}経由`:'経由地なし'}</p></span></button><button class="icon-button" data-delete-route="${i}" aria-label="保存したルートを削除">${icon('close')}</button></div>`).join('')||'<p class="muted">検索結果から条件を保存できます。</p>';
}
function saveQuery(){if(!currentRequest)return;const value={from:currentRequest.from,to:currentRequest.to,via:currentRequest.via,trainType:currentRequest.trainType};if(commit(s=>{if(s.savedRoutes.some(r=>JSON.stringify(r)===JSON.stringify(value)))return;s.savedRoutes.unshift(value);s.savedRoutes=s.savedRoutes.slice(0,20);}))toast('検索条件を保存しました');}
function renderSettings(){
  for(const key of ['citybus','kyotobus','subway'])$(`#pass-${key}`).checked=Boolean(state.passes[key]);
  for(const field of ['from','to']){$(`#pass-${field}`).innerHTML=subwayIds.map(id=>`<option value="${id}">${esc(name(id))}</option>`).join('');$(`#pass-${field}`).value=state.passes[field==='from'?'subwayFrom':'subwayTo'];}
  $('#pass-expires').value=state.passes.expires;$('#theme').value=state.theme;$('#buffer').value=String(state.buffer);setTheme();
}
function setTheme(){if(state.theme==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=state.theme;}
function updatePasses(){
  if(commit(s=>{s.passes={citybus:$('#pass-citybus').checked,kyotobus:$('#pass-kyotobus').checked,subway:$('#pass-subway').checked,subwayFrom:$('#pass-from').value,subwayTo:$('#pass-to').value,expires:$('#pass-expires').value};})){
    renderPasses();if(currentRequest&&routeMode==='real'&&routeUpdatedAt)renderResults();else if(results.length){results=results.map(r=>({...r,fare:summarizeFares(r.legs,network,state.passes,r.date)}));renderResults();}toast('定期設定を保存しました');
  }
}
async function readScreenshot(){try{const stored=await getFile('screenshot');renderScreenshot(stored);}catch{toast('保存画像を読み込めませんでした');}}
async function loadLiveChoices(){
  choicesController?.abort();choicesController=new AbortController();const stop=liveStop,controller=choicesController;
  const previousChoice=$('#live-choice').value;choicesBusy=true;busRefresh?.touch();
  choices=[];$('#live-choice').disabled=true;$('#capture-bus').disabled=true;$('#capture-bus-image').disabled=true;$('#bus-live-result').innerHTML='';$('#bus-choice-note').textContent='系統・行先を取得中…';
  const timeout=setTimeout(()=>controller.abort(),25000);
  try{const data=await getBusChoices(stop,controller.signal);if(controller!==choicesController||stop!==liveStop||controller.signal.aborted)return;choices=data.choices;
    $('#live-choice').innerHTML=choices.length?choices.map(c=>`<option value="${esc(c.value)}">${esc(c.route)}系統・${esc(c.destination)}・${esc(c.boarding)}</option>`).join(''):'<option>対象の系統が見つかりません</option>';
    if(choices.some(c=>c.value===previousChoice))$('#live-choice').value=previousChoice;
    $('#live-choice').disabled=!choices.length||ocrBusy;$('#capture-bus').disabled=!choices.length||ocrBusy;$('#bus-choice-note').textContent=choices.length?'行先とのりばを確認して更新してください。':'対象の系統がない、または公式画面の形式が変わっています。';
    restoreBusReport();
  }catch(e){if(controller!==choicesController||stop!==liveStop)return;$('#live-choice').innerHTML='<option>情報を取得できませんでした</option>';$('#bus-choice-note').textContent=e.name==='AbortError'?'取得が時間切れになりました。再取得してください。':e.message;}
  finally{clearTimeout(timeout);if(controller===choicesController){choicesBusy=false;$('#capture-bus-image').disabled=!choices.length||ocrBusy;}}
}
function setOCRBusy(busy){ocrBusy=busy;$('#ocr-progress').hidden=!busy;$('#capture-rail').disabled=busy;$('#capture-bus').disabled=busy||!choices.length;$('#live-choice').disabled=busy||!choices.length;$('#live-stop-button').disabled=busy;$('#reload-choices').disabled=busy;$('#capture-bus-image').disabled=busy||!choices.length;$('#save-screenshot').disabled=busy;$('#screenshot-file').disabled=busy;}
function ocrProgress(label,ratio=0){$('#ocr-progress-label').textContent=label;$('#ocr-progress-percent').textContent=ratio?`${Math.round(ratio*100)}%`:'';$('#ocr-progress-bar').value=ratio;}
function reportHTML(s){
  const fresh=freshness(s.capturedAt),summary=s.ocr?summarizeOCR(s.ocr.rowText||s.ocr.text,s.source):[];
  return `<div class="live-report"><div class="report-meta"><span class="badge ${fresh==='取得から2分以内'?'blue':'orange'}" data-freshness="${esc(s.capturedAt??'')}">${esc(fresh)}</span><span class="report-time">${s.capturedAt?esc(new Date(s.capturedAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'})):'取得日時不明'}</span></div><p class="ocr-note">${esc(s.memo??'公式画面')} ${s.ocr?`・ OCR認識信頼度 ${Math.round(s.ocr.confidence)}%`:''}</p>${s.ocr?`<div class="ocr-summary">${summary.length?summary.map(line=>`<p>${esc(line)}</p>`).join(''):'文字を読み取りました。原文と画像で接近状況を確認できます。'}</div><p class="ocr-note">OCRには読み間違いがあります。乗る前に原画像を確認してください。</p><details><summary>読み取った原文</summary><div class="ocr-text">${esc(s.ocr.text)}</div></details>`:'<p class="ocr-note">画像を取得しました。文字の読み取りは未完了です。</p>'}<details ${!s.ocr||s.source==='bus'?'open':''}><summary>取得した画面を見る</summary><img src="${esc(s.image)}" alt="${esc(s.memo??'取得した公式画面')}"></details>${s.sourceURL?`<a class="plain source-link" href="${esc(s.sourceURL)}" target="_blank" rel="noopener noreferrer">この公式画面を開く${icon('external')}</a>`:''}</div>`;
}
function restoreBusReport(){
  const s=savedBusReport,selection=s?.selection??s;
  if(s&&selection.stop===liveStop&&selection.value===$('#live-choice').value)$('#bus-live-result').innerHTML=s.kind==='bus-data'?busHTML(s):reportHTML(s);
}
async function readLiveReports(){for(const source of ['bus','rail'])try{const s=await getFile(`live-${source}`);if(source==='bus'){savedBusReport=s;restoreBusReport();}else if(s)$('#rail-live-result').innerHTML=reportHTML(s);}catch{/* 保存がない場合は更新ボタンを利用。 */}}
async function updateBus(automatic=false){
  if(ocrBusy)return;const choice=choices.find(c=>c.value===$('#live-choice').value);if(!choice)return;
  const stop=liveStop,job=++ocrJob;busRefresh?.touch();ocrController=new AbortController();const controller=ocrController;setOCRBusy(true);$('#ocr-error').textContent='';$('#bus-choice-note').textContent='選択した行先の接近情報を取得中…';ocrProgress('公式の接近表を読み取り中');
  const timeout=setTimeout(()=>controller.abort(),45000);
  try{const s=await getBusData(stop,choice.value,controller.signal);if(job!==ocrJob||stop!==liveStop||choice.value!==$('#live-choice').value)return;savedBusReport=s;$('#bus-live-result').innerHTML=busHTML(s);$('#bus-choice-note').textContent='選択した行先・のりばの接近情報です。';try{await putFile('live-bus',s);}catch{toast('接近情報は取得しましたが、端末に保存できませんでした');}if(!automatic)toast('接近情報を更新しました');}
  catch(e){if(job===ocrJob){$('#ocr-error').textContent=e.name==='AbortError'?'接近情報の取得を中止しました。または時間切れです。':e.message;$('#bus-choice-note').textContent='更新できませんでした。取得時刻を確認して再取得してください。';}}
  finally{clearTimeout(timeout);if(job===ocrJob)setOCRBusy(false);}
}
async function runOCR(imageValue,target,key,job){
  try{imageValue.ocr=await recognizeImage(imageValue.image,(label,ratio)=>{if(job===ocrJob)ocrProgress(label,ratio);});}catch(e){if(job!==ocrJob)return;$('#ocr-error').textContent=`画像は取得できましたが、${e.message||'OCRに失敗しました。'}`;}
  if(job!==ocrJob)return;
  await putFile(key,imageValue);$(target).innerHTML=reportHTML(imageValue);return imageValue;
}
async function captureOfficial(source){
  if(ocrBusy)return;const choice=choices.find(c=>c.value===$('#live-choice').value);if(source==='bus'&&!choice)return;
  const job=++ocrJob,stop=liveStop;ocrController=new AbortController();const controller=ocrController;setOCRBusy(true);$('#ocr-error').textContent='';ocrProgress('公式画面を取得中');
  const timeout=setTimeout(()=>controller.abort(),45000);
  try{const s=await getOfficialImage(source,{stop,choice:choice?.value},controller.signal);clearTimeout(timeout);if(job!==ocrJob)return;
    s.memo=source==='bus'?`${stop}・${choice.route}系統・${choice.destination}・${choice.boarding}`:'近鉄列車運行情報';
    if(source==='bus'){s.selection={stop,value:choice.value};savedBusReport=s;}
    $(`#${source}-live-result`).innerHTML=reportHTML(s);await runOCR(s,`#${source}-live-result`,`live-${source}`,job);if(job===ocrJob)toast('公式画面を更新しました');
  }catch(e){if(job===ocrJob)$('#ocr-error').textContent=e.name==='AbortError'?'取得が時間切れになりました。公式画面をご確認ください。':e.message;}
  finally{clearTimeout(timeout);if(job===ocrJob)setOCRBusy(false);}
}
function renderScreenshot(s){
  $('#remove-screenshot').hidden=!s;
  $('#saved-screenshot').innerHTML=s?reportHTML(s):'';
}
async function chooseScreenshot(file){
  if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>15*1024*1024){toast('15MB以下のPNG・JPEG・WebPを選択してください');return;}
  const url=URL.createObjectURL(file),img=new Image();
  try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});cropImage=img;$('#crop-image').src=url;$('#crop-top').value='0';$('#crop-bottom').value='0';$('#crop-editor').hidden=false;$('#captured-at').value='';}
  catch{URL.revokeObjectURL(url);toast('画像を読み込めませんでした');}
}
async function saveScreenshot(){
  if(!cropImage||ocrBusy)return;const top=+$('#crop-top').value/100,bottom=+$('#crop-bottom').value/100;
  if(top+bottom>=.95){toast('残す範囲を5%以上にしてください');return;}
  const rawHeight=cropImage.naturalHeight*(1-top-bottom),scale=Math.min(1,1600/cropImage.naturalWidth),canvas=document.createElement('canvas');canvas.width=Math.round(cropImage.naturalWidth*scale);canvas.height=Math.max(1,Math.round(rawHeight*scale));
  canvas.getContext('2d').drawImage(cropImage,0,cropImage.naturalHeight*top,cropImage.naturalWidth,rawHeight,0,0,canvas.width,canvas.height);
  const value={image:canvas.toDataURL('image/png'),source:$('#screenshot-source').value,memo:$('#screenshot-memo').value,importedAt:new Date().toISOString(),capturedAt:$('#captured-at').value?new Date(`${$('#captured-at').value}:00+09:00`).toISOString():null};
  const job=++ocrJob;setOCRBusy(true);$('#ocr-error').textContent='';
  try{await runOCR(value,'#saved-screenshot','screenshot',job);if(job!==ocrJob)return;renderScreenshot(value);$('#crop-editor').hidden=true;URL.revokeObjectURL(cropImage.src);cropImage=null;toast(value.ocr?'画像と読み取り結果を保存しました':'画像を保存しました。OCRは未完了です');}catch{toast('画像を保存できませんでした');}finally{if(job===ocrJob)setOCRBusy(false);}
}
function exportSettings(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='my-map-settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function importSettings(file){
  try{if(!file||file.size>1024*1024)throw Error('1MB以下の設定ファイルを選択してください。');const s=JSON.parse(await file.text());
    if(s?.version!==1||!Array.isArray(s.favorites)||!Array.isArray(s.savedRoutes)||s.favorites.length>100||s.savedRoutes.length>20)throw Error('設定ファイルが正しくありません。');
    if(!['system','light','dark'].includes(s.theme)||![1,3,5,10].includes(s.buffer)||!subwayIds.includes(s.passes?.subwayFrom)||!subwayIds.includes(s.passes?.subwayTo))throw Error('定期区間・表示設定を確認してください。');
    if(!['citybus','kyotobus','subway'].every(k=>typeof s.passes[k]==='boolean')||typeof s.passes.expires!=='string'||(s.passes.expires&&!/^\d{4}-\d{2}-\d{2}$/.test(s.passes.expires)))throw Error('定期券の形式が正しくありません。');
    if(!s.favorites.every(id=>network.stops.has(id))||!s.savedRoutes.every(r=>network.stops.has(r.from)&&network.stops.has(r.to)&&Array.isArray(r.via)&&r.via.length<=3&&r.via.every(v=>network.stops.has(v.stop)&&Number.isFinite(v.dwell)&&v.dwell>=0&&v.dwell<=180)))throw Error('未対応の場所が含まれています。');
    saveState(s);state=loadState();renderSettings();renderFavorites();renderPasses();mobility?.refreshSettings();toast('設定を復元しました');
  }catch(e){toast(e.message||'設定を読み込めませんでした');}
}
async function importFeed(file){try{if(!file||file.size>40*1024*1024)throw Error('40MB以下のデータを選択してください。');const data=validateFeed(JSON.parse(await file.text()));await putFile('feed',data);network=applyFeed(base,data);updateFeedStatus();toast('時刻データを読み込みました');renderPasses();}catch(e){toast(e.message||'時刻データを読み込めませんでした');}}
function updateFeedStatus(){
  $('#feed-status').textContent=network.mode==='demo'?'シミュレーション専用データ（主検索はYahoo!）':`取込：${network.source}`;
}
function updateConditions(){$('#condition-summary').textContent=`${{all:'普通・急行を比較',local:'普通のみ',express:'急行のみ'}[$('#train-type').value]}・余裕${$('#buffer').value}分`;
  $('#yahoo-condition-note').hidden=false;
}
async function init(){
  paintIcons();setNow();
  const response=await fetch('data/bus-catalog.json');if(!response.ok)throw Error('停留所データを読み込めませんでした。');base=createNetwork(await response.json());network=base;
  try{const feed=await getFile('feed');if(feed)network=applyFeed(base,feed);}catch{/* データがない環境でもYahoo検索を利用できる。 */}
  renderSettings();renderLocations();renderPasses();updateFeedStatus();updateConditions();readScreenshot();readLiveReports();setTab('today');window.addEventListener('resize',moveTabSelection);
  mobility=mountMobility({network:base,getState:()=>state,commit,openPicker,toast,setTab,now:tokyoNow,
    sceneChanged:()=>{if(!$('#stop-dialog').open)setTab('today');},
    showOperations:()=>{setTab('live',false);$('#capture-rail').closest('.card').scrollIntoView({behavior:'smooth',block:'start'});},
    setSearchFrom:from=>{query.from=from;renderLocations();setTab('search');$('#from-name').scrollIntoView({behavior:'smooth',block:'center'});},
    navigate:(from,to)=>{query=schoolRequest({from,to,via:[]});setNow();renderLocations();setTab('search');searchYahoo();},
    showBus:async(id,route)=>{liveStop=base.stops.get(id)?.fullName??name(id);$('#live-stop-name').textContent=liveStop;$('#bus-live-result').innerHTML='';setTab('live',false);await loadLiveChoices();const c=choices.find(c=>c.route===route)??choices[0];if(c){$('#live-choice').value=c.value;await updateBus();}},
    showMeeting:(journey,r,updatedAt,notice)=>{setTab('search');query={from:r.from,to:journey.schoolAvailable?'ksu':'K01',via:[{stop:journey.point.id,dwell:Math.min(180,journey.available),exitGate:false}]};currentRequest={...r,...query,trainType:'all',maxWalk:30};$('#date').value=r.date;$('#time').value=formatTime(r.start);renderLocations();results=[journey.journey];routeUpdatedAt=updatedAt;routeNotice=notice;routeMode='real';openRoute=0;sort='fast';renderResults();$('#results-section').scrollIntoView({behavior:'smooth',block:'start'});}
  });
  setInterval(()=>{$$('[data-freshness]').forEach(e=>{e.textContent=freshness(e.dataset.freshness);e.classList.toggle('orange',e.textContent!=='取得から2分以内');});},30000);
  document.addEventListener('click',e=>{
    const b=e.target.closest('button,a');if(!b)return;const d=b.dataset;
    if(d.tab)setTab(d.tab);
    else if(d.pick)openPicker(d.pick);
    else if(d.stop)selectStop(d.stop);
    else if(d.filter){pickerFilter=d.filter;$$('#picker-filters button').forEach(x=>x.classList.toggle('active',x===b));renderPicker();}
    else if(d.quick){query.to=d.quick;renderLocations();}
    else if(d.viaRemove!==undefined){query.via.splice(+d.viaRemove,1);renderLocations();}
    else if(d.viaUp!==undefined){const i=+d.viaUp;if(i>0)[query.via[i],query.via[i-1]]=[query.via[i-1],query.via[i]];renderLocations();}
    else if(d.sort){sort=d.sort;renderResults();}
    else if(d.openRoute!==undefined){openRoute=openRoute===+d.openRoute?-1:+d.openRoute;renderResults();}
    else if(d.saveQuery!==undefined)saveQuery();
    else if(d.cancelSearch!==undefined)searchController?.abort();
    else if(d.routeBus){liveStop=base.stops.get(d.routeBus)?.fullName??name(d.routeBus);$('#live-stop-name').textContent=liveStop;$('#bus-live-result').innerHTML='';loadLiveChoices().then(()=>{const choice=choices.find(c=>c.route===d.routeNumber);if(choice)$('#live-choice').value=choice.value;setTab('live');});}
    else if(d.yahooLeg!==undefined)launchLeg(+d.yahooLeg);
    else if(d.favFrom||d.favTo){query[d.favFrom?'from':'to']=d.favFrom||d.favTo;renderLocations();setTab('search');}
    else if(d.favRemove){commit(s=>{s.favorites=s.favorites.filter(id=>id!==d.favRemove);});renderFavorites();renderPasses();}
    else if(d.loadRoute!==undefined){const r=state.savedRoutes[+d.loadRoute];query=structuredClone({from:r.from,to:r.to,via:r.via});$('#train-type').value=r.trainType??'all';renderLocations();updateConditions();setTab('search');}
    else if(d.deleteRoute!==undefined){commit(s=>s.savedRoutes.splice(+d.deleteRoute,1));renderFavorites();}
    else if(d.copyRoute!==undefined){const r=results[+d.copyRoute],fare=routeMode==='real'?journeyFare(r,base,state.passes,currentRequest.date):r.fare,text=`${routeMode==='demo'?'【試作・推定時刻】':'My Map '}${name(currentRequest.from)}→${name(currentRequest.to)}\n${formatTime(r.start)}→${formatTime(r.time)} ${r.duration}分\n追加 ${yen(fare.additional)}（通常 ${yen(fare.normal)}）\n${r.legs.filter(l=>l.kind==='ride').map(l=>`${formatTime(l.depart)} ${name(l.from)} ${l.label} → ${name(l.to)} ${formatTime(l.arrive)}`).join('\n')}`;navigator.clipboard?.writeText(text).then(()=>toast('コピーしました')).catch(()=>toast('コピーを利用できませんでした'));}
  });
  $('#search-form').addEventListener('submit',searchYahoo);
  $('#demo-search').addEventListener('click',searchDemo);
  $('#swap').addEventListener('click',()=>{[query.from,query.to]=[query.to,query.from];query.via.reverse();renderLocations();});
  $('#now').addEventListener('click',()=>{setNow();renderPasses();});
  $('#add-via').addEventListener('click',()=>openPicker('via-add'));
  $('#close-picker').addEventListener('click',()=>$('#stop-dialog').close());
  $('#picker-search').addEventListener('input',renderPicker);
  $('#stop-dialog').addEventListener('click',e=>{if(e.target===$('#stop-dialog')){const rect=e.target.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)e.target.close();}});
  $('#waypoints').addEventListener('change',e=>{if(e.target.dataset.dwell!==undefined)query.via[+e.target.dataset.dwell].dwell=+e.target.value;if(e.target.dataset.exit!==undefined)query.via[+e.target.dataset.exit].exitGate=e.target.checked;});
  $('#date').addEventListener('change',renderPasses);
  for(const id of ['train-type','buffer'])$(`#${id}`).addEventListener('change',()=>{updateConditions();if(id==='buffer')commit(s=>{s.buffer=+$('#buffer').value;});});
  $('#example-commute').addEventListener('click',()=>{query=schoolRequest({from:'K07',to:'ksu',via:[]});renderLocations();toast('国際会館経由の通学ルートを入力しました');});
  $('#example-return').addEventListener('click',()=>mobility.openMeeting());
  for(const id of ['pass-citybus','pass-kyotobus','pass-subway','pass-from','pass-to','pass-expires'])$(`#${id}`).addEventListener('change',updatePasses);
  $('#theme').addEventListener('change',()=>{commit(s=>{s.theme=$('#theme').value;});setTheme();});
  $('#export-settings').addEventListener('click',exportSettings);
  $('#import-settings').addEventListener('change',e=>importSettings(e.target.files[0]));
  $('#import-feed').addEventListener('change',e=>importFeed(e.target.files[0]));
  $('#reset-feed').addEventListener('click',async()=>{try{await deleteFile('feed');network=base;updateFeedStatus();renderPasses();toast('試作データに戻しました');}catch{toast('データを変更できませんでした');}});
  $('#screenshot-file').addEventListener('change',e=>chooseScreenshot(e.target.files[0]));
  $('#save-screenshot').addEventListener('click',saveScreenshot);
  $('#reload-choices').addEventListener('click',loadLiveChoices);
  $('#capture-bus').addEventListener('click',()=>updateBus());
  $('#live-choice').addEventListener('change',()=>{$('#bus-live-result').innerHTML='';restoreBusReport();updateBus();});
  busRefresh=createRefreshLoop({refresh:()=>updateBus(true),canRefresh:()=>!document.hidden&&!$('#live-view').hidden&&!ocrBusy&&!choicesBusy&&choices.length>0});
  $('#bus-auto-refresh').addEventListener('change',e=>{busRefresh.touch();busRefresh.setEnabled(e.target.checked);});
  document.addEventListener('visibilitychange',()=>busRefresh.tick());
  window.addEventListener('pagehide',()=>busRefresh.dispose());
  window.addEventListener('pageshow',()=>busRefresh.setEnabled($('#bus-auto-refresh').checked));
  $('#capture-bus-image').addEventListener('click',()=>captureOfficial('bus'));
  $('#capture-rail').addEventListener('click',()=>captureOfficial('rail'));
  $('#ocr-cancel').addEventListener('click',async()=>{ocrJob++;ocrController?.abort();await cancelOCR();setOCRBusy(false);$('#ocr-error').textContent='読み取りを中止しました。';});
  $('#remove-screenshot').addEventListener('click',async()=>{try{await deleteFile('screenshot');renderScreenshot(null);toast('保存画像を削除しました');}catch{toast('削除できませんでした');}});
}
init().catch(e=>{$('#form-error').textContent=e.message;$('#search-submit').disabled=true;$('#demo-search').disabled=true;});
