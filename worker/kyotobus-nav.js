import {load} from 'cheerio/slim';

// 京都バス公式「京都バスナビ」の区間接近一覧（bus.htm）。乗車停留所と降車停留所を
// 指定すると、便ごとに公式の予定時刻・発車予測・到着予測・混雑・通過停留所数を返す。
const NAV='https://kyotobus.bus-navigation.jp/wgsys/wgs/bus.htm';
const FORM_KEYS=['selectedLandmarkCatCd','fromlat','fromlng','tolat','tolng','fromSignpoleKey','routeLayoutCd','fromBusStopCd','toBusStopCd','routeKey','nextDiagramFlag','diaRevisedDate','timeTableDirevtionCd','searchDate','searchTime','fromBusStopKey','toBusStopKey','tramSearchFlg'];
// Kyoto Bus stops the app serves. The navigation resolves these short names.
export const KYOTOBUS_NAV_STOPS=new Set(['国際会館駅前','京都産業大学前','烏丸丸太町','千本丸太町']);

const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const minuteOf=value=>{const m=clean(value).match(/(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null;};
const congestionOf=src=>/bus_red/.test(src)?'たいへん混雑しています':/bus_yellow/.test(src)?'混雑しています':/bus_blue/.test(src)?'通常の状態です':null;

export function kyotoBusNavURL(from,to){
  const p=new URLSearchParams({tabName:'searchTab',from,fromType:'1',to,toType:'1',locale:'ja',bsid:'1',mapFlag:'false',existYn:'N'});
  for(const key of FORM_KEYS)p.set(key,'');
  return `${NAV}?${p}`;
}

function timesAfter($,box,label){
  // 「発／着」の行の次の行に「予定時刻 HH:MM」「発車予測／到着予測 HH:MM」が並ぶ。
  const marker=box.find(`span.${label}`).closest('tr'),row=marker.next('tr'),cells=row.children('td');
  return {stop:clean(marker.text()).replace(/^[発着]\s*/,''),scheduled:minuteOf(cells.eq(0).text()),predicted:minuteOf(cells.eq(1).text())};
}

export function parseKyotoBusNav(html){
  const $=load(html),message=clean($('#errInfo').text())||null,buses=[];
  $('#buslist .route_box').each((index,element)=>{
    const box=$(element),rows=box.find('table').first().children('tbody').length?box.find('table').first().children('tbody').children('tr'):box.find('table').first().children('tr');
    const route=clean(box.find('font[color="blue"]').first().text());
    const via=clean(rows.eq(1).text()).replace(/\s*経由$/,'')||null;
    const destination=clean(rows.eq(2).text()).replace(/\s*行き$/,'')||null;
    const departure=timesAfter($,box,'label_custom_dep'),arrival=timesAfter($,box,'label_custom_arr');
    const wait=clean(box.text()).match(/約\s*(\d{1,3})\s*分で発車/),duration=clean(box.text()).match(/所要時間[:：]\s*(\d{1,3})\s*分/);
    const detail=$(`#detailPopUp_${index}`),passed=clean(detail.find('.bus_status').text()).match(/(\d{1,2})\s*個前の停留所を通過/);
    const platform=clean(detail.find('.departure_info').first().text()).replace(/^のりば-?/,'').replace(/^[(（](.*)[)）]$/,'$1')||null;
    if(!route||!Number.isFinite(departure.scheduled))throw Error('京都バスナビの便情報を読み取れません。');
    buses.push({
      route,via,destination,
      congestion:congestionOf(box.find('img[src*="bus_"]').first().attr('src')??''),
      departure,arrival,
      minutesToDeparture:wait?Number(wait[1]):null,
      duration:duration?Number(duration[1]):null,
      stopsAway:passed?Number(passed[1]):null,
      platform
    });
  });
  if(!buses.length&&!message)throw Error('京都バスナビの接近一覧を読み取れません。');
  if(message&&/経路が見つかりません/.test(message))throw Error('京都バスナビで区間を確認できませんでした。');
  return {buses,message:buses.length?null:message};
}

export async function fetchKyotoBusNav(from,to,{fetcher=fetch,timeout=8000}={}){
  if(!KYOTOBUS_NAV_STOPS.has(from)||!KYOTOBUS_NAV_STOPS.has(to)||from===to)throw Error('京都バスの対象区間を選択してください。');
  const url=kyotoBusNavURL(from,to),response=await fetcher(url,{headers:{'User-Agent':'Mozilla/5.0 My Map transit reader','Accept':'text/html'},signal:AbortSignal.timeout(timeout),cache:'no-store'});
  if(!response.ok){await response.body?.cancel?.();throw Error(`京都バスナビ HTTP ${response.status}`);}
  const text=await response.text();if(text.length>2_000_000)throw Error('京都バスナビのページが大きすぎます。');
  return {kind:'kyotobus-approach',from,to,capturedAt:new Date().toISOString(),sourceURL:url,...parseKyotoBusNav(text)};
}
