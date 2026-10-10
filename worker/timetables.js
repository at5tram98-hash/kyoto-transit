import {load} from 'cheerio/slim';
import catalog from '../public/data/bus-catalog.json' with {type:'json'};
import {createNetwork,normalize,kintetsuIds} from '../public/js/network.js';
import {calendarDay,CALENDAR_SOURCE} from './service-calendar.js';

const network=createNetwork(catalog);
const CITY='https://www2.city.kyoto.lg.jp/kotsu/';
const KINTETSU='https://eki.kintetsu.co.jp/norikae/';
const KYOTO='https://www.kyotobus.jp';
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
export const timeNumber=s=>{const m=String(s??'').normalize('NFKC').match(/^(\d{1,2}):(\d{2})$/);return m&&+m[1]<48&&+m[2]<60?+m[1]*60+(+m[2]):null;};
export function officialFetcher(env){return async(url,init)=>{
  const u=new URL(url),render=u.origin===KYOTO||u.origin==='https://www2.city.kyoto.lg.jp'&&/\/hyperdia\/\d+\.htm$/.test(u.pathname);
  if(!render)return fetch(url,init);
  const r=await env.BROWSER.quickAction('content',{url:u.href,gotoOptions:{waitUntil:'networkidle2',timeout:20000},actionTimeout:12000});
  if(!r.ok){await r.body?.cancel();throw Error('公式時刻表の画面を取得できませんでした。');}
  let html=await r.text();if(html.length>6*1024*1024)throw Error('公式画面のデータが大きすぎます。');
  if(r.headers.get('content-type')?.includes('json')){const d=JSON.parse(html);html=typeof d.result==='string'?d.result:typeof d.content==='string'?d.content:'';}
  if(!html)throw Error('公式の画面データがありません。');
  if(u.pathname.endsWith('.json')){const raw=load(html)('pre').first().text();JSON.parse(raw);return new Response(raw,{headers:{'Content-Type':'application/json;charset=utf-8'}});}
  return new Response(html,{headers:{'Content-Type':'text/html;charset=utf-8'}});
};}
export function jsonConstant(html,key){
  const start=html.indexOf(`const ${key} =`);if(start<0)return null;
  let i=html.indexOf('{',start),depth=0,string=false,escaped=false;
  if(i<0)return null;const begin=i;
  for(;i<html.length;i++){const c=html[i];if(string){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')string=false;}else if(c==='"')string=true;else if(c==='{')depth++;else if(c==='}'&&!--depth)return JSON.parse(html.slice(begin,i+1));}
  throw Error('公式の時刻データを読み取れませんでした。');
}
export async function officialText(url,fetcher=fetch,ttl=900){
  const cache=typeof caches!=='undefined'?caches.default:null;
  const cacheURL=new URL(url);cacheURL.searchParams.set('_my_map_reader','2');const cacheKey=new Request(cacheURL);const saved=cache?await cache.match(cacheKey):null;
  const r=saved??await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(18000),headers:{Accept:'text/html,application/json','User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'}});
  if(!r.ok){await r.body?.cancel();throw Error(`公式時刻表を取得できません（HTTP ${r.status}）。`);}
  const reader=r.body?.getReader();if(!reader)return '';
  const parts=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>6*1024*1024){await reader.cancel();throw Error('時刻表データが大きすぎます。');}parts.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  if(cache&&!saved){const headers=new Headers(r.headers);headers.set('Cache-Control',`public,max-age=${ttl}`);headers.delete('Set-Cookie');await cache.put(cacheKey,new Response(bytes,{headers}));}
  const header=r.headers.get('content-type')??'',prefix=new TextDecoder().decode(bytes.subarray(0,2000));
  const charset=header.match(/charset\s*=\s*([^; ]+)/i)?.[1]??prefix.match(/charset\s*=\s*["']?([^"'; >]+)/i)?.[1]??'utf-8';
  return new TextDecoder(/shift[_-]?jis|windows-31j/i.test(charset)?'shift_jis':'utf-8').decode(bytes);
}
export function parseHyperdia(html){
  const $=load(html),days={};
  for(const [key,selector]of [['weekday','#wek'],['saturday','#sat'],['holiday','#kyu']]){
    const entries=[];$(selector+' [data-tt-time]').each((_,e)=>{
      const row=$(e),raw=row.attr('data-tt-time');if(!/^\d{4}$/.test(raw))return;
      const depart=+raw.slice(0,2)*60+(+raw.slice(2));if(depart>1500||+raw.slice(2)>59)throw Error('公式時刻表の時刻が不正です。');
      const dest=row.find('.data-tt-dest').text(),kind=/急行/.test(dest)?'express':'local';
      entries.push({depart,category:kind,destination:clean(dest).replace(/^(普通|急行)\s*/,''),note:clean(row.find('.data-tt-note').text())});
    });
    if(!entries.length){
      const rows=key==='weekday'?'.wektime':key==='saturday'?'.sattime,.doytime':'.holtime,.kyutime';
      $(rows).each((_,e)=>{const row=$(e),hour=Number(clean(row.find('h3').first().text()));if(!Number.isInteger(hour)||hour<0||hour>24)return;
        row.find('td.timetable span[data-no]').each((_,a)=>{const min=clean($(a).text());if(!/^\d{1,2}$/.test(min)||+min>59)return;entries.push({depart:hour*60+(+min),category:null,destination:null,note:clean($(a).attr('title'))});});
      });
    }
    if(entries.length)days[key]=entries;
  }
  if(!days.saturday&&days.holiday)days.saturday=days.holiday;
  if(!Object.keys(days).length)throw Error('公式の時刻表を読み取れませんでした。');
  const title=clean($('h1').first().text()),platform=clean($('.tt-platform-num').first().text())||null;
  return {title,platform,days,effective:clean($.text()).match(/(?:令和\d+|\d{4})年\s*\d{1,2}月\s*\d{1,2}日現在/)?.[0]??null};
}
export function parseKintetsuBoard(html,sourceURL){
  const $=load(html),entries=[];
  $('tr').each((_,e)=>{const cells=$(e).children('td'),hour=clean(cells.first().text());if(!/^\d{1,2}$/.test(hour)||+hour>24)return;
    cells.eq(1).find('a[href*="T7?"]').each((_,a)=>{
      const node=$(a),min=clean(node.find('.min').text())||clean(node.text()).match(/(?:^|\s)(\d{1,2})(?:\s|$)/)?.[1];if(!/^\d{1,2}$/.test(min)||+min>59)return;
      const classes=node.find('[class^="K_"]').first().attr('class')??'',raw=clean(node.clone().find('.min').remove().end().text()),dest=raw.replace(new RegExp(`(?:^|\\s)${min}(?:\\s|$)`),' '),tripURL=new URL(node.attr('href'),sourceURL).href;
      const destination=dest.replace(/^京/,'京都').replace(/^国/,'国際会館').replace(/^田/,'新田辺');
      const category=classes.includes('1903')?'express':classes.includes('1901')?'local':/急行/.test(raw)?'express':/普通/.test(raw)?'local':'other';
      entries.push({depart:(+hour||24)*60+(+min),category,destination,tripURL,tripId:new URL(tripURL).searchParams.get('tx')});
    });
  });
  if(!entries.length)throw Error('近鉄の公式発車便を読み取れませんでした。');
  return {title:clean($('b').filter((_,e)=>$(e).text().includes('駅')).first().text()).replace(/^■\s*/,''),entries,legend:clean($('.remarks').first().text()),effective:clean($.text()).match(/\d{4}年\d{1,2}月\d{1,2}日現在/)?.[0]??null};
}
export function parseKintetsuTrip(html,sourceURL){
  const $=load(html),stops=[];let title='';
  $('tr').each((_,e)=>{const cells=$(e).children('td');if(cells.length===1&&/行き（始発駅/.test(cells.text()))title=clean(cells.text());
    if(cells.length!==3||!cells.eq(0).find('a[href*="/norikae/T"]').length)return;
    const arrival=timeNumber(clean(cells.eq(1).text())),departure=timeNumber(clean(cells.eq(2).text())),name=clean(cells.eq(0).text());if(!name||(arrival===null&&departure===null))return;
    let a=arrival,d=departure;const prev=stops.at(-1)?.departure??stops.at(-1)?.arrival??0;if(a!==null)while(a<prev)a+=1440;if(d!==null)while(d<(a??prev))d+=1440;stops.push({name,arrival:a,departure:d});
  });
  if(!title||stops.length<2)throw Error('近鉄の停車駅・時刻を読み取れませんでした。');
  return {title,tripId:new URL(sourceURL).searchParams.get('tx'),destination:title.match(/\s+(.+?)行き（/)?.[1]??stops.at(-1).name,category:/^急行/.test(title)?'express':/^普通/.test(title)?'local':'other',stops,sourceURL};
}
function safeKyotoAsset(path,stopId,file){const u=new URL(path,KYOTO);if(u.origin!==KYOTO||!new RegExp(`^/assets/json/${stopId}/[a-z_]+/\\d{8}/${file}\\.json$`).test(u.pathname)||u.search)throw Error('公式データの取得先が変わりました。');return u.href;}
export function parseKyotoSchedules(html){const boot=jsonConstant(html,'SCHEDULE_BOOT'),urls=jsonConstant(html,'FARE_URLS');if(!boot)throw Error('京都バスの公式時刻表を読み取れませんでした。');return {boot,urls};}
export function kyotoEntries(schedule){const days={};for(const [day,data]of Object.entries(schedule.timetable??{})){days[day]=Object.values(data.hour??{}).flat().filter(e=>/^(?:特|直行)?40$|^臨時/.test(String(e.route_short_name).normalize('NFKC'))).map(e=>({depart:timeNumber(e.departure_time),route:String(e.route_short_name).normalize('NFKC'),tripId:e.trip_id,routeId:e.route_id,destination:e.stop_headsign})).filter(e=>e.depart!==null).sort((a,b)=>a.depart-b.depart);}return days;}
export function parseCityCatalog(html,sourceURL){const $=load(html);return $('h2[id^="bs"]').map((_,e)=>({name:clean($(e).text()),officialId:$(e).attr('id').slice(2),boards:$(e).closest('.panel').find('a[href*="hyperdia/"]').map((_,a)=>({label:clean($(a).text()),sourceURL:new URL($(a).attr('href'),sourceURL).href})).get()})).get();}
export async function timetableOptions(id,fetcher=fetch){
  const stop=network.stops.get(id);if(!stop)throw Error('対応する駅・停留所を選んでください。');
  if(stop.type==='subway')return {stop:id,name:stop.name,boards:[...(id==='K01'?[]:[{key:'north',label:'国際会館方面',sourceURL:`${CITY}tikadia/hyperdia/02${String(+id.slice(1)+10).padStart(2,'0')}01.htm`}]),...(id==='K15'?[{key:'south',label:'新田辺・近鉄奈良方面',sourceURL:`${CITY}tikadia/hyperdia/022500.htm`}]:[{key:'south',label:'京都・竹田・近鉄奈良方面',sourceURL:`${CITY}tikadia/hyperdia/02${String(+id.slice(1)+10).padStart(2,'0')}00.htm`}])],operator:'subway'};
  if(stop.type==='kintetsu'){
    const index=kintetsuIds.indexOf(id);if(index>25)throw Error('奈良線の公式方面選択はまだ確認できていません。');
    if(id==='B01')return {stop:id,name:stop.name,operator:'kintetsu',boards:[{key:'south',label:'近鉄奈良・橿原神宮前方面',sourceURL:`${KINTETSU}T5?USR=PC&slCode=360-0&d=1&dw=0&pattern=A`}]};
    return {stop:id,name:stop.name,operator:'kintetsu',boards:[{key:'north',label:'京都・国際会館方面',sourceURL:`${KINTETSU}T5?USR=PC&slCode=360-${index}&d=1&dw=0&pattern=A`},{key:'south',label:'近鉄奈良・橿原神宮前方面',sourceURL:`${KINTETSU}T5?USR=PC&slCode=360-${index}&d=2&dw=0&pattern=A`}]};
  }
  if(stop.type==='citybus'){
    const rows=await Promise.all(stop.lines.map(async route=>parseCityCatalog(await officialText(catalog[route].source,fetcher),catalog[route].source).find(s=>normalize(s.name)===normalize(stop.fullName??stop.name))));
    const boards=[];rows.forEach((r,i)=>r?.boards.forEach(b=>{const old=boards.find(o=>o.sourceURL===b.sourceURL);if(old)old.routes.push(stop.lines[i]);else boards.push({...b,key:String(boards.length),routes:[stop.lines[i]]});}));
    if(!boards.length)throw Error('公式の停留所時刻表が見つかりませんでした。');return {stop:id,name:stop.name,operator:'citybus',boards};
  }
  const sid=stop.officialId;if(!sid)throw Error('京都バスの公式停留所IDは未取得です。');
  const sourceURL=`${KYOTO}/route/timetable/stop.html?stop_id=${sid}`,$=load(await officialText(sourceURL,fetcher));
  const boards=[];$('a.busStop_platform_towards_list_item[href*="schedule.html?"]').each((_,a)=>{const node=$(a),route=clean(node.find('.busStop_platform_towards_list_item_route_label').text()).normalize('NFKC');if(!/^(?:特|直行)?40$|^臨時/.test(route))return;const u=new URL(node.attr('href'),KYOTO);if(!boards.some(b=>b.sourceURL===u.href)&&u.origin===KYOTO)boards.push({key:u.searchParams.get('stop_id'),sourceURL:u.href,label:clean(node.text()),routes:[route]});});
  if(!boards.length)throw Error('京都バスの乗り場を読み取れませんでした。');return {stop:id,name:stop.name,operator:'kyotobus',boards};
}
export async function readTimetable(id,key,day,fetcher=fetch,date=null){
  if(day==='auto'){const stop=network.stops.get(id);day=calendarDay(date,stop?.type);if(!day)throw Error('この日の公式運行カレンダーは未確認です。曜日の種類を指定してください。');}
  if(!['weekday','saturday','holiday','weekday_a','weekday_b','wednesday_a'].includes(day))throw Error('曜日を選んでください。');
  const options=await timetableOptions(id,fetcher),board=options.boards.find(b=>b.key===key);if(!board)throw Error('方面を選んでください。');
  let sourceURL=board.sourceURL,data;
  if(options.operator==='kintetsu'){const u=new URL(sourceURL);u.searchParams.set('dw',day==='weekday'?'0':'1');sourceURL=u.href;data=parseKintetsuBoard(await officialText(sourceURL,fetcher),sourceURL);}
  else if(options.operator==='kyotobus'){
    const html=await officialText(sourceURL,fetcher),{boot,urls}=parseKyotoSchedules(html),schedule=boot.master_current??Object.values(boot)[0];
    const days=kyotoEntries(schedule),selected=day==='holiday'?'sunday':day==='weekday'?(days.weekday?'weekday':null):day;
    data={title:schedule.stop_name,days,entries:days[selected]??[],dayRequired:!selected,dayKeys:Object.keys(days),effective:schedule.start_date,stopId:schedule.stop_id,fareURL:urls?.master_current?safeKyotoAsset(urls.master_current,schedule.stop_id,'fare'):null};
  }else {data=parseHyperdia(await officialText(sourceURL,fetcher));data.entries=data.days[day]??[];}
  return {kind:'timetable',...options,boards:undefined,...board,...data,day,date,calendarSource:options.operator==='kyotobus'?CALENDAR_SOURCE:null,sourceURL,fetchedAt:new Date().toISOString()};
}
export async function readOfficialTrip(id,key,day,tripId,fetcher=fetch){
  const board=await readTimetable(id,key,day,fetcher),entry=board.entries.find(e=>e.tripId===tripId);if(!entry)throw Error('指定の便は公式時刻表で確認できませんでした。');
  if(board.operator==='kintetsu')return {...parseKintetsuTrip(await officialText(entry.tripURL,fetcher),entry.tripURL),operator:'kintetsu',fetchedAt:board.fetchedAt};
  if(board.operator!=='kyotobus'||!board.fareURL)throw Error('この便の終点までの公式時刻は未取得です。');
  const raw=JSON.parse(await officialText(board.fareURL,fetcher));if(!Array.isArray(raw))throw Error('京都バスの便詳細の形式が変わりました。');
  const trip=raw.find(r=>String(r.route_id)===String(entry.routeId))?.departures?.find(t=>t.trip_id===tripId&&timeNumber(t.departure_time)===entry.depart);
  if(!trip?.stops?.length)throw Error('京都バスの停留所時刻が見つかりませんでした。');
  return {operator:'kyotobus',tripId,category:'local',route:entry.route,destination:entry.destination,title:`京都バス ${entry.route} ${entry.destination}行き`,stops:[{name:board.name,departure:entry.depart},...trip.stops.map(s=>({name:s.stop_name,officialId:s.stop_id,arrival:timeNumber(s.arrival_time),departure:timeNumber(s.departure_time),normalFare:s.fare_yen}))],sourceURL:board.sourceURL,fetchedAt:board.fetchedAt};
}
