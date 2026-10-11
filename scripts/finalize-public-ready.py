from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing patch target: {label}')
    return text.replace(old, new, 1)


def regex_once(text, pattern, repl, label):
    out, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'patch count {count}: {label}')
    return out

# Worker: all-selected page becomes the primary city-bus approach source.
p=Path('worker/index.js'); s=p.read_text()
s=replace_once(s,"import {parseApproach} from './bus.js';","import {parseApproach} from './bus.js';\nimport {batchBusChoices,fetchAllSelectedApproach} from './citybus-all.js';",'worker import')
new_bulk="""async function bulkBusData(env,stop,choices){
  const unique=[...new Map(choices.filter(c=>c?.value).map(c=>[c.value,c])).values()];let allPageError=null;
  try{
    const results=[];
    for(const batch of batchBusChoices(unique,10)){const page=await fetchAllSelectedApproach(stop,batch,{timeout:9000});results.push(...page.results);}
    if(results.length!==unique.length)throw Error(`全方面の接近情報が揃いませんでした（${results.length}/${unique.length}）。`);
    await Promise.all(results.map((value,index)=>saveBusChoice(env,stop,unique[index],value)));
    return {unique,results,success:results.length,mode:'all_page'};
  }catch(e){allPageError=e;if(env.LIVE_KV)await env.LIVE_KV.put(`diag:citybus:all:${stop}`,JSON.stringify({code:'all_page_failed',message:String(e?.message??e),at:new Date().toISOString()}),{expirationTtl:86400});}
  const cached=await Promise.all(unique.map(c=>busChoiceCached(env,stop,c))),results=cached.slice();
  let available=cached.filter(Boolean).length,cursor=0;const refresh=oldestChoiceIndexes(cached,2);
  async function directRun(){while(true){const n=cursor++;if(n>=refresh.length)return;const i=refresh[n],choice=unique[i];try{const value=await busDataObject(env,stop,choice,false);results[i]=value;if(!cached[i])available++;await saveBusChoice(env,stop,choice,value);}catch(e){if(!results[i])results[i]={kind:'bus-data',stop,...choice,buses:[],error:e instanceof Error?e.message:'接近情報を取得できませんでした。',capturedAt:new Date().toISOString()};}}}
  await Promise.all(Array.from({length:Math.min(2,refresh.length)},()=>directRun()));
  if(available===0&&unique.length){const i=refresh[0]??0;try{const value=await busDataObject(env,stop,unique[i],true);results[i]=value;available++;await saveBusChoice(env,stop,unique[i],value);}catch{}}
  for(let i=0;i<unique.length;i++)if(!results[i])results[i]={kind:'bus-data',stop,...unique[i],buses:[],capturedAt:new Date().toISOString()};
  return {unique,results,success:available,mode:'per_choice_fallback',allPageError:String(allPageError?.message??allPageError??'')};
}
async function busAll(env,stop,choices){const {results,mode}=await bulkBusData(env,stop,choices);return Response.json({kind:'bus-all',stop,results,capturedAt:new Date().toISOString(),meta:{mode}});}

async function sha256"""
s=regex_once(s,r"async function bulkBusData\(env,stop,choices\)\{.*?\n\}\nasync function busAll\(env,stop,choices\)\{.*?\}\n\nasync function sha256",new_bulk,'bulk citybus')
new_norm="""function normalizedCityRow(item,bus,index,now){const direct=Number.isFinite(bus?.minutes),hasStops=Number.isFinite(bus?.stopsAway),observed=direct||hasStops,minutes=direct?bus.minutes:null,at=Date.parse(item.capturedAt),fresh=Number.isFinite(at)&&now-at<=BUS_CHOICE_LIVE_AGE;return {key:`${item.value}:${index}`,route:String(item.route),dest:item.destination,boarding:item.boarding??'',minutes,stopsAway:hasStops?bus.stopsAway:null,congestion:bus?.congestion??null,status:minutes===null&&!hasStops?(item.noBus?'接近なし':null):null,delay:null,eta:direct?iso(now+minutes*60000):null,asOf:item.capturedAt,confidence:direct?0.96:hasStops?0.82:item.noBus?0.9:0.45,source:observed||item.noBus?(fresh?'live':'prediction'):'schedule',etaEstimated:false};}
async function cityBusArrivals"""
s=regex_once(s,r"function normalizedCityRow\(item,bus,index,now\)\{.*?\}\nasync function cityBusArrivals",new_norm,'normalized city row')
s=replace_once(s,"const choices=await options(stop),{unique,results:items,success}=await bulkBusData(env,stop,choices);","const choices=await options(stop),{unique,results:items,success,mode}=await bulkBusData(env,stop,choices);",'city mode destructure')
s=replace_once(s,"return {kind:'citybus-arrivals',stop,source:results.some(r=>r.source==='live')?'live':'prediction',stale:false,asOf:iso(asOf),results};","return {kind:'citybus-arrivals',stop,source:results.some(r=>r.source==='live')?'live':'prediction',stale:false,asOf:iso(asOf),results,meta:{mode,coverage:{available:success,total:unique.length}}};",'city meta')
s=s.replace("version:8,browser:","version:9,browser:",1)
p.write_text(s)

# Client: do not detach/reappend every row on every refresh; preserve visual position.
p=Path('public/js/vnext-arrivals.js'); s=p.read_text()
old="""function keyedRows(root,rows,render){
  [...root.children].filter(el=>!el.dataset.key).forEach(el=>el.remove());
  const old=new Map([...root.querySelectorAll('[data-key]')].map(el=>[el.dataset.key,el]));
  const fragment=document.createDocumentFragment();
  for(const row of rows){const key=String(row.key),html=render(row),hash=JSON.stringify(row);let el=old.get(key);if(!el){el=document.createElement('article');el.dataset.key=key;el.className='arrival-line';}if(el.dataset.hash!==hash){el.dataset.hash=hash;el.innerHTML=html;}fragment.append(el);old.delete(key);}root.append(fragment);for(const el of old.values())el.remove();
}"""
new="""function keyedRows(root,rows,render){
  [...root.children].filter(el=>!el.dataset.key).forEach(el=>el.remove());
  const old=new Map([...root.querySelectorAll('[data-key]')].map(el=>[el.dataset.key,el]));let previous=null;
  for(const row of rows){const key=String(row.key),html=render(row),hash=JSON.stringify(row);let el=old.get(key);if(!el){el=document.createElement('article');el.dataset.key=key;el.className='arrival-line';}if(el.dataset.hash!==hash){el.dataset.hash=hash;el.innerHTML=html;}const expected=previous?previous.nextElementSibling:root.firstElementChild;if(el!==expected)root.insertBefore(el,expected);previous=el;old.delete(key);}for(const el of old.values())el.remove();
}"""
s=replace_once(s,old,new,'stable keyed rows')
p.write_text(s)

# Build: produce a real versioned service worker and pre-cache every local app asset.
p=Path('scripts/build.mjs'); s=p.read_text()
old="""let html=await readFile(new URL('index.html',output),'utf8');
html=html.replace(/href=\"(vnext(?:-[\\w-]+)?\\.css)(?:\\?[^\\\"]*)?\"/g,(_,path)=>`href=\"${path}?v=${version}\"`).replace(/src=\"js\\/vnext\\.js(?:\\?[^\\\"]*)?\"/,`src=\"js/vnext.js?v=${version}\"`);
await writeFile(new URL('index.html',output),html);
console.log(`dist/ に公開用ファイルを生成しました（${version}）。`);"""
new="""let html=await readFile(new URL('index.html',output),'utf8');
html=html.replace(/href=\"((?:vnext(?:-[\\w-]+)?|route-search|stability)\\.css)(?:\\?[^\\\"]*)?\"/g,(_,path)=>`href=\"${path}?v=${version}\"`).replace(/src=\"js\\/vnext\\.js(?:\\?[^\\\"]*)?\"/,`src=\"js/vnext.js?v=${version}\"`);
await writeFile(new URL('index.html',output),html);
const precache=['./',...files.map(file=>file.path).filter(path=>path!=='sw.js')];
let sw=await readFile(new URL('sw.js',output),'utf8');sw=sw.replace('__BUILD_VERSION__',version).replace('__PRECACHE__',JSON.stringify(precache));await writeFile(new URL('sw.js',output),sw);
console.log(`dist/ に公開用ファイルを生成しました（${version}）。`);"""
s=replace_once(s,old,new,'versioned service worker build')
p.write_text(s)

# CI must fail if these production invariants regress.
p=Path('scripts/check.mjs'); s=p.read_text()
s=replace_once(s,"const arrivals=readFileSync(resolve(root,'public/js/vnext-arrivals.js'),'utf8'),realtime=readFileSync(resolve(root,'public/js/realtime.js'),'utf8'),worker=readFileSync(resolve(root,'worker/index.js'),'utf8'),core=readFileSync(resolve(root,'public/js/vnext-core.js'),'utf8'),planner=readFileSync(resolve(root,'public/js/route-search-ui.js'),'utf8'),plannerWorker=readFileSync(resolve(root,'public/js/planner-worker.js'),'utf8'),visual=readFileSync(resolve(root,'worker/visual-fallback.js'),'utf8');","const arrivals=readFileSync(resolve(root,'public/js/vnext-arrivals.js'),'utf8'),realtime=readFileSync(resolve(root,'public/js/realtime.js'),'utf8'),worker=readFileSync(resolve(root,'worker/index.js'),'utf8'),core=readFileSync(resolve(root,'public/js/vnext-core.js'),'utf8'),planner=readFileSync(resolve(root,'public/js/route-search-ui.js'),'utf8'),plannerWorker=readFileSync(resolve(root,'public/js/planner-worker.js'),'utf8'),visual=readFileSync(resolve(root,'worker/visual-fallback.js'),'utf8'),vnext=readFileSync(resolve(root,'public/js/vnext.js'),'utf8'),sw=readFileSync(resolve(root,'public/sw.js'),'utf8'),build=readFileSync(resolve(root,'scripts/build.mjs'),'utf8');",'check variables')
needle="""for(const path of [\"'/api/bus/rt'\",\"'/api/citybus/arrivals'\",\"'/api/rail/live'\"])if(!worker.includes(path))throw Error(`Worker APIがありません：${path}`);if(!worker.includes('ODPT_CONSUMER_KEY')||!worker.includes('LIVE_KV'))throw Error('ODPT secret/KVフォールバックが構成されていません。');if(!worker.includes('layout_changed')||!worker.includes('diagnostic'))throw Error('HTML構造変更の検知・予測フォールバックが構成されていません。');"""
addition=needle+"\nif(!worker.includes(\"from './citybus-all.js'\")||worker.includes('stopsAway*2'))throw Error('市バス全方面一括取得または公式位置の忠実表示が崩れています。');\nif(!vnext.includes('serviceWorker.register')||!sw.includes('__BUILD_VERSION__')||!sw.includes('__PRECACHE__')||!build.includes(\"replace('__BUILD_VERSION__',version)\"))throw Error('PWAのバージョン付きService Workerが構成されていません。');"
s=replace_once(s,needle,addition,'production checks')
s=s.replace("console.log('構文・公開残骸ゼロ・実時刻地下鉄・Web Worker探索・15秒更新・4秒timeout・リアルタイムAPI・視覚/予測フォールバックを検証しました。');","console.log('構文・公開残骸ゼロ・全方面接近・PWA・実時刻地下鉄・Web Worker探索・15秒更新・4秒timeout・リアルタイムAPI・視覚/予測フォールバックを検証しました。');")
p.write_text(s)

print('public-ready patches applied')
