import {mergeTimetableFeeds,searchTimetable} from './search-core.js';

export function planWorkerJob({base,feeds,request,passes}){
  const network=mergeTimetableFeeds(base,feeds);
  return {planned:searchTimetable(network,request,passes),feedMeta:network.feedMeta??[]};
}

if(typeof self!=='undefined'&&typeof self.postMessage==='function'){
  self.onmessage=event=>{
    const id=event.data?.id;
    try{self.postMessage({id,ok:true,...planWorkerJob(event.data)});}
    catch(error){self.postMessage({id,ok:false,error:String(error?.message??error)});}
  };
}
