import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(new URL('../',import.meta.url).pathname);
for(const dir of ['public/js','scripts','tests','worker'])for(const file of readdirSync(resolve(root,dir))){
  if(!/\.(m?js)$/.test(file))continue;
  const r=spawnSync(process.execPath,['--check',resolve(root,dir,file)],{encoding:'utf8'});
  if(r.status){console.error(r.stderr);process.exit(r.status);}
}
const html=readFileSync(resolve(root,'public/index.html'),'utf8');
const rawIds=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]),ids=new Set(rawIds);
if(ids.size!==rawIds.length)throw Error('HTMLに重複するIDがあります。');
for(const required of ['view-title','view-subtitle','location-indicator','now-hero','vehicle-panel','network-panel','nearby-panel','timetable-root','operations-root','settings-content','foldback-sheet','foldback-body','toast'])if(!ids.has(required))throw Error(`公開UIの必須IDがありません：${required}`);
const views=[...html.matchAll(/data-view="([^"]+)"/g)].map(x=>x[1]);
if(JSON.stringify(views)!==JSON.stringify(['now','timetable','operations','settings']))throw Error('公開タブは 今・時刻表・運行情報・設定 の4つにしてください。');
for(const m of html.matchAll(/(?:src|href)="([^"]+)"/g)){
  if(/^(?:https?:|#|data:|\.\/$)/.test(m[1]))continue;
  const file=m[1].split(/[?#]/)[0];if(!existsSync(resolve(root,'public',file)))throw Error(`ファイルがありません：${file}`);
}
JSON.parse(readFileSync(resolve(root,'public/manifest.webmanifest'),'utf8'));
console.log('JavaScript構文・4タブUI・静的ファイル参照を検証しました。');
