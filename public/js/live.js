export const CAPTURE_API='https://my-map-capture.at5tram98.workers.dev';
export const busChoiceValue=choice=>typeof choice==='string'?choice:String(choice?.value??'');
async function response(path,params,signal){
  const url=new URL(path,CAPTURE_API);for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
  let r;try{r=await fetch(url,{signal,cache:'no-store'});}catch(e){if(e.name==='AbortError')throw e;throw Error('公式画面の取得サーバーに接続できませんでした。');}
  if(!r.ok){const body=await r.json().catch(()=>({}));throw Error(body.error??'公式画面を取得できませんでした。');}return r;
}
export async function getBusChoices(stop,signal){return (await response('/bus/options',{stop},signal)).json();}
export async function getBusData(stop,choice,signal){const value=busChoiceValue(choice);if(!value)throw Error('系統・行先を選択してください。');return (await response('/bus/data',{stop,choice:value},signal)).json();}
export async function getRailLocation(signal){return (await response('/rail/location',{},signal)).json();}
export async function getOfficialImage(source,{stop,choice}={},signal){
  const params=source==='rail'?{}:{stop,choice:busChoiceValue(choice)};if(source!=='rail'&&(!params.stop||!params.choice))throw Error('停留所と系統・行先を選択してください。');
  const r=await response(source==='rail'?'/rail/capture':'/bus/capture',params,signal);
  if(!r.headers.get('content-type')?.startsWith('image/'))throw Error('取得したデータが画像ではありません。');
  const blob=await r.blob();if(blob.size>15*1024*1024)throw Error('取得画像が大きすぎます。公式画面で確認してください。');
  const capturedAt=r.headers.get('X-Captured-At');if(!Number.isFinite(Date.parse(capturedAt)))throw Error('取得時刻を確認できませんでした。');
  const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  return {image,capturedAt,sourceURL:decodeURIComponent(r.headers.get('X-Source-URL')??''),source,importedAt:new Date().toISOString()};
}
