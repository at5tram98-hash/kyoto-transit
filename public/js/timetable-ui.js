import {CAPTURE_API} from './live.js';
import {searchStops} from './network.js';
import {formatTime} from './router.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const transitSymbol=bus=>`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="16" rx="4"/><path d="M5 11h14M12 3v8M8 22l1-3m7 3-1-3M8 15h.01M16 15h.01"/>${bus?'<path d="M3 7v4m18-4v4"/>':''}</svg>`;
const kind=e=>e.route??(e.category==='express'?'急行':e.category==='local'?'普通':e.category==='other'?'その他':'種別未取得');
export async function officialData(path,params={},signal){
  const url=new URL(path,CAPTURE_API);for(const[k,v]of Object.entries(params))if(v!==null&&v!==undefined)url.searchParams.set(k,v);
  const r=await fetch(url,{signal:signal??AbortSignal.timeout(60000),cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error??'公式データを取得できませんでした。');return d;
}
export const dayLabel={weekday:'平日',saturday:'土曜',holiday:'休日',weekday_a:'平日A',weekday_b:'平日B',wednesday_a:'水曜A'};
export function stopTable(stops,{shift=0,now=-Infinity,nextId=null}={}){
  return `<ol class="stop-timeline">${stops.map((s,i)=>{const time=s.arrival??s.time??s.departure,late=Number.isFinite(time)&&time+shift<now;return `<li class="${late?'passed':''} ${s.id===nextId?'next-stop':''}"><span class="timeline-dot"></span><span><b>${esc(s.name)}</b>${i===stops.length-1?'<small>終点</small>':s.id===nextId?'<small>次の停車</small>':''}</span><time>${Number.isFinite(time)?formatTime(Math.round(time+shift)):'—'}${shift&&Number.isFinite(time)?`<small>定刻 ${formatTime(time)}</small>`:''}</time></li>`;}).join('')}</ol>`;
}
export function mountTimetables({network,getState,now,setTab}){
  const root=document.querySelector('#timetable-root');let chosen=null,options=null,board=null,controller,job=0;
  root.innerHTML=`<div class="native-search"><span aria-hidden="true">⌕</span><input id="timetable-search" type="search" placeholder="駅・停留所・系統を検索" aria-label="時刻表を検索" autocomplete="off"></div><div id="timetable-stop-list"></div><section id="timetable-board" hidden></section><dialog class="sheet" id="timetable-trip"><div class="sheet-handle"></div><div class="sheet-heading"><h2>この便の停車時刻</h2><button class="plain" data-close-trip>完了</button></div><div id="timetable-trip-content"></div></dialog>`;
  const $=s=>root.querySelector(s);
  function list(){const q=$('#timetable-search').value,favorites=getState().favorites??[],all=searchStops(network,q).slice(0,q?50:12),saved=!q?favorites.map(id=>network.stops.get(id)).filter(Boolean):[];
    $('#timetable-stop-list').innerHTML=(saved.length?'<h2 class="native-section-label">よく使う場所</h2>'+rows(saved):'')+`<h2 class="native-section-label">${q?'検索結果':'駅・停留所'}</h2>${rows(all)}${!all.length?'<p class="empty-note">対応する場所が見つかりません</p>':''}`;
  }
  function rows(stops){return `<div class="native-list">${stops.map(s=>`<button class="native-row" data-timetable-stop="${esc(s.id)}"><span class="system-symbol ${s.type.includes('bus')?'bus':s.type==='subway'?'subway':'rail'}">${transitSymbol(s.type.includes('bus'))}</span><span><b>${esc(s.name)}</b><small>${esc(s.lines.join('・'))}</small></span><span class="chev">›</span></button>`).join('')}</div>`;}
  async function select(id){chosen=id;controller?.abort();controller=new AbortController();const current=++job;$('#timetable-stop-list').hidden=true;$('#timetable-board').hidden=false;$('#timetable-board').innerHTML='<p class="loading-note" role="status">公式の時刻表を取得中…</p>';
    try{options=await officialData('/timetable/options',{stop:id},controller.signal);if(current!==job)return;
      $('#timetable-board').innerHTML=`<button class="plain" data-timetable-back>‹ 駅・停留所</button><h2 class="board-place">${esc(options.name)}</h2><div class="board-controls"><label>方面<select id="timetable-direction">${options.boards.map(b=>`<option value="${esc(b.key)}">${esc(b.label)}</option>`).join('')}</select></label><label>ダイヤ<select id="timetable-day"><option value="auto">今日</option>${Object.entries(dayLabel).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label></div><div id="timetable-entries" aria-live="polite"></div>`;await loadBoard();
    }catch(e){if(current===job&&!controller.signal.aborted)$('#timetable-board').innerHTML=`<button class="plain" data-timetable-back>‹ 戻る</button><p class="empty-note">${esc(e.message)}</p>`;}
  }
  async function loadBoard(){const current=++job,direction=$('#timetable-direction').value,day=$('#timetable-day').value;$('#timetable-entries').innerHTML='<p class="loading-note" role="status">発車時刻を取得中…</p>';
    try{board=await officialData('/timetable',{stop:chosen,direction,day,date:now().date},controller.signal);if(current!==job)return;const hours=new Map();for(const e of board.entries){const h=Math.floor(e.depart/60);if(!hours.has(h))hours.set(h,[]);hours.get(h).push(e);}
      $('#timetable-entries').innerHTML=`<div class="board-summary"><span>${esc(dayLabel[board.day]??board.day)}${board.platform?`・${esc(board.platform)}番線`:''}</span><small>${esc(board.effective??'')}</small></div>${hours.size?`<div class="hour-table">${[...hours].map(([h,entries])=>`<div class="hour-row"><strong>${h%24}<small>時</small></strong><div>${entries.map(e=>`<button class="minute-cell ${e.category==='express'?'express':''}" ${e.tripId?`data-timetable-trip="${esc(e.tripId)}"`:'disabled'} aria-label="${formatTime(e.depart)} ${esc(e.destination)} ${esc(kind(e))}"><b>${String(e.depart%60).padStart(2,'0')}</b>${e.category||e.route?`<small>${esc(kind(e))}</small>`:''}${e.destination?`<span>${esc(e.destination)}</span>`:''}</button>`).join('')}</div></div>`).join('')}</div>`:'<p class="empty-note">このダイヤの発車便はありません。</p>'}<p class="source-caption">公式取得 ${new Date(board.fetchedAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'})} · 時刻は予定</p><a class="plain" href="${esc(board.sourceURL)}" target="_blank" rel="noopener">公式時刻表の出典</a>${board.dayRequired?'<p class="empty-note">平日A・B・水曜Aからダイヤを選んでください。</p>':''}`;
    }catch(e){if(current===job&&!controller.signal.aborted)$('#timetable-entries').innerHTML=`<p class="empty-note">${esc(e.message)}</p>`;}
  }
  root.addEventListener('input',e=>{if(e.target.id==='timetable-search'){$('#timetable-board').hidden=true;$('#timetable-stop-list').hidden=false;list();}});
  root.addEventListener('change',e=>{if(['timetable-direction','timetable-day'].includes(e.target.id))loadBoard();});
  root.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.timetableStop)select(b.dataset.timetableStop);else if(b.hasAttribute('data-timetable-back')){controller?.abort();job++;$('#timetable-board').hidden=true;$('#timetable-stop-list').hidden=false;list();}else if(b.hasAttribute('data-close-trip'))$('#timetable-trip').close();else if(b.dataset.timetableTrip){$('#timetable-trip-content').innerHTML='<p class="loading-note">停車時刻を取得中…</p>';$('#timetable-trip').showModal();try{const trip=await officialData('/timetable/trip',{stop:chosen,direction:$('#timetable-direction').value,day:board.day,trip:b.dataset.timetableTrip});$('#timetable-trip-content').innerHTML=`<p class="trip-heading">${esc(trip.title)}</p>${stopTable(trip.stops)}<p class="source-caption">公式時刻表 · 予定時刻</p>`;}catch(err){$('#timetable-trip-content').innerHTML=`<p class="empty-note">${esc(err.message)}</p>`;}}});
  list();return {select(id){setTab('timetable');return select(id);},show(){if(!chosen)list();}};
}
export function mountOperations(){
  const root=document.querySelector('#operations-root');let last=0,busy=false;
  root.innerHTML='<p class="empty-note">対応路線の最新情報を自動取得します</p>';
  async function refresh(force=false){if(busy||!force&&Date.now()-last<60000)return;busy=true;root.setAttribute('aria-busy','true');
    try{const d=await officialData('/operations');last=Date.now();root.innerHTML=`<div class="operations-head"><span>公式情報を確認</span><button class="plain" data-operations-refresh>更新</button></div>${d.lines.map(l=>`<article class="operation-card"><div class="operation-title"><span class="system-symbol ${l.id==='subway'?'subway':l.id==='kintetsu'?'rail':'bus'}">${transitSymbol(l.id.includes('bus'))}</span><h2>${esc(l.name)}</h2><span class="status-dot ${l.status}"></span></div><p>${esc(l.summary)}</p><div class="operation-routes">${l.routes.map(r=>`<span>${esc(r)}</span>`).join('')}</div>${l.notices.length?`<ul class="operation-notices">${l.notices.map(n=>`<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)} ›</a></li>`).join('')}</ul>`:''}<small>${l.fetchedAt?'取得 '+new Date(l.fetchedAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}):'取得できませんでした'}</small></article>`).join('')}<p class="source-caption">${esc(d.notice)}</p>`;}
    catch(e){root.innerHTML=`<p class="empty-note">${esc(e.message)}</p><button class="plain" data-operations-refresh>再取得</button>`;}finally{busy=false;root.removeAttribute('aria-busy');}
  }
  root.addEventListener('click',e=>{if(e.target.closest('[data-operations-refresh]'))refresh(true);});return {show:refresh};
}
