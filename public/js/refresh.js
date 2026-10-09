// Refresh only the visible panel, at most once per minute, without overlapping requests.
export function createRefreshLoop({refresh,canRefresh,now=Date.now,schedule=setInterval,cancel=clearInterval,interval=60000}){
  let enabled=false,timer=null,pending=false,last=now();
  async function tick(){
    if(!enabled||pending||!canRefresh()||now()-last<interval)return;
    pending=true;last=now();
    try{await refresh();}catch{/* The panel reports errors and retains its last verified data. */}
    finally{pending=false;}
  }
  function dispose(){if(timer!==null)cancel(timer);timer=null;}
  return {
    tick,touch:()=>{last=now();},
    setEnabled(value){enabled=Boolean(value);if(!enabled)dispose();else if(timer===null)timer=schedule(tick,5000);},
    dispose
  };
}
