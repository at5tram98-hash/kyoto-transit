import {load} from 'cheerio/slim';
import {officialText} from './timetables.js';
const sources=[
  {id:'subway',name:'地下鉄烏丸線',routes:['烏丸線'],url:'https://www.city.kyoto.lg.jp/kotsu/index.html'},
  {id:'kintetsu',name:'近鉄京都線・直通運転',routes:['京都線','奈良線','烏丸線直通'],url:'https://www.kintetsu.jp/unkou/unkou.html'},
  {id:'citybus',name:'京都市バス',routes:['10','13','43','46','78','93','202','202八条口','204','205','206','208'],url:'https://www.city.kyoto.lg.jp/kotsu/category/165-2-0-0-0-0-0-0-0-0-0.html'},
  {id:'kyotobus',name:'京都バス',routes:['40','特40','直行40','臨時'],url:'https://www.kyotobus.jp/'}
];
export function parseOperation(html,source){
  const $=load(html);$('script,style,nav,footer').remove();const text=$('body').text().replace(/\s+/g,' ').trim();
  if(source.id==='kyotobus'&&text.includes('通常通り運行しています'))return {status:'normal',summary:'通常通り運行しています',notices:[]};
  if(source.id==='kintetsu'&&/平常(?:通り|どおり)運行|通常(?:通り|どおり)運行/.test(text))return {status:'normal',summary:'公式サイトに平常運行の表示',notices:[]};
  const notices=$('a').map((_,a)=>{const n=$(a).text().replace(/\s+/g,' ').trim();if(!/運休|遅延|遅れ|運転見合わせ|迂回|ダイヤ|運行経路/.test(n)||n.length<8)return null;const u=new URL($(a).attr('href')??'',source.url);return /^https?:$/.test(u.protocol)?{title:n,url:u.href}:null;}).get().slice(0,12);
  return {status:'unconfirmed',summary:source.id==='citybus'?'迂回・運休などの公式お知らせ':source.id==='subway'?'交通局の公式お知らせを確認':'運行状況の平常・異常を自動確定できませんでした',notices};
}
export async function operationInformation(fetcher=fetch){
  const lines=[];for(const s of sources){try{lines.push({...s,...parseOperation(await officialText(s.url,fetcher,60),s),fetchedAt:new Date().toISOString()});}catch(e){lines.push({...s,status:'unavailable',summary:e.message,notices:[],fetchedAt:null});}}
  return {kind:'operations',lines,fetchedAt:new Date().toISOString(),notice:'お知らせの掲載がなくても、各便の定刻運行を保証するものではありません。'};
}
