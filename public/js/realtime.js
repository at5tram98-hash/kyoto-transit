import {CAPTURE_API} from './live.js';

export const ARRIVAL_INTERVAL=15000;
export const LIVE_MAX_AGE=90000;
export const FETCH_TIMEOUT=4000;
const DB='mymap-live-v1',STORE='cache';
const logs=new Map();

export const decayDelay=(delay,followingTrips=0)=>Number.isFinite(delay)?delay*(.5**Math.max(0,followingTrips)):null;
export const isFresh=(asOf,limit=LIVE_MAX_AGE,now=Date.now())=>{const t=typeof asOf==='number'?asOf:Date.parse(asOf);return Number.isFinite(t)&&t<=now+5000&&now-t<=limit;};
export function predictedMinutes(eta,now=Date.now()){const t=typeof eta==='number'?eta:Date.parse(eta);return Number.isFinite(t)?Math.max(0,Math.ceil((t-now)/60000)):null;}

export class Backoff{
  constructor(steps=[2000,4000,8000,30000]){this.steps=steps;this.index=0;}
  fail(){const v=this.steps[Math.min(this.index,this.steps.length-1)];this.index=Math.min(this.index+1,this.steps.length-1);return v;}
  success(){this.index=0;}
  peek(){return this.steps[Math.min(this.index,this.steps.length-1)];}
}

function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function access(mode,key,value){if(!('indexedDB'in globalThis))return null;const db=await openDB();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE),req=mode==='readonly'?store.get(key):store.put(value,key);let out=null;req.onsuccess=()=>out=req.result;tx.oncomplete=()=>resolve(out);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
export const getCached=key=>access('readonly',key).catch(()=>null);
export const putCached=(key,value)=>access('readwrite',key,value).catch(()=>null);

export function realtimeLog(){return [...logs.entries()].map(([key,v])=>({key,...v}));}
function note(key,patch){logs.set(key,{...(logs.get(key)??{}),...patch});window.dispatchEvent?.(new CustomEvent('mymap-realtime-log'));}
function endpoint(path,params={}){const u=new URL(path,CAPTURE_API);for(const[k,v]of Object.entries(params))if(v!==null&&v!==undefined&&v!=='')u.searchParams.set(k,v);return u;}

export async function fetchRealtime(key,path,params={},options={}){
  const timeout=options.timeout??FETCH_TIMEOUT,cached=await getCached(key),headers={Accept:'application/json'};
  if(cached?.etag)headers['If-None-Match']=cached.etag;
  if(typeof navigator!=='undefined'&&navigator.onLine===false){note(key,{source:'prediction',online:false,error:'offline',freshness:cached?.data?.asOf??cached?.savedAt??null});const e=Error('offline');e.code='offline';e.cached=cached;throw e;}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort('timeout'),timeout);const started=Date.now();
  try{
    const r=await fetch(endpoint(path,params),{headers,signal:controller.signal,cache:'no-store'});
    if(r.status===304&&cached?.data){note(key,{source:cached.data.source??'live',online:true,status:304,latency:Date.now()-started,freshness:cached.data.asOf??cached.savedAt,error:null});return cached.data;}
    const data=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(data.error??`HTTP ${r.status}`),{status:r.status});
    const saved={data,etag:r.headers.get('ETag'),savedAt:Date.now()};await putCached(key,saved);note(key,{source:data.source??(data.stale?'prediction':'live'),online:true,status:r.status,latency:Date.now()-started,freshness:data.asOf??data.capturedAt??saved.savedAt,error:null});return data;
  }catch(e){note(key,{source:'prediction',online:typeof navigator==='undefined'?true:navigator.onLine!==false,status:e.status??0,latency:Date.now()-started,error:e.name==='AbortError'?'timeout':String(e.message??e),freshness:cached?.data?.asOf??cached?.savedAt??null});e.cached=cached;throw e;}finally{clearTimeout(timer);}
}

export function predictCityBus(data,now=Date.now()){
  if(!data)return null;return {...data,stale:true,source:'prediction',results:(data.results??[]).map(r=>{const minutes=predictedMinutes(r.eta,now);return {...r,minutes:Number.isFinite(minutes)?minutes:r.minutes,source:'prediction'};})};
}
export function predictRail(data,now=Date.now()){
  if(!data)return null;const asOf=Date.parse(data.asOf??data.sourceUpdatedAt??data.capturedAt),age=Number.isFinite(asOf)?Math.max(0,(now-asOf)/60000):0;return {...data,stale:true,source:'prediction',trains:(data.trains??[]).map(t=>{const dir=t.direction==='north'?-1:1,advance=Math.min(6,age/1.5)*dir,pos=Math.max(1,Math.min(51,(Number(t.position)||1)+advance));return {...t,position:pos,predicted:true};})};
}

export function createLiveLoop({run,active=()=>true,interval=ARRIVAL_INTERVAL}){
  let timer=null,stopped=true,running=false;const backoff=new Backoff();
  const schedule=ms=>{clearTimeout(timer);if(!stopped)timer=setTimeout(tick,ms);};
  async function tick(){if(stopped)return;if(!active()){schedule(interval);return;}if(running){schedule(1000);return;}running=true;try{await run();backoff.success();schedule(interval);}catch{schedule(backoff.fail());}finally{running=false;}}
  const onOnline=()=>{if(!stopped&&active())schedule(0);},onVisibility=()=>{if(!stopped&&active())schedule(0);};
  return {start(){if(!stopped)return;stopped=false;globalThis.addEventListener?.('online',onOnline);globalThis.document?.addEventListener?.('visibilitychange',onVisibility);schedule(0);},stop(){stopped=true;clearTimeout(timer);globalThis.removeEventListener?.('online',onOnline);globalThis.document?.removeEventListener?.('visibilitychange',onVisibility);},poke(){if(!stopped)schedule(0);},get backoff(){return backoff.peek();}};
}
