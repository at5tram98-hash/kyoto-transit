import {load} from 'cheerio/slim';
export function parseApproach(html){
  const $=load(html),table=$('#approach_table');
  if(!table.length)throw Error('接近表を読み取れませんでした。公式画面の形式が変更されている可能性があります。');
  const buses=[];
  table.find('[id^="vehicle-position-data_"]').each((_,e)=>{
    const cell=$(e),words=[cell.text(),...cell.find('img[alt]').map((_,img)=>$(img).attr('alt')).get()].join(' ').normalize('NFKC').replace(/\s+/g,' ').trim();
    const m=words.match(/([1-6])(?:つ|停留所|個)?(?:まえ|前)/);
    if(m)buses.push({stopsAway:Number(m[1]),congestion:words.match(/空席あり|やや混雑|混雑|満員/)?.[0]??null,text:words});
    else if(cell.find('img').length||words)throw Error('バスの接近位置を正確に読み取れませんでした。画像読み取りをご利用ください。');
  });
  const noBus=/現在、?\s*6停留所以内に接近しているバスはありません/.test($('.modal.in,.bootstrap-dialog-message').text().normalize('NFKC'));
  if(!buses.length&&!noBus)throw Error('接近情報の読み込みが完了していません。再度更新してください。');
  return {buses:buses.sort((a,b)=>a.stopsAway-b.stopsAway),noBus,message:noBus?'現在、6停留所以内に接近しているバスはありません。':null};
}
