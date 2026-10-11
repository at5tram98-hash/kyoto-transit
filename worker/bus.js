import {load} from 'cheerio/slim';

const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const routeAlt=value=>{const text=clean(value);return /^\d{1,3}$/.test(text)?String(Number(text)):null;};

function congestionFromText(words){
  return words.match(/大変混雑しています|たいへん混雑(?:しています)?|混雑しています|ゆったり立てます|ゆったり立てる|空席があります|空席あり|満員|やや混雑|混雑/)?.[0]??null;
}
function parseText(text){
  const words=clean(text),stops=words.match(/([1-6])\s*(?:(?:停留所|つ|個)\s*)?(?:まえ|前)/),mins=words.match(/(?:あと|約)?\s*(\d{1,2})\s*分/),congestion=congestionFromText(words);
  if(!stops&&!mins)return null;
  return {stopsAway:stops?Number(stops[1]):null,minutes:mins?Number(mins[1]):null,congestion,text:words};
}
function uniqueBuses(rows){
  const seen=new Set(),out=[];
  for(const row of rows){
    if(!row)continue;
    const key=`${row.stopsAway??''}|${row.minutes??''}|${row.congestion??''}`;
    if(seen.has(key))continue;
    seen.add(key);out.push(row);
  }
  return out.sort((a,b)=>(a.minutes??a.stopsAway??99)-(b.minutes??b.stopsAway??99));
}
function busesFromRow($,row){
  const buses=[];
  $(row).find('[id^="vehicle-position-data_"]').each((_,cell)=>{
    const el=$(cell),text=[el.text(),...el.find('img[alt]').map((__,img)=>$(img).attr('alt')).get()].join(' '),parsed=parseText(text);
    if(parsed)buses.push(parsed);
  });
  return uniqueBuses(buses);
}

export function parseApproach(html){
  const $=load(html),rows=[];
  const selectors=['#approach_table [id^="vehicle-position-data_"]','[id^="vehicle-position-data_"]','[data-vehicle-position]','.vehicle-position','.approach-vehicle','.vehicle-info','.approach-info','.approachGuidance'];
  for(const selector of selectors)$(selector).each((_,e)=>{const cell=$(e),text=[cell.text(),...cell.find('img[alt]').map((__,img)=>$(img).attr('alt')).get()].join(' '),parsed=parseText(text);if(parsed)rows.push(parsed);});
  let buses=uniqueBuses(rows);
  const raw=clean(String(html).replace(/<[^>]+>/g,' ')),body=clean($.root().text()),noBus=/wgerror_successStatus\s*=\s*["']false["']/.test(html)&&/接近/.test(raw)&&/(?:ありません|いません)/.test(raw)||/(?:6\s*停留所以内|接近(?:している)?バス)[^。]{0,35}(?:ありません|いません|なし)/.test(body)||/現在[^。]{0,35}接近[^。]{0,35}(?:ありません|いません)/.test(body);
  if(!buses.length&&!noBus){
    const fallback=[];
    for(const match of body.matchAll(/(?:あと|約)?\s*\d{1,2}\s*分|[1-6]\s*(?:(?:停留所|つ|個)\s*)?(?:まえ|前)/g)){
      const from=Math.max(0,match.index-45),to=Math.min(body.length,match.index+match[0].length+45),parsed=parseText(body.slice(from,to));
      if(parsed)fallback.push(parsed);
    }
    buses=uniqueBuses(fallback);
  }
  if(!buses.length&&!noBus)throw Error('接近情報の読み込みが完了していません。');
  return {buses,noBus,message:noBus?'現在、6停留所以内に接近しているバスはありません。':null};
}

// The official "all selected" page renders one route header row followed by one
// vehicle-position row for each selected route/direction. Parsing that single
// page avoids N independent upstream requests and gives every direction the same
// capture timestamp.
export function parseApproachAll(html,choices=[]){
  const $=load(html),table=$('#approach_table');
  if(!table.length)throw Error('接近情報の一覧表が見つかりません。');
  const directRows=table.children('tbody').children('tr').toArray(),blocks=[];let pendingRoute=null;
  for(const row of directRows){
    const el=$(row),route=[...el.find('img[alt]').map((_,img)=>$(img).attr('alt')).get()].map(routeAlt).find(Boolean);
    if(route)pendingRoute=route;
    if(!el.find('[id^="vehicle-position-data_"]').length)continue;
    blocks.push({route:pendingRoute,buses:busesFromRow($,row)});
  }
  if(!blocks.length)throw Error('接近情報の車両行が見つかりません。');
  if(choices.length&&blocks.length!==choices.length)throw Error(`接近情報の方面数が一致しません（画面${blocks.length}件 / 選択${choices.length}件）。`);
  return blocks.map((block,index)=>{
    const choice=choices[index]??{};
    if(choice.route&&block.route&&String(choice.route)!==String(block.route))throw Error(`接近情報の並び順が変更されています（${choice.route} / ${block.route}）。`);
    const noBus=block.buses.length===0;
    return {...choice,route:String(choice.route??block.route??''),buses:block.buses,noBus,message:noBus?'現在、6停留所以内に接近しているバスはありません。':null};
  });
}
