import {officialData,dayLabel} from './timetable-ui.js';
import {timedStops} from './mobility.js';
import {subwayIds,kintetsuIds} from './network.js';
import {formatTime} from './router.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountFoldback({network,now,openMeeting}){
  const sheet=document.createElement('dialog');sheet.className='sheet';sheet.innerHTML='<div class="sheet-handle"></div><div class="sheet-heading"><h2>折り返し乗車</h2><button class="plain" data-foldback-close>完了</button></div><div class="foldback-options"></div>';document.body.append(sheet);let leg,delay=0,job=0;
  const content=sheet.querySelector('.foldback-options');
  function open(value,shift=0){leg=value;delay=shift;job++;content.innerHTML=`<p class="muted">逆方向の列車へ乗り換えます。</p><button class="native-row" data-foldback-station><span class="system-symbol subway">↩</span><span><b>降りる駅を選んで折り返し</b><small>次の逆方向の列車と乗換余裕を確認</small></span><span class="chev">›</span></button><button class="native-row" data-foldback-friend><span class="system-symbol rail">⇄</span><span><b>指定の列車に折り返し</b><small>友達の列車との最大合流地点を検索</small></span><span class="chev">›</span></button>`;sheet.showModal();}
  function station(){const n=now(),m=+n.time.slice(0,2)*60+(+n.time.slice(3)),points=timedStops(leg,network).filter(p=>p.id&&p.time+delay>=m);
    content.innerHTML=`<label class="block-label">降りる駅<select id="foldback-station">${points.map(p=>`<option value="${p.id}">${esc(p.name)} ${formatTime(Math.round(p.time+delay))}着予定</option>`).join('')}</select></label><div class="option-grid"><label>乗換に必要な時間<input id="foldback-buffer" type="number" min="1" max="30" value="3"></label><label>折り返しで待つ時間<input id="foldback-wait" type="number" min="0" max="180" value="0"></label></div><button class="primary" data-foldback-search ${points.length?'':'disabled'}>逆方向の便を調べる</button><div id="foldback-result" aria-live="polite"></div>`;
  }
  async function search(){const id=sheet.querySelector('#foldback-station').value,buffer=+sheet.querySelector('#foldback-buffer').value,wait=+sheet.querySelector('#foldback-wait').value,result=sheet.querySelector('#foldback-result'),current=++job;
    if(!Number.isInteger(buffer)||buffer<1||buffer>30||!Number.isInteger(wait)||wait<0||wait>180){result.textContent='乗換時間は1〜30分、待つ時間は0〜180分で入力してください。';return;}
    const points=timedStops(leg,network),point=points.find(p=>p.id===id),ids=network.stops.get(id).type==='subway'?subwayIds:kintetsuIds;let direction=leg.officialTrip?.direction;
    if(!['north','south'].includes(direction)){const a=ids.indexOf(leg.from),b=ids.indexOf(leg.to);direction=a>=0&&b>=0&&a!==b?(b>a?'south':'north'):null;}
    result.innerHTML='<p class="loading-note">逆方向の公式時刻を取得中…</p>';
    try{if(!direction)throw Error('この区間の進行方向を確定できませんでした。');const options=await officialData('/timetable/options',{stop:id}),reverse=options.boards.find(b=>b.key===(direction==='north'?'south':'north'));if(!reverse)throw Error('逆方向の公式時刻表を確認できませんでした。');
      const board=await officialData('/timetable',{stop:id,direction:reverse.key,day:'auto',date:now().date});if(current!==job)return;const required=Math.max(buffer,wait),arrival=point.time+delay,entries=board.entries.filter(e=>e.depart>=arrival+required).slice(0,3);
      result.innerHTML=`<p class="source-caption">${esc(point.name)} ${formatTime(Math.round(arrival))}着予定 · ${esc(dayLabel[board.day])}</p>${entries.length?entries.map(e=>`<article class="operation-card"><h3>${formatTime(e.depart)}発 · ${esc(e.destination)}</h3><p>折り返し待ち ${Math.floor(e.depart-arrival)}分<br>必要な余裕 ${required}分 · 残り ${Math.floor(e.depart-arrival-required)}分</p><small>逆方向の便の遅延は未照合 · 公式時刻表の予定</small></article>`).join(''):'<p class="empty-note">余裕を確保できる便がありません。</p>'}<p class="source-caption">${delay?'現在の便の補正 '+delay+'分を反映。':''}番線間の移動時間は、指定した乗換時間を使います。</p>`;
    }catch(e){if(current===job)result.innerHTML=`<p class="empty-note">${esc(e.message)}</p>`;}
  }
  sheet.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-foldback-close')){job++;sheet.close();}else if(b.hasAttribute('data-foldback-station'))station();else if(b.hasAttribute('data-foldback-friend')){sheet.close();openMeeting();}else if(b.hasAttribute('data-foldback-search'))search();});sheet.addEventListener('close',()=>job++);return {open};
}
