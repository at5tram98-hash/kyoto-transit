const ROOT=new URL('../',import.meta.url);
let worker=null,creating=null,generation=0,progress=()=>{};
function loadEngine(){
  if(window.Tesseract)return Promise.resolve(window.Tesseract);
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=new URL('vendor/ocr/tesseract.min.js',ROOT).href;
    script.onload=()=>resolve(window.Tesseract);script.onerror=()=>{script.remove();reject(Error('OCRの読み込みに失敗しました。通信状態を確認してください。'));};
    document.head.append(script);
  });
}
async function getWorker(){
  if(worker)return worker;
  if(!creating){const current=generation;const task=(async()=>{
    const engine=await loadEngine();
    const created=await engine.createWorker(['jpn','eng'],1,{
      workerPath:new URL('vendor/ocr/worker.min.js',ROOT).href,
      corePath:new URL('vendor/ocr/core/',ROOT).href,
      langPath:'https://tessdata.projectnaptha.com/4.0.0',
      logger:m=>progress(m.status==='recognizing text'?'文字を読み取り中':'日本語OCRを準備中',m.progress??0),
      errorHandler:()=>{}
    });
    if(current!==generation){await created.terminate();throw new DOMException('中止しました','AbortError');}
    await created.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
    worker=created;return worker;
  })();creating=task;task.finally(()=>{if(creating===task)creating=null;}).catch(()=>{});}
  return creating;
}
export async function recognizeImage(image,onProgress=()=>{}){
  progress=onProgress;
  const w=await getWorker();onProgress('文字を読み取り中',0);
  const {data}=await w.recognize(image,{}, {text:true,blocks:true});
  if(!data.text.trim())throw Error('文字を読み取れませんでした。文字が鮮明な画像を選択してください。');
  onProgress('読み取り完了',1);
  const lines=(data.blocks??[]).flatMap(b=>(b.paragraphs??[]).flatMap(p=>p.lines??[]));
  const rows=[];
  for(const l of lines.sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0)){
    const middle=(l.bbox.y0+l.bbox.y1)/2,tolerance=Math.max(4,(l.bbox.y1-l.bbox.y0)*.45);
    const row=rows.find(r=>Math.abs(r.middle-middle)<tolerance);if(row)row.lines.push(l);else rows.push({middle,lines:[l]});
  }
  const rowText=rows.sort((a,b)=>a.middle-b.middle).map(r=>r.lines.sort((a,b)=>a.bbox.x0-b.bbox.x0).map(l=>l.text.trim().replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,'')).join(' ｜ ')).join('\n');
  return {text:data.text.trim(),rowText,confidence:Number(data.confidence),recognizedAt:new Date().toISOString()};
}
export async function cancelOCR(){generation++;const w=worker;worker=null;creating=null;if(w)await w.terminate();}

export function freshness(capturedAt,now=Date.now()){
  const stamp=Date.parse(capturedAt);if(!Number.isFinite(stamp))return '取得時刻不明';
  const age=now-stamp;if(age< -60000)return '取得時刻を要確認';
  return age<=120000?'取得から2分以内':`保存情報・${Math.max(1,Math.floor(age/60000))}分前`;
}
export function summarizeOCR(text,source){
  const normalized=String(text).normalize('NFKC'),lines=normalized.split(/\n/).map(l=>l.trim().replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,'')).filter(Boolean);
  // OCR is fallible. Never convert a missing line, low-quality text or "no 15-minute delay" into on-time service.
  if(source==='rail'){
    const relevant=lines.filter(l=>/京都線|奈良線/.test(l));
    if(relevant.length)return relevant.slice(0,6);
    const noMajorDelay=lines.find(l=>/15分以上/.test(l)&&/ございません|ありません/.test(l));
    return noMajorDelay?[noMajorDelay]:['京都線・奈良線の状況は読み取った原文と公式画面で確認してください。'];
  }
  const legend=lines.findIndex(l=>/凡例|マークの説明/.test(l));
  const active=legend<0?lines:lines.slice(0,legend);
  return active.filter(l=>/接近しているバスはありません|運休|終発|始発|\d\s*つ\s*まえ/.test(l)&&!/凡例|マークの説明|つ前の停留所/.test(l)).slice(0,8);
}
