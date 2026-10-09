import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(new URL('../',import.meta.url).pathname);
for(const dir of ['public/js','scripts','tests'])for(const file of readdirSync(resolve(root,dir))){if(!/\.(m?js)$/.test(file))continue;const r=spawnSync(process.execPath,['--check',resolve(root,dir,file)],{encoding:'utf8'});if(r.status){console.error(r.stderr);process.exit(r.status);}}
const html=readFileSync(resolve(root,'public/index.html'),'utf8'),app=readFileSync(resolve(root,'public/js/app.js'),'utf8');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]));
if(ids.size!==[...html.matchAll(/\bid="([^"]+)"/g)].length)throw Error('HTMLに重複するIDがあります。');
for(const match of app.matchAll(/\$\('#([\w-]+)'\)/g)){if(!ids.has(match[1]))throw Error(`参照先がありません：${match[1]}`);}
for(const m of html.matchAll(/(?:src|href)="([^"]+)"/g)){if(/^(?:https?:|#|\.\/$)/.test(m[1]))continue;if(!existsSync(resolve(root,'public',m[1])))throw Error(`ファイルがありません：${m[1]}`);}
JSON.parse(readFileSync(resolve(root,'public/manifest.webmanifest'),'utf8'));
console.log('JavaScript構文・HTML ID・静的ファイル参照を検証しました。');
