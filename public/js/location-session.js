// One location watch per open app. Permission failures require an explicit retry.
export function createLocationSession({geolocation,loadData,onPosition,onStatus}){
  let watch=null,generation=0,pending=null,data,blocked=false;
  function stop(){generation++;pending=null;if(watch!==null)geolocation?.clearWatch(watch);watch=null;}
  async function start({retry=false}={}){
    if(watch!==null)return;
    if(pending)return pending;
    if(blocked&&!retry)return;
    if(!geolocation){onStatus('unsupported');return;}
    blocked=false;const token=++generation;onStatus('loading');
    pending=(async()=>{
      try{
        data??=await loadData();if(token!==generation)return;
        watch=geolocation.watchPosition(position=>{
          if(token!==generation)return;onStatus('active');onPosition(position,data);
        },error=>{
          if(token!==generation)return;
          if(error.code===1){blocked=true;stop();onStatus('denied');}
          else onStatus('unavailable'); // Keep watching: GPS may recover after leaving a tunnel.
        },{enableHighAccuracy:true,maximumAge:10000,timeout:20000});
      }catch{if(token===generation)onStatus('unavailable');}
      finally{if(token===generation)pending=null;}
    })();
    return pending;
  }
  return {start,stop,get active(){return watch!==null;}};
}
