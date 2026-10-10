import {load} from 'cheerio/slim';
const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
function parseText(text){
  const words=clean(text),stops=words.match(/([1-6])\s*(?:(?:停留所|つ|個)\s*)?(?:まえ|前)/),mins=words.match(/(?:あと|約)?\s*(\d{1,2})\s*分/),congestion=words.match(/空席あり|やや混雑|混雑|満員/)?.[0]??null;
  if(!stops&&!mins)return null;return {stopsAway:stops?Number(stops[1]):null,minutes:mins?Number(mins[1]):null,congestion,text:words};
}
function uniqueBuses(rows){const seen=new Set(),out=[];for(const row of rows){if(!row)continue;const key=`${row.stopsAway??''}|${row.minutes??''}|${row.congestion??''}`;if(seen.has(key))continue;seen.add(key);out.push(row);}return out.sort((a,b)=>(a.minutes??a.stopsAway??99)-(b.minutes??b.stopsAway??99));}
export function parseApproach(html){
  const $=load(html),rows=[];
  const selectors=['#approach_table [id^="vehicle-position-data_"]','[id^="vehicle-position-data_"]','[data-vehicle-position]','.vehicle-position','.approach-vehicle','.vehicle-info','.approach-info','.approachGuidance'];
  for(const selector of selectors)$(selector).each((_,e)=>{const cell=$(e),text=[cell.text(),...cell.find('img[alt]').map((_,img)=>$(img).attr('alt')).get()].join(' '),parsed=parseText(text);if(parsed)rows.push(parsed);});
  let buses=uniqueBuses(rows);
  const body=clean($('body').text()),noBus=/(?:6\s*停留所以内|接近(?:している)?バス)[^。]{0,35}(?:ありません|いません|なし)/.test(body)||/現在[^。]{0,35}接近[^。]{0,35}(?:ありません|いません)/.test(body);
  if(!buses.length&&!noBus){
    const fallback=[];for(const match of body.matchAll(/(?:あと|約)?\s*\d{1,2}\s*分|[1-6]\s*(?:(?:停留所|つ|個)\s*)?(?:まえ|前)/g)){const from=Math.max(0,match.index-45),to=Math.min(body.length,match.index+match[0].length+45),parsed=parseText(body.slice(from,to));if(parsed)fallback.push(parsed);}buses=uniqueBuses(fallback);
  }
  if(!buses.length&&!noBus)throw Error('接近情報の読み込みが完了していません。');
  return {buses,noBus,message:noBus?'現在、6停留所以内に接近しているバスはありません。':null};
}
