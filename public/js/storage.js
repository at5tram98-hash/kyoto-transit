import {DEFAULT_PASSES} from './fares.js';
const KEY='kyonori.v1';
export const defaultState=()=>({version:1,passes:{...DEFAULT_PASSES},favorites:['K07','K01','K11','ksu'],savedRoutes:[],buffer:3,theme:'system',feedLabel:null,destinations:{muji:{label:'',stop:null},gu:{label:'',stop:null}}});
export function loadState(){
  try{const s=JSON.parse(localStorage.getItem(KEY));if(s?.version!==1)return defaultState();
    const defaults=defaultState(),destinations={};for(const k of ['muji','gu']){const d=s.destinations?.[k];destinations[k]={label:typeof d?.label==='string'?d.label.slice(0,80):'',stop:typeof d?.stop==='string'?d.stop:null};}
    return {...defaults,...s,destinations,passes:{...DEFAULT_PASSES,...s.passes},favorites:Array.isArray(s.favorites)?s.favorites.filter(x=>typeof x==='string'):[]};
  }catch{return defaultState();}
}
export function saveState(s){localStorage.setItem(KEY,JSON.stringify(s));}
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('kyonori',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function access(mode,key,value){
  const db=await openDB();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction('files',mode),store=tx.objectStore('files');
    const r=mode==='readonly'?store.get(key):value===undefined?store.delete(key):store.put(value,key);let result;
    r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
}
export const getFile=key=>access('readonly',key);
export const putFile=(key,value)=>access('readwrite',key,value);
export const deleteFile=key=>access('readwrite',key);
