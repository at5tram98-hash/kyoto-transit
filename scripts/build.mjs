import {rm,mkdir,cp,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const source=new URL('public/',root),output=new URL('dist/',root);
const files=[];
async function collect(directory,prefix=''){
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const path=prefix+entry.name;
    if(entry.isDirectory())await collect(new URL(`${entry.name}/`,directory),`${path}/`);
    else files.push({path,content:await readFile(new URL(entry.name,directory))});
  }
}
await collect(source);
const hash=createHash('sha256');
for(const file of files)hash.update(file.path).update('\0').update(file.content).update('\0');
const version=hash.digest('hex').slice(0,12);
await rm(new URL('dist/',root),{recursive:true,force:true});
await mkdir(output,{recursive:true});
await cp(source,output,{recursive:true});
// 入口だけでなく全モジュールも更新し、依存ファイルの古いキャッシュを避ける。
for(const file of files.filter(file=>file.path.startsWith('js/')&&file.path.endsWith('.js'))){
  let content=file.content.toString().replace(/from (['"])(\.\/.+?\.js)\1/g,(_,quote,path)=>`from ${quote}${path}?v=${version}${quote}`);
  content=content.replace("fetch('data/bus-catalog.json')",`fetch('data/bus-catalog.json?v=${version}')`);
  await writeFile(new URL(file.path,output),content);
}
const html=(await readFile(new URL('index.html',output),'utf8')).replace('href="styles.css"',`href="styles.css?v=${version}"`).replace('src="js/app.js"',`src="js/app.js?v=${version}"`);
await writeFile(new URL('index.html',output),html);
console.log(`dist/ に公開用ファイルを生成しました（${version}）。`);
