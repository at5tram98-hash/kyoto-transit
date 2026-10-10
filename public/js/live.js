export const CAPTURE_API='https://my-map-capture.at5tram98.workers.dev';
export const busChoiceValue=choice=>typeof choice==='string'?choice:String(choice?.value??'');
async function response(path,params,signal){
  const url=new URL(path,CAPTURE_API);for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
  let r;try{r=await fetch(url,{signal,cache:'no-store'});}catch(e){if(e.name==='AbortError')throw e;throw Error('データ取得サーバーに接続できませんでした。');}
  if(!r.ok){const body=await r.json().catch(()=>({}));const err=Error(body.error??'データを取得できませんでした。');err.code=body.code??null;err.status=r.status;throw err;}return r;
}
export async function getBusChoices(stop,signal){return (await response('/bus/options',{stop},signal)).json();}
export async function getBusData(stop,choice,signal){const value=busChoiceValue(choice);if(!value)throw Error('系統・行先を選択してください。');return (await response('/bus/data',{stop,choice:value},signal)).json();}
export async function getBusAll(stop,signal){if(!stop)throw Error('停留所を選択してください。');return (await response('/bus/all',{stop},signal)).json();}
export async function getRailLocation(signal){return (await response('/rail/location',{},signal)).json();}
export async function getKyotoBusRT(signal){return (await response('/api/bus/rt',{},signal)).json();}
