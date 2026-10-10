const dec=new TextDecoder();
const u16=(v,o)=>v.getUint16(o,true),u32=(v,o)=>v.getUint32(o,true);
async function inflateRaw(bytes){const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));return new Uint8Array(await new Response(stream).arrayBuffer());}
export async function unzipEntries(input,{maxArchive=24*1024*1024,maxFile=32*1024*1024,maxEntries=256}={}){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);if(bytes.byteLength>maxArchive)throw Error('GTFS ZIPが大きすぎます。');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(view,i)===0x06054b50){eocd=i;break;}if(eocd<0)throw Error('ZIP終端を確認できません。');
  const count=u16(view,eocd+10),central=u32(view,eocd+16);if(count>maxEntries)throw Error('ZIP内のファイル数が多すぎます。');
  const out=new Map();let p=central;
  for(let i=0;i<count;i++){
    if(p+46>bytes.length||u32(view,p)!==0x02014b50)throw Error('ZIP中央ディレクトリが壊れています。');
    const method=u16(view,p+10),compressed=u32(view,p+20),plain=u32(view,p+24),nameLen=u16(view,p+28),extraLen=u16(view,p+30),commentLen=u16(view,p+32),local=u32(view,p+42);
    if(plain>maxFile)throw Error('GTFS内のファイルが大きすぎます。');
    const name=dec.decode(bytes.subarray(p+46,p+46+nameLen));p+=46+nameLen+extraLen+commentLen;if(name.endsWith('/'))continue;
    if(local+30>bytes.length||u32(view,local)!==0x04034b50)throw Error('ZIPローカルヘッダーが壊れています。');
    const ln=u16(view,local+26),le=u16(view,local+28),start=local+30+ln+le,end=start+compressed;if(end>bytes.length)throw Error('ZIPデータ範囲が不正です。');
    const packed=bytes.subarray(start,end);let raw;if(method===0)raw=packed;else if(method===8)raw=await inflateRaw(packed);else throw Error(`未対応のZIP圧縮方式です: ${method}`);if(raw.byteLength!==plain)throw Error(`ZIP展開サイズが一致しません: ${name}`);out.set(name.replace(/^.*\//,''),raw);
  }return out;
}
export const textEntry=(entries,name)=>{const b=entries.get(name);if(!b)throw Error(`GTFSに${name}がありません。`);return dec.decode(b).replace(/^\uFEFF/,'');};
