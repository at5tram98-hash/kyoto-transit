export const CAPTURE_API='https://my-map-capture.at5tram98.workers.dev';
async function response(path,params,signal){
  const url=new URL(path,CAPTURE_API);for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
  let r;try{r=await fetch(url,{signal,cache:'no-store'});}catch(e){if(e.name==='AbortError')throw e;throw Error('公式画面の取得サーバーに接続できませんでした。');}
  if(!r.ok){const body=await r.json().catch(()=>({}));throw Error(body.error??'公式画面を取得できませんでした。');}return r;
}
export async function getBusChoices(stop,signal){return (await response('/bus/options',{stop},signal)).json();}
export async function getOfficialImage(source,{stop,choice}={},signal){
  const r=await response(source==='rail'?'/rail/capture':'/bus/capture',source==='rail'?{}:{stop,choice},signal);
  if(!r.headers.get('content-type')?.startsWith('image/'))throw Error('取得したデータが画像ではありません。');
  const blob=await r.blob();if(blob.size>15*1024*1024)throw Error('取得画像が大きすぎます。公式画面で確認してください。');
  const capturedAt=r.headers.get('X-Captured-At');if(!Number.isFinite(Date.parse(capturedAt)))throw Error('取得時刻を確認できませんでした。');
  const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  return {image,capturedAt,sourceURL:decodeURIComponent(r.headers.get('X-Source-URL')??''),source,importedAt:new Date().toISOString()};
}
