import {load} from 'cheerio';
export const LOCATION_URL='https://tid.kintetsu.co.jp/LocationWeb/trainlocationinfoweb03.html';
// The official diagram has alternating station / inter-station cells, starting at Kyoto.
// This is a snapshot position, not a stable train identifier.
export function parseRailLocation(html){
  const $=load(html),stations=[];
  $('#stations [data-stationid]').each((_,e)=>{const id=$(e).attr('data-stationid'),name=$(e).find('.station-name').text().replace(/\s/g,'');if(/^B\d{2}$/.test(id??'')&&name&&!stations.some(s=>s.id===id))stations.push({id:id==='B05'?'K15':id,name});});
  if(stations.length!==26||stations[0].id!=='B01'||stations.at(-1).id!=='B26')throw Error('近鉄の駅配置が変わりました。位置情報を確定できません。');
  const sourceTime=$('body').text().match(/(\d{4}\/\d{2}\/\d{2})\s+(\d{2}:\d{2})\s*現在/);
  if(!sourceTime)throw Error('近鉄の更新時刻を確認できませんでした。');
  const trains=[];
  for(const [selector,direction] of [['#train-points-up','south'],['#train-points-down','north']]){
    $(selector).find('.train-info-up,.train-info-down').each((_,e)=>{
      const parent=$(e).parent(),cell=Number(parent.attr('class')?.match(/\bcell-(\d+)\b/)?.[1]),destination=$(e).find('.train-destination-text').text().trim(),src=$(e).find('img').attr('src')??'',delayText=$(e).find('.delay-time').text().trim();
      if(!Number.isInteger(cell)||cell<1||cell>51||!destination)throw Error('近鉄の列車位置を読み取れませんでした。');
      const low=Math.floor((cell-1)/2),high=Math.ceil((cell-1)/2),kind=src.match(/tr_[rl]_(\d{2})\.png$/)?.[1];
      trains.push({position:cell,from:stations[low].id,to:stations[high].id,atStation:low===high,direction,destination,category:kind==='01'?'local':kind==='05'?'express':'other',label:kind==='01'?'普通':kind==='05'?'急行':/ex_/.test(src)?'特急':'種別未確認',delay:delayText?/^\+\d{1,3}$/.test(delayText)?Number(delayText.slice(1)):null:0,delayText});
    });
  }
  if(!$('#train-points-up').length||!$('#train-points-down').length)throw Error('近鉄の列車画面を取得できませんでした。');
  return {stations,trains,sourceUpdatedAt:`${sourceTime[1].replaceAll('/','-')}T${sourceTime[2]}:00+09:00`,notice:'京都線・京都〜大和西大寺の公式表示。位置・種別・遅れは実際と異なる場合があります。奈良線区間と地下鉄内の列車位置は含みません。'};
}
