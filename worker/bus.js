import {load} from 'cheerio/slim';
export function parseApproach(html){
  const $=load(html),table=$('#approach_table');
  if(!table.length)throw Error('接近表を読み取れませんでした。公式画面の形式が変更されている可能性があります。');
  const buses=[];
  table.find('[id^="vehicle-position-data_"]').each((_,e)=>{
    const cell=$(e),words=[cell.text(),...cell.find('img[alt]').map((_,img)=>$(img).attr('alt')).get()].join(' ').normalize('NFKC').replace(/\s+/g,' ').trim();
    const stops=words.match(/([1-6])(?:つ|停留所|個)?(?:まえ|前)/),mins=words.match(/(?:あと|約)?\s*(\d{1,2})\s*分/),congestion=words.match(/空席あり|やや混雑|混雑|満員/)?.[0]??null;
    if(stops||mins)buses.push({stopsAway:stops?Number(stops[1]):null,minutes:mins?Number(mins[1]):null,congestion,text:words});
    else if(cell.find('img').length||words)throw Error('バスの接近位置を読み取れませんでした。');
  });
  const noBus=/現在、?\s*6停留所以内に接近しているバスはありません/.test($('.modal.in,.bootstrap-dialog-message').text().normalize('NFKC'));
  if(!buses.length&&!noBus)throw Error('接近情報の読み込みが完了していません。');
  return {buses:buses.sort((a,b)=>(a.minutes??a.stopsAway??99)-(b.minutes??b.stopsAway??99)),noBus,message:noBus?'現在、6停留所以内に接近しているバスはありません。':null};
}
