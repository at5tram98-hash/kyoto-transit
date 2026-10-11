const VERSION='__BUILD_VERSION__';
const CACHE=`mymap-static-${VERSION}`;
const PRECACHE=['./','index.html','manifest.webmanifest','icon.svg','vnext.css','vnext-ui.css','vnext-sheets.css','vnext-arrivals.css','route-search.css','vnext-tabbar.css','stability.css','data/bus-catalog.json','data/locations.json','js/vnext.js'];
const scoped=path=>new URL(path,self.registration.scope).href;

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE.map(scoped))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('mymap-static-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
async function navigation(request){
  try{const response=await fetch(request);const cache=await caches.open(CACHE);cache.put(scoped('index.html'),response.clone()).catch(()=>{});return response;}
  catch{return await caches.match(request)||await caches.match(scoped('index.html'))||Response.error();}
}
async function staticAsset(request){
  const cache=await caches.open(CACHE),cached=await cache.match(request);
  const network=fetch(request).then(response=>{if(response.ok)cache.put(request,response.clone()).catch(()=>{});return response;}).catch(()=>null);
  if(cached){network.catch(()=>{});return cached;}
  return await network||Response.error();
}
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url);if(url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){event.respondWith(navigation(request));return;}
  if(/\.(?:js|css|json|svg|webmanifest)$/.test(url.pathname)){event.respondWith(staticAsset(request));}
});
