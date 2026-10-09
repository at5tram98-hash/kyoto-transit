import {locate,trainKey,trainCandidates,nextStop} from './mobility.js';
import {getJourneys,journeyFare} from './journey.js';
import {CAPTURE_API} from './live.js';
import {formatTime} from './router.js';
import {subwayIds,kintetsuIds} from './network.js';
import {distance} from './mobility.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const minute=time=>time.split(':').map(Number).reduce((h,m)=>h*60+m);
const symbol=n=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${n==='location'?'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>':n==='school'?'<path d="m2 8 10-5 10 5-10 5Z"/><path d="M5 10v7q7 5 14 0v-7M22 8v9"/>':n==='friends'?'<path d="M3 18v-5a4 4 0 0 1 8 0v5m2 0v-5a4 4 0 0 1 8 0v5M5 21l2-3m12 3-2-3"/><circle cx="7" cy="5" r="2"/><circle cx="17" cy="5" r="2"/>':'<path d="M3 8h18l-2-5H5Zm1 0v12h16V8M9 20v-7h6v7"/>'}</svg>`;

export function mountMobility(api){
  const {network,getState,commit,toast,openPicker}=api,root=document.querySelector('#mobility-root'),$=s=>root.querySelector(s),name=id=>network.stops.get(id)?.name??'未設定';
  let origin='K07',geo,fix,previous,location,watch=null,geoJob=0,job=0,controller,friendRoutes=[],friendRequest,meetingData,meetingRequest,trackRoutes=[],trackRequest,confirmed=null,lastAutoStop=null,lastRailFetch=0,lastBusFetch=0;
  root.innerHTML=`<h2 class="section-head">いまの移動</h2><section class="card mobility-card"><div class="mobility-heading"><span class="round-symbol">${symbol('location')}</span><div><b id="position-heading">現在地から案内</b><small id="position-status" role="status">位置情報を使うと、最寄りの駅・バス停を探せます</small></div><button class="plain" id="geo-start">取得</button></div><button class="location-field compact-location" data-pick="assist-from"><span>出発する駅・バス停</span><strong id="assist-origin">丸太町</strong><small id="assist-origin-note">手動で変更できます</small></button><div id="nearest-place" hidden></div><div class="destination-grid"><button data-destination="ksu">${symbol('school')}<b>京都産大</b><small>国際会館経由</small></button><button data-destination="muji">${symbol('store')}<b>無印良品</b><small id="muji-short">勤務地を登録</small></button><button data-destination="gu">${symbol('store')}<b>GU</b><small id="gu-short">勤務地を登録</small></button><button id="open-meeting">${symbol('friends')}<b>一緒に乗る</b><small>高の原からの友達と</small></button></div><p class="fine">現在地は端末内で判定し、保存しません。線路付近にいるだけでは乗車中と確定できません。</p></section>
  <section id="meeting-panel" class="card meeting-panel" hidden><div class="section-title"><span class="round-symbol">${symbol('friends')}</span><h2>友達の列車に合流</h2><button class="plain" id="close-meeting">閉じる</button></div><p class="muted">友達は高の原から京都方面へ。間に合う範囲でできるだけ南まで行き、折り返して長く一緒に乗ります。</p><div class="meeting-inputs"><label>移動する日<input type="date" id="meeting-date" required></label><label>自分の出発時刻<input type="time" id="self-time" required></label><button class="location-field compact-location" data-pick="meet-from"><span>自分の出発駅</span><strong id="meet-origin">丸太町</strong><small>列車を降りられる駅を指定</small></button><label>友達が高の原を出る時刻<input type="time" id="friend-time" required></label><label>友達の近鉄の種別<select id="friend-type"><option value="express">急行</option><option value="local">普通</option><option value="all">種別を比較</option></select></label></div><button class="secondary" id="friend-search">友達の列車を調べる</button><div id="friend-choices" aria-live="polite"></div><div class="meeting-options"><label>乗換に必要な時間<select id="meet-buffer"><option value="1">1分</option><option value="3" selected>3分</option><option value="5">5分</option><option value="10">10分</option></select></label><label>折り返しで最低限待つ時間<input type="number" id="meet-wait" value="0" min="0" max="180" step="1"><small>0〜180分・乗換時間も確保</small></label></div><button class="primary" id="meet-search" disabled>最大で行ける合流駅を探す</button><button class="plain" id="assist-cancel" hidden>検索を中止</button><p id="meeting-status" role="status" class="fine"></p><p id="meeting-error" class="form-error" role="alert"></p><div id="meeting-results" aria-live="polite"></div></section>
  <section id="train-panel" class="card train-panel"><details id="train-details"><summary>乗車中の列車・次の停車駅</summary><p class="fine">GPS・移動方向と取得した時刻表から候補を絞ります。地下ではGPSが止まるため、発車時刻と行先を確認して列車を選んでください。時刻は運行遅延を反映しない予定時刻です。</p><button class="location-field compact-location" data-pick="track-from"><span>乗った駅</span><strong id="track-origin">丸太町</strong></button><label class="block-label">進行方向<select id="track-direction"><option value="K01">国際会館方面</option><option value="A28">近鉄奈良方面</option><option value="B01">近鉄京都方面</option><option value="K15">竹田方面</option></select></label><button class="secondary" id="track-search">今の時刻の列車候補を取得</button><p class="fine" id="track-status" role="status"></p><div id="train-candidates"></div><div id="next-stop" aria-live="polite"></div></details></section>`;
  let meetOrigin=origin,trackOrigin=origin;
  function refreshSettings(){
    const destinations=getState().destinations??{};
    for(const k of ['muji','gu'])$(`#${k}-short`).textContent=destinations[k]?.label|| (destinations[k]?.stop?name(destinations[k].stop):'勤務地を登録');
    document.querySelector('#destination-settings').innerHTML=`<h2>いつもの行先</h2><p class="muted">店舗名と、対応範囲内の最寄り駅・バス停を登録します。</p>${['muji','gu'].map(k=>`<label class="block-label">${k==='muji'?'無印良品':'GU'}の店舗名<input type="text" maxlength="80" data-work-label="${k}" value="${esc(destinations[k]?.label??'')}" placeholder="店舗名を入力"></label><button class="location-field compact-location" data-pick="work-${k}"><span>勤務地の最寄り駅・バス停</span><strong>${esc(name(destinations[k]?.stop))}</strong><small>選択して保存</small></button>`).join('')}<p class="fine">京都産大は国際会館〜京都バスに固定。店舗そのものまでの徒歩は登録した最寄り駅・バス停から確認してください。</p>`;
  }
  document.querySelector('#destination-settings').addEventListener('change',e=>{const k=e.target.dataset.workLabel;if(!k)return;commit(s=>{s.destinations??={muji:{label:'',stop:null},gu:{label:'',stop:null}};s.destinations[k].label=e.target.value.trim().slice(0,80);});refreshSettings();});
  function setOrigin(id){origin=id;$('#assist-origin').textContent=name(id);if(['subway','kintetsu'].includes(network.stops.get(id)?.type)){meetOrigin=id;trackOrigin=id;$('#meet-origin').textContent=name(id);$('#track-origin').textContent=name(id);}}
  function stopGeo(){geoJob++;if(watch!==null)navigator.geolocation.clearWatch(watch);watch=null;$('#geo-start').textContent='取得';}
  async function startGeo(){
    if(watch!==null){stopGeo();$('#position-status').textContent='現在地の更新を停止しました';return;}
    if(!navigator.geolocation){$('#position-status').textContent='位置情報を利用できません。駅・バス停を指定してください。';return;}
    const current=++geoJob;$('#position-status').textContent='現在地を取得しています…';
    try{if(!geo){const r=await fetch('data/locations.json');if(!r.ok)throw Error('位置データを読み込めませんでした');geo=await r.json();}if(current!==geoJob)return;
      watch=navigator.geolocation.watchPosition(p=>{
        if(current!==geoJob)return;previous=fix;fix={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp};location=locate(fix,geo,network);renderLocation();renderTracking();
      },e=>{if(current!==geoJob)return;$('#position-status').textContent=e.code===1?'位置情報が許可されていません。駅・バス停を選んで案内できます。':'現在地を取得できません。地下では駅を手動で指定してください。';stopGeo();},{enableHighAccuracy:true,maximumAge:10000,timeout:20000});$('#geo-start').textContent='停止';
    }catch(e){$('#position-status').textContent=e.message;stopGeo();}
  }
  function renderLocation(){
    const {status,rail,bus}=location;$('#nearest-place').hidden=true;
    if(['outside','unavailable'].includes(status)){$('#position-status').textContent=status==='outside'?'対応エリア付近にいません。出発地を指定してください。':'現在地が古くなりました。駅・バス停を指定してください。';return;}
    $('#position-heading').textContent=status==='rail'?'路線付近にいます':status==='bus'?'近くのバス停から':'現在地の精度を確認';
    $('#position-status').textContent=`位置の精度 約${Math.round(fix.accuracy)}m${status==='uncertain'?'・自動選択を保留':''}`;
    if(status!=='uncertain'){setOrigin(status==='rail'?rail.id:bus.id);$('#assist-origin-note').textContent=`直線距離 約${Math.round((status==='rail'?rail:bus).meters)}m・のりばを確認`;}
    const stop=network.stops.get(bus.id);$('#nearest-place').hidden=false;$('#nearest-place').innerHTML=`<div class="nearest-row"><span class="round-symbol">${symbol('location')}</span><div><small>最寄りの対応市バス停</small><b>${esc(stop.name)}</b><small>約${Math.round(bus.meters)}m（直線距離）</small></div><button class="plain" id="nearest-bus">接近を見る</button></div>`;
    if(status==='bus'&&lastAutoStop!==bus.id&&Date.now()-lastBusFetch>60000){lastAutoStop=bus.id;lastBusFetch=Date.now();$('#position-status').textContent+='・接近情報を取得';api.showBus(bus.id);}
    if(status==='rail'){$('#train-details').open=true;if(!confirmed&&Date.now()-lastRailFetch>60000&&$('#track-search').disabled===false){lastRailFetch=Date.now();loadTrack(true);}}
  }
  function busy(label){controller?.abort();controller=new AbortController();job++;$('#friend-search').disabled=true;$('#meet-search').disabled=true;$('#track-search').disabled=true;$('#assist-cancel').hidden=false;$('#meeting-status').textContent=label;$('#meeting-error').textContent='';return {id:job,signal:controller.signal};}
  function done(id){if(id!==job)return;$('#friend-search').disabled=false;$('#track-search').disabled=false;$('#meet-search').disabled=!friendRoutes.length;$('#assist-cancel').hidden=true;}
  function fail(e,id){if(id!==job)return;$('#meeting-error').textContent=e.name==='AbortError'?'検索を中止しました。または時間切れです。':e.message;$('#meeting-status').textContent='';}
  function friendOptions(){return {from:'B24',to:'K01',via:[],date:$('#meeting-date').value,start:minute($('#friend-time').value),trainType:$('#friend-type').value,buffer:+$('#meet-buffer').value,maxWalk:30};}
  function invalidateFriend(){controller?.abort();job++;friendRoutes=[];friendRequest=null;meetingData=null;$('#friend-choices').innerHTML='';$('#meeting-results').innerHTML='';$('#meet-search').disabled=true;done(job);}
  async function loadFriends(){
    if(!$('#meeting-date').value||!$('#friend-time').value){$('#meeting-error').textContent='日付と友達の出発時刻を入力してください。';return;}
    const task=busy('高の原から京都方面の列車を取得中…'),timeout=setTimeout(()=>controller.abort(),90000);
    try{const r=friendOptions(),data=await getJourneys(r,task.signal);if(task.id!==job)return;friendRoutes=data.routes;friendRequest=r;$('#meeting-status').textContent='友達が乗る便を、発車時刻・行先で選んでください。';$('#friend-choices').innerHTML=friendRoutes.length?friendRoutes.map((p,i)=>{const first=p.legs.find(l=>l.kind==='ride');return `<label class="friend-choice"><input type="radio" name="friend-train" value="${i}" ${i===0?'checked':''}><span><b>${formatTime(first.depart)} 高の原 発</b><small>${esc(first.label)}・${esc(first.destination)}</small><small>国際会館 ${formatTime(p.time)}着・乗換${p.transfers}回</small></span></label>`;}).join(''):'<p class="muted">対応路線・指定種別の候補がありません。時刻または種別を変更してください。</p>';}
    catch(e){fail(e,task.id);}finally{clearTimeout(timeout);done(task.id);}
  }
  async function searchMeeting(){
    const index=+$('input[name="friend-train"]:checked')?.value,friend=friendRoutes[index],wait=+$('#meet-wait').value;
    if(!friend||!$('#self-time').value||!Number.isInteger(wait)||wait<0||wait>180){$('#meeting-error').textContent='友達の列車・自分の出発時刻・待ち時間を確認してください。';return;}
    if(!['subway','kintetsu'].includes(network.stops.get(meetOrigin)?.type)){$('#meeting-error').textContent='自分が出発する駅を選んでください。';return;}
    const r={from:meetOrigin,date:friendRequest.date,start:minute($('#self-time').value),friendStart:friendRequest.start,friendType:friendRequest.trainType,buffer:+$('#meet-buffer').value,wait,friendKey:trainKey(friend)};
    const task=busy('友達の停車駅を南側から比較中…'),timeout=setTimeout(()=>controller.abort(),180000);$('#meeting-results').innerHTML='';
    try{const url=new URL('/meeting',CAPTURE_API);url.searchParams.set('request',JSON.stringify(r));const response=await fetch(url,{signal:task.signal,cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(data.error??'合流駅を取得できませんでした');if(task.id!==job)return;meetingData=data;meetingRequest=r;renderMeeting();$('#meeting-status').textContent='友達の列車と同じ便に乗れる候補です。';}
    catch(e){fail(e,task.id);}finally{clearTimeout(timeout);done(task.id);}
  }
  function renderMeeting(){
    if(!meetingData)return;const data=meetingData;
    $('#meeting-results').innerHTML=(data.plans.length?data.plans.map((p,i)=>{const f=journeyFare(p.journey,network,getState().passes,meetingRequest.date);return `<article class="meet-result"><div class="route-top"><span class="badge ${i?'neutral':''}">${i?'ほかの合流候補':'確認できた最大地点'}</span><span class="badge neutral">一緒に電車 ${p.point.sharedMinutes}分</span></div><h3>${esc(name(p.point.id))}<small>で折り返して合流</small></h3><div class="meet-lanes"><div><span class="person-dot self">自分</span><b>${formatTime(p.route.time)}</b><small>到着・下車</small></div><span class="meet-connector">→</span><div><span class="person-dot friend">友達</span><b>${formatTime(p.point.time)}</b><small>同じ列車に乗車</small></div></div><div class="meet-metrics"><div><b>${p.available}<small>分</small></b><span>折り返し待ち</span></div><div><b>${p.required}<small>分</small></b><span>必要な余裕</span></div><div><b class="${p.slack>=3?'free':''}">${p.slack}<small>分</small></b><span>余裕を引いた残り</span></div></div><p class="fine">${esc(p.journey.legs.find(l=>l.kind==='ride'&&l.from===p.point.id)?.platform??'番線は未取得。駅の案内を確認してください。')}<br>国際会館 ${formatTime(data.friend.time)}着${p.schoolAvailable?` → 京産大 ${formatTime(p.journey.time)}着`:'。京産大行きのバス候補を取得できませんでした。'}</p><div class="meet-fare"><b class="${f.additional===0?'free':''}">追加 ${f.additional===null?'要確認':f.additional.toLocaleString('ja-JP')+'円'}</b><span>通常 ${f.normal.toLocaleString('ja-JP')}円</span></div><button class="secondary" data-meeting-plan="${i}">この合流ルートを表示</button></article>`;}).join(''):'<p class="muted">選んだ列車には、指定の余裕を確保して合流できません。友達の次の便、自分の出発時刻、待ち時間を変更してください。</p>')+`<details class="meet-checked"><summary>比較した停車駅と到着時刻</summary><table><thead><tr><th>合流駅</th><th>自分の到着</th><th>友達の発車</th><th>合流</th></tr></thead><tbody>${data.checked.map(p=>`<tr><td>${esc(name(p.id))}</td><td>${p.earliest===null?'候補なし':formatTime(p.earliest)}</td><td>${formatTime(p.time)}</td><td>${p.unconfirmed?'未確認':p.possible?'可':'不可'}</td></tr>`).join('')}</tbody></table></details><p class="fine">${esc(data.notice)}<br>乗車時間は電車の区間のみ。待ち時間・徒歩・バスは含みません。</p>`;
  }
  function openMeeting(){const n=api.now();$('#meeting-panel').hidden=false;$('#meeting-date').value=document.querySelector('#date').value||n.date;$('#self-time').value=document.querySelector('#time').value||n.time;const t=Math.min(1439,minute($('#self-time').value)+30);$('#friend-time').value=`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;$('#meet-buffer').value=String(getState().buffer);$('#meeting-panel').scrollIntoView({behavior:'smooth',block:'start'});}
  function renderTracking(){
    const n=api.now(),m=minute(n.time)+(trackRequest?Math.round((Date.parse(`${n.date}T00:00:00Z`)-Date.parse(`${trackRequest.date}T00:00:00Z`))/86400000)*1440:0),candidates=geo&&fix?trainCandidates(trackRoutes,fix,previous,geo,network,m):[];
    $('#track-status').textContent=!trackRoutes.length?'路線付近ならGPSと照合できます。まず候補を取得してください。':candidates.length?`GPSと時刻が合う候補 ${candidates.length}件。行先を確認してください。`:'GPSで確定できません。発車時刻と行先で選択してください。';
    if(confirmed){const next=nextStop(confirmed,network,m),fresh=fix&&Date.now()-fix.timestamp<=45000;$('#next-stop').innerHTML=next?`<div class="next-station"><span>${fresh?'確認した列車の予定':'GPS未取得・確認した列車の予定'}</span><h3>次は ${esc(next.name)}</h3><b>${formatTime(next.time)}<small>着予定・あと${Math.max(0,next.time-m)}分</small></b><p>${esc(confirmed.label)}・${esc(confirmed.destination)}</p><button class="plain" data-use-next="${esc(next.id)}" data-next-time="${next.time}">この駅で降りて合流検索へ</button></div>`:'<p class="fine">取得した区間の予定到着時刻を過ぎました。次の区間の候補を取得してください。</p>';}
    $('#train-candidates').innerHTML=trackRoutes.flatMap((r,ri)=>r.legs.filter(l=>['subway','kintetsu'].includes(l.operator)).map(l=>({l,ri}))).map(({l,ri},i)=>`<button class="train-choice ${candidates.some(c=>c.leg===l)?'gps-match':''}" data-confirm-train="${i}" ${m<l.depart-2||m>l.arrive?'disabled':''}><span>${formatTime(l.depart)} ${esc(name(l.from))}発 → ${formatTime(l.arrive)} ${esc(name(l.to))}着</span><b>${esc(l.label)}・${esc(l.destination)}</b><small>${candidates.some(c=>c.leg===l)?'GPS・予定時刻が一致する候補':m<l.depart-2||m>l.arrive?'この便は乗車時間外です':'行先と発車時刻を確認して選択'}</small></button>`).join('');
  }
  async function loadTrack(auto=false){
    if(auto&&location?.rail){
      const id=location.rail.id,ids=network.stops.get(id)?.type==='subway'?subwayIds:kintetsuIds,idx=ids.indexOf(id),north=geo.stops.find(s=>s.id==='K01');
      const change=previous&&Date.now()-previous.timestamp<45000?distance(previous,north)-distance(fix,north):0;
      if(Math.abs(change)>30)$('#track-direction').value=change>0?'K01':id.startsWith('K')?'K15':'A28';
      const towardNorth=['K01','B01'].includes($('#track-direction').value);trackOrigin=ids[Math.max(0,Math.min(ids.length-1,idx+(ids===subwayIds?(towardNorth?1:-1):(towardNorth?1:-1))))];
      $('#track-origin').textContent=name(trackOrigin);
    }
    if(trackOrigin===$('#track-direction').value){$('#track-status').textContent='乗った駅と行先を別の駅にしてください。';return;}
    const n=api.now(),t=minute(n.time)-20,date=new Date(Date.parse(`${n.date}T00:00:00Z`)+(t<0?-86400000:0)).toISOString().slice(0,10),r={from:trackOrigin,to:$('#track-direction').value,via:[],date,start:(t+1440)%1440,trainType:'all',buffer:1,maxWalk:10};
    const task=busy('実際の列車候補を取得中…'),timeout=setTimeout(()=>controller.abort(),90000);
    try{const d=await getJourneys(r,task.signal);if(task.id!==job)return;trackRoutes=d.routes;trackRequest=r;confirmed=null;$('#next-stop').innerHTML='';renderTracking();$('#meeting-status').textContent='';}catch(e){fail(e,task.id);$('#track-status').textContent=e.message;}finally{clearTimeout(timeout);done(task.id);}
  }
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;const d=b.dataset;
    if(b.id==='geo-start')startGeo();else if(b.id==='nearest-bus')api.showBus(location.bus.id);else if(b.id==='open-meeting')openMeeting();else if(b.id==='close-meeting')$('#meeting-panel').hidden=true;
    else if(b.id==='friend-search')loadFriends();else if(b.id==='meet-search')searchMeeting();else if(b.id==='track-search')loadTrack();else if(b.id==='assist-cancel')controller?.abort();
    else if(d.destination){if(d.destination==='ksu')api.navigate(origin,'ksu');else{const target=getState().destinations?.[d.destination]?.stop;if(network.stops.has(target))api.navigate(origin,target);else{api.setTab('settings');toast('勤務地の最寄り駅・バス停を登録してください');}}}
    else if(d.meetingPlan!==undefined){const p=meetingData.plans[+d.meetingPlan];api.showMeeting(p,meetingRequest,meetingData.updatedAt,meetingData.notice);}
    else if(d.confirmTrain!==undefined){confirmed=trackRoutes.flatMap(r=>r.legs.filter(l=>['subway','kintetsu'].includes(l.operator)))[+d.confirmTrain];renderTracking();}
    else if(d.useNext){meetOrigin=d.useNext;$('#meet-origin').textContent=name(meetOrigin);openMeeting();$('#self-time').value=formatTime(+d.nextTime).replace(/^翌日 /,'');if(+d.nextTime>=1440)$('#meeting-date').value=new Date(Date.parse(`${trackRequest.date}T00:00:00Z`)+86400000).toISOString().slice(0,10);}
  });
  for(const id of ['meeting-date','friend-time','friend-type'])$(`#${id}`).addEventListener('change',invalidateFriend);
  for(const id of ['self-time','meet-buffer','meet-wait'])$(`#${id}`).addEventListener('change',()=>{controller?.abort();job++;meetingData=null;$('#meeting-results').innerHTML='';done(job);});
  $('#friend-choices').addEventListener('change',()=>{controller?.abort();job++;meetingData=null;$('#meeting-results').innerHTML='';done(job);});
  const timer=setInterval(()=>{if(fix&&Date.now()-fix.timestamp>45000){$('#position-status').textContent='現在地の更新が止まっています。地下では駅を指定してください。';location={status:'unavailable'};}if(trackRoutes.length)renderTracking();},15000);
  window.addEventListener('pagehide',()=>{stopGeo();controller?.abort();clearInterval(timer);});
  refreshSettings();
  return {openMeeting,refreshSettings,routesChanged:(routes,r)=>{trackRoutes=routes;trackRequest=r;confirmed=null;renderTracking();},selectStop:(target,id)=>{
    if(target==='assist-from'){setOrigin(id);return true;}
    if(['meet-from','track-from'].includes(target)){if(!['subway','kintetsu'].includes(network.stops.get(id)?.type)){toast('列車に乗る駅を選んでください');return true;}if(target==='meet-from'){meetOrigin=id;$('#meet-origin').textContent=name(id);meetingData=null;$('#meeting-results').innerHTML='';}else{trackOrigin=id;$('#track-origin').textContent=name(id);confirmed=null;trackRoutes=[];renderTracking();}return true;}
    if(target?.startsWith('work-')){const k=target.slice(5);commit(s=>{s.destinations??={muji:{label:'',stop:null},gu:{label:'',stop:null}};s.destinations[k].stop=id;});refreshSettings();toast('勤務地の行先を保存しました');return true;}return false;
  }};
}
