import {summarizeFares} from './fares.js';
import {CAPTURE_API} from './live.js';
import {formatTime} from './router.js';
import {freshness} from './ocr.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=n=>n===null?'要確認':`${Number(n).toLocaleString('ja-JP')}円`;
export async function getJourneys(request,signal){
  const url=new URL('/journeys',CAPTURE_API);url.searchParams.set('request',JSON.stringify(request));
  let response;try{response=await fetch(url,{signal,cache:'no-store'});}catch(e){if(e.name==='AbortError')throw e;throw Error('検索サーバーに接続できませんでした。通信を確認して再検索してください。');}
  const data=await response.json();if(!response.ok)throw Error(data.error??'経路を取得できませんでした。');
  if(!Array.isArray(data.routes)||!Number.isFinite(Date.parse(data.updatedAt)))throw Error('取得した経路の形式を確認できませんでした。');return data;
}
export function journeyFare(route,network,passes,date){
  let estimated=false;
  const details=route.fareGroups.map(g=>{
    const legs=g.indices.map(i=>route.legs[i]);
    const groupDate=new Date(Date.parse(`${date}T00:00:00Z`)+Math.floor(legs[0].depart/1440)*86400000).toISOString().slice(0,10);
    const calc=summarizeFares(legs,network,passes,groupDate);
    const unchanged=calc.details.every(d=>d.additional===d.normal),covered=calc.details.length>0&&calc.details.every(d=>d.covered);
    const additional=covered?0:unchanged?g.normal:calc.additional;
    if(!covered&&!unchanged)estimated=true;
    return {from:legs[0].from,to:legs.at(-1).to,normal:g.normal,additional,covered};
  });
  const allUnchanged=details.every(d=>d.normal===d.additional);
  const additional=details.some(d=>d.additional===null)?null:allUnchanged?route.normal:details.reduce((n,d)=>n+d.additional,0);
  return {normal:route.normal,additional,details,estimated};
}
export function journeyHTML({routes,request,sort,openRoute,network,passes,updatedAt,notice}){
  const name=id=>network.stops.get(id)?.name??id,labels={fast:'早い',transfers:'乗換少',wait:'待ち少',walk:'歩き少'};
  if(!routes.length)return '<section class="card no-routes"><h2>条件に合う候補がありません</h2><p class="muted">Yahoo!から返された経路に、対象外の路線・種別や余裕の足りない乗換が含まれています。日時・列車種別・余裕時間を変更して再検索してください。</p><p class="fine">架空の時刻で補完はしません。</p></section>';
  const ordered=routes.map((r,index)=>({...r,index,fare:journeyFare(r,network,passes,request.date)})).sort((a,b)=>sort==='fast'?a.time-b.time:a[sort==='transfers'?'transfers':sort==='wait'?'wait':'walk']-b[sort==='transfers'?'transfers':sort==='wait'?'wait':'walk']||a.time-b.time);
  const timeline=r=>`<div class="timeline">${r.legs.map(l=>{
    let body;
    if(l.kind==='dwell')body=`<h3>${esc(name(l.from))}で下車・折り返し</h3><p>指定滞在 ${l.requestedMinutes}分${l.minutes>l.requestedMinutes?`／乗換余裕を含め ${l.minutes}分確保`:''}<br>${formatTime(l.arrive)}以降に次の区間へ。${l.exitGate?'改札を出る':'改札内で待つ'}設定。</p>`;
    else if(l.kind==='walk')body=`<h3>${esc(l.fromName)} → ${esc(l.toName)}</h3><p>徒歩 ${l.minutes}分（検索結果の記載）</p>`;
    else body=`<h3>${esc(name(l.from))}<small> → ${esc(name(l.to))}</small></h3><div class="timeline-service ${l.operator==='kintetsu'?'k':''}">${esc(l.label)}${l.through?'・直通（乗換不要）':''}</div><p>${esc(l.destination)}<br>${formatTime(l.arrive)}到着${l.through?'':`<br>出発${request.buffer}分前の ${formatTime(l.depart-request.buffer)}までに乗り場へ`}</p><div class="platform-note">${esc(l.platform??'番線・のりば：情報なし')}</div>${l.intermediate.length?`<details class="stop-list"><summary>途中の駅・停留所と時刻</summary>${l.intermediate.map(s=>`<div><span>${esc(s.name)}</span><time>${s.time===null?'記載なし':formatTime(s.time)}</time></div>`).join('')}</details>`:''}${l.operator==='citybus'?`<button class="plain" data-route-bus="${esc(l.from)}" data-route-number="${esc(l.route)}">この停留所の接近を確認</button>`:''}`;
    return `<div class="timeline-leg"><time class="timeline-time">${formatTime(l.depart)}</time><div class="timeline-rail ${l.operator==='kintetsu'?'k':l.kind==='walk'?'walk':''}"><i></i><span></span></div><div class="timeline-body">${body}</div></div>`;
  }).join('')}<div class="arrival-node"><time>${formatTime(r.time)}</time><i></i><b>${esc(name(request.to))}</b></div></div>`;
  return `<div class="results-title"><h2>検索結果</h2><small>${routes.length}案</small></div><div class="segmented">${Object.entries(labels).map(([v,l])=>`<button data-sort="${v}" class="${v===sort?'active':''}">${l}</button>`).join('')}</div>`+ordered.map((r,i)=>{
    const categories=[...new Set(r.legs.filter(l=>l.operator==='kintetsu').map(l=>l.category==='express'?'急行':'普通'))];
    return `<article class="card route-card ${r.index===openRoute?'open':''}"><button class="route-summary" data-open-route="${r.index}" aria-expanded="${r.index===openRoute}"><span class="route-chevron">⌄</span><div class="route-top"><span class="badge">${i===0?labels[sort]+'候補':`候補${i+1}`}</span>${categories.length?`<span class="badge neutral">近鉄 ${categories.join('＋')}</span>`:''}${request.via.length?'<span class="badge neutral">下車・折り返しあり</span>':''}</div><div class="route-times">${formatTime(r.start)}<span>→</span>${formatTime(r.time)}<small>${r.duration}分</small></div><div class="route-metrics"><span>追加 <b class="${r.fare.additional===0?'free':''}">${r.fare.additional===0?'0円（定期）':yen(r.fare.additional)}</b></span><span>通常 ${yen(r.fare.normal)}</span><span>乗換 <b>${r.transfers}</b>回</span><span>徒歩 ${r.walk}分・待ち等 ${r.wait}分</span></div><div class="route-path">${r.legs.filter(l=>l.kind==='ride').map(l=>`<span class="line-chip ${l.operator==='kintetsu'?'k':''}">${esc(l.label)}</span>`).join('<span>›</span>')}</div></button><div class="route-detail" ${r.index===openRoute?'':'hidden'}>${timeline(r)}<table class="fare-table"><thead><tr><th>運賃</th><th>通常</th><th>定期適用後</th></tr></thead><tbody>${r.fare.details.map(d=>`<tr><td>${esc(name(d.from))}〜${esc(name(d.to))}</td><td>${yen(d.normal)}</td><td>${d.covered?'0円（定期）':yen(d.additional)}</td></tr>`).join('')}<tr><td>合計</td><td>${yen(r.fare.normal)}</td><td>${yen(r.fare.additional)}</td></tr></tbody></table><p class="fine">通常運賃：Yahoo!の検索結果。${r.fare.estimated?'定期区間外の追加額は距離による目安です。':''}折り返し・途中下車は区間ごとの片道運賃を合算した目安です。徒歩は明記された区間のみ、待ち等には構内移動も含みます。</p><div class="route-actions"><button class="secondary" data-save-query>検索を保存</button><button class="secondary" data-copy-route="${r.index}">経路をコピー</button></div></div></article>`;
  }).join('')+`<p class="fine">データ：Yahoo!乗換案内／取得 ${esc(new Date(updatedAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}))}<br>${esc(notice)}</p>`;
}
export function busHTML(s){
  const busIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="16" rx="3"/><path d="M4 10h16M12 3v7M7 19v2m10-2v2M7 14h.1M17 14h.1"/></svg>';
  const visual=`<div class="bus-strip" aria-label="バスの接近位置。右が乗車停留所"><div class="bus-strip-track"></div>${[6,5,4,3,2,1,0].map(n=>`<div class="bus-stop-mark ${n===0?'you-are-here':''}"><div class="bus-markers">${s.buses.filter(b=>b.stopsAway===n).map(b=>`<span class="bus-marker" title="${n}停留所前・${esc(b.congestion??'混雑情報なし')}">${busIcon}</span>`).join('')}</div><i></i><span>${n===0?'乗る':'−'+n}</span></div>`).join('')}</div>`;
  return `<div class="bus-native"><div class="report-meta"><span class="badge" data-freshness="${esc(s.capturedAt)}">${esc(freshness(s.capturedAt))}</span><time>${esc(new Date(s.capturedAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}))}取得</time></div><div class="bus-heading"><span class="bus-number">${esc(s.route)}</span><div><b>${esc(s.destination)}</b><small>${esc(s.boarding)}・${esc(s.stop)}</small></div></div>${visual}${s.buses.length?s.buses.map((b,i)=>`<div class="bus-approach"><span class="bus-order">${i+1}台目</span><div><strong>${b.stopsAway}<small>停留所前</small></strong><span>${esc(b.congestion??'混雑情報なし')}</span></div><p>バスのマークは取得時点の位置です。停留所の数から到着分数は推定しません。</p></div>`).join(''):`<div class="bus-empty">${esc(s.message)}</div>`}<p class="fine">ポケロケ plus+の接近表から取得。保存情報は時間が経つと古くなります。</p></div>`;
}
