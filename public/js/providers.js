export const LINKS={
  pockloc:'https://kyotocity.bus-navigation.jp/',
  kintetsuStatus:'https://www.kintetsu.jp/unkou/',
  kintetsuSearch:'https://www.kintetsu.co.jp/railway/Dia/dia.html',
  kintetsuFare:'https://www.kintetsu.co.jp/gyoumu/kippu/eigyoukirotei.html',
  kyotobus:'https://www.kyotobus.jp/route/timetable/schedule.html?stop_id=91_3',
  subway:'https://www2.city.kyoto.lg.jp/kotsu/tikadia/hyperdia/line02.htm',
  bus:'https://www2.city.kyoto.lg.jp/kotsu/busdia/keitou/keitou.htm'
};
export function yahooURL(request,network,from=request.from,to=request.to,start=request.start,via=request.via){
  const stop=id=>{const s=network.stops.get(id);return s?.name??'';};
  const [y,m,d]=request.date.split('-');
  const minute=Math.round(start)%1440;
  const p=new URLSearchParams({from:stop(from),to:stop(to),y,m,d,hh:String(Math.floor(minute/60)),m1:String(Math.floor(minute%60/10)),m2:String(minute%10),type:'1',ticket:'ic',expkind:'1',ws:'3'});
  (via??[]).slice(0,3).forEach((v,i)=>p.set(`via${i+1}`,stop(v.stop)));
  return `https://transit.yahoo.co.jp/search/result?${p}`;
}
export function departureAfterDwell(arrival,dwell){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(arrival)||!Number.isFinite(dwell)||dwell<0||dwell>180)throw Error('到着日時と滞在時間を確認してください。');
  const instant=Date.parse(`${arrival}:00+09:00`);
  if(!Number.isFinite(instant))throw Error('到着日時を確認してください。');
  // 日本時刻をUTC表現の文字列に移し、端末のタイムゾーンに依存させない。
  const local=new Date(instant+(dwell+540)*60000).toISOString();
  return {date:local.slice(0,10),start:Number(local.slice(11,13))*60+Number(local.slice(14,16))};
}
export function validateFeed(data){
  const fail=message=>{throw new Error(message);};
  if(data?.schemaVersion!==1||!Array.isArray(data.stops)||!Array.isArray(data.services)||!Array.isArray(data.validDates))fail('対応形式の時刻データではありません。');
  if(data.stops.length>5000||data.services.length>3000||data.validDates.length>400)fail('データが大きすぎます。対象路線に絞ってください。');
  if(typeof data.source!=='string'||!data.source.trim()||data.source.length>500)fail('データの出典を記入してください。');
  if(!data.validDates.every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)))fail('対象日が正しくありません。');
  const ids=new Set();
  for(const s of data.stops){if(typeof s.id!=='string'||typeof s.name!=='string'||!s.name||s.name.length>120||ids.has(s.id))fail('駅・停留所データが正しくありません。');ids.add(s.id);}
  let tripCount=0;
  for(const s of data.services){
    if(typeof s.id!=='string'||!['subway','kintetsu','through','citybus','kyotobus'].includes(s.operator)||!['local','express'].includes(s.category)||typeof s.label!=='string')fail('路線データが正しくありません。');
    if(!Array.isArray(s.stops)||s.stops.length<2||s.stops.length>200||!s.stops.every(id=>ids.has(id))||!Array.isArray(s.trips)||s.trips.length===0)fail('停車駅または時刻の対応が正しくありません。');
    if(s.platforms&&(!Array.isArray(s.platforms)||s.platforms.length!==s.stops.length||s.platforms.some(x=>x!==null&&typeof x!=='string')))fail('番線データが正しくありません。');
    for(const t of s.trips){
      if(++tripCount>150000)fail('便数が多すぎます。');
      if(typeof t.id!=='string'||!data.validDates.includes(t.date)||!Array.isArray(t.arrivals)||!Array.isArray(t.departures)||t.arrivals.length!==s.stops.length||t.departures.length!==s.stops.length)fail('便の形式が正しくありません。');
      for(let i=0;i<t.arrivals.length;i++)if(!Number.isFinite(t.arrivals[i])||!Number.isFinite(t.departures[i])||t.arrivals[i]<0||t.departures[i]>2880||t.arrivals[i]>t.departures[i]||(i>0&&t.arrivals[i]<t.departures[i-1]))fail('時刻の並びが正しくありません。');
    }
  }
  return data;
}
export function applyFeed(base,data){
  validateFeed(data);
  const stops=new Map(data.stops.map(s=>[s.id,{...base.stops.get(s.id),...s,aliases:s.aliases??[],lines:s.lines??[]} ]));
  const walks=(data.walks??[]).filter(w=>stops.has(w.from)&&stops.has(w.to)&&Number.isFinite(w.minutes)&&w.minutes>0&&w.minutes<=30);
  return {...base,stops,services:data.services,walks,mode:'timetable',source:data.source,validDates:data.validDates};
}
