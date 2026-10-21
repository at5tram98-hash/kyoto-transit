import {load} from 'cheerio/slim';

const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const routeAlt=value=>{const text=clean(value);return /^\d{1,3}$/.test(text)?String(Number(text)):/^北\d{1,2}$/.test(text)?text:null;};

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
const headerRoute=alts=>{for(const alt of alts){const text=clean(alt),m=text.match(/^(?:かいそく|快速)?\s*(\d{1,3})(?!\d)/)??text.match(/^(北\s*\d{1,2})/);if(m)return m[1].startsWith('北')?m[1].replace(/\s+/g,''):String(Number(m[1]));}return null;};
const destinationCore=value=>clean(value).replace(/[（(]始発停留所[)）]/g,'').replace(/\s+/g,'');
function sameDirection(choice,block){
  const core=destinationCore(choice.destination),title=clean(block.title).replace(/\s+/g,'');
  if(core&&title)return title.includes(core)||core.includes(title.split(/[A-Z(]/)[0]);
  return !choice.route||!block.route||String(choice.route)===String(block.route);
}
export function parseApproachAll(html,choices=[]){
  const $=load(html),table=$('#approach_table');
  if(!table.length)throw Error('接近情報の一覧表が見つかりません。');
  // Each direction is a header row followed by either the vehicle-position row
  // or a single official message row (e.g. service has ended for today).
  const directRows=table.children('tbody').children('tr').toArray(),blocks=[];let header=null;
  for(const row of directRows){
    const el=$(row);
    if(el.find('[id^="vehicle-position-data_"]').length){blocks.push({route:header?.route??null,title:header?.title??'',buses:busesFromRow($,row),message:null});header=null;continue;}
    const text=clean(el.text());
    if(header&&!el.find('img').length&&el.children('td[colspan]').length){blocks.push({...header,buses:[],message:text||null});header=null;continue;}
    header={route:headerRoute(el.find('img[alt]').map((_,img)=>$(img).attr('alt')).get()),title:text};
  }
  if(!blocks.length)throw Error('接近情報の車両行が見つかりません。');
  if(choices.length&&blocks.length!==choices.length)throw Error(`接近情報の方面数が一致しません（画面${blocks.length}件 / 選択${choices.length}件）。`);
  return blocks.map((block,index)=>{
    const choice=choices[index]??{};
    if(choices.length&&!sameDirection(choice,block))throw Error(`接近情報の並び順が変更されています（${choice.route} ${choice.destination} / ${block.route??''} ${block.title.slice(0,20)}）。`);
    const noBus=block.buses.length===0;
    return {...choice,route:String(choice.route??block.route??''),buses:block.buses,noBus,message:noBus?(block.message??'現在、6停留所以内に接近しているバスはありません。'):null};
  });
}
