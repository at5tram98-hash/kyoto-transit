export function layoutChanged(source,message){const e=Error(message);e.code='layout_changed';e.source=source;return e;}
export function requireRows(source,rows,message){if(!Array.isArray(rows)||rows.length===0)throw layoutChanged(source,message);return rows;}
export function shouldExpectRail(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hour12:false}).format(now).split(':').map(Number),minute=parts[0]*60+parts[1];
  return minute>=5*60&&minute<=24*60-5;
}
export function fallbackDiagnostic(error,key,now=Date.now()){return {code:error?.code??'fetch_failed',source:error?.source??key,message:String(error?.message??'データ取得に失敗しました。').slice(0,240),at:new Date(now).toISOString()};}
