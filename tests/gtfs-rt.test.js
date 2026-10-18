import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeGtfsRealtime,filterKyotoBusVehicles,routeLabel,freshMeasurement,decayDelay} from '../worker/gtfs-rt.js';
import worker from '../worker/index.js';
import {realtimeRideEvidence} from '../public/js/realtime-evidence.js';

const enc=new TextEncoder();
const cat=(...parts)=>Uint8Array.from(parts.flatMap(p=>[...p]));
function vi(n){let v=BigInt(n),a=[];do{let b=Number(v&127n);v>>=7n;if(v)b|=128;a.push(b);}while(v);return Uint8Array.from(a);}
const tag=(n,w)=>vi((n<<3)|w);
const ld=(n,b)=>cat(tag(n,2),vi(b.length),b);
const st=(n,s)=>ld(n,enc.encode(s));
const vint=(n,v)=>cat(tag(n,0),vi(v));
function fl(n,v){const b=new Uint8Array(4);new DataView(b.buffer).setFloat32(0,v,true);return cat(tag(n,5),b);}
function trip(id='T1',route='odpt.KyotoBus.40'){return cat(st(1,id),st(2,'10:00:00'),st(3,'20261017'),st(5,route),vint(6,0));}
function vehicle(ts){const pos=cat(fl(1,35.06),fl(2,135.75),fl(3,90),fl(5,8.5)),desc=cat(st(1,'V1'),st(2,'101'));return cat(ld(1,trip()),ld(2,pos),vint(3,4),vint(5,ts),vint(6,2),st(7,'S4'),ld(8,desc),vint(9,2));}
function tripUpdate(ts){return cat(ld(1,trip()),vint(4,ts),vint(5,180));}
function feed(ts){return cat(ld(2,cat(st(1,'v'),ld(4,vehicle(ts)))),ld(2,cat(st(1,'u'),ld(3,tripUpdate(ts)))));}

test('GTFS-RT VehiclePositionとTripUpdateを最小protobuf decoderで読める',()=>{const ts=1_700_000_000,d=decodeGtfsRealtime(feed(ts));assert.equal(d.vehicles.length,1);assert.equal(d.tripUpdates.length,1);assert.equal(d.vehicles[0].trip,'T1');assert.equal(d.vehicles[0].route,'odpt.KyotoBus.40');assert.ok(Math.abs(d.vehicles[0].lat-35.06)<.001);assert.equal(d.tripUpdates[0].delay,180);});
test('京都バス対象系統だけを軽量化しTripUpdate遅延を分へ統合する',()=>{const ts=1_700_000_000,d=decodeGtfsRealtime(feed(ts)),r=filterKyotoBusVehicles(d.vehicles,d.tripUpdates,ts+20);assert.equal(r.vehicles.length,1);assert.equal(r.vehicles[0].route,'40');assert.equal(r.vehicles[0].delay,3);assert.equal(r.vehicles[0].fresh,true);});
test('対象外route_idは公開レスポンスへ混ぜない',()=>{assert.equal(routeLabel('odpt.KyotoBus.40'),'40');assert.equal(routeLabel('odpt.KyotoBus.特40'),'特40');assert.equal(routeLabel('other.55'),null);});
test('京都バス実測は90秒を超えたら実測扱いしない',()=>{assert.equal(freshMeasurement(100,189,90),true);assert.equal(freshMeasurement(100,191,90),false);});
test('Worker側の遅延減衰も1便ごとに半減する',()=>{assert.equal(decayDelay(6,1),3);assert.equal(decayDelay(6,2),1.5);});

test('実protobuf→Worker公開応答→Evidenceまで便・営業日・発車時刻・方向0を保持する',async(t)=>{
  const at=Date.now(),ts=Math.floor(at/1000);
  t.mock.method(globalThis,'fetch',async()=>new Response(feed(ts)));
  const priorCaches=globalThis.caches;t.after(()=>{if(priorCaches===undefined)delete globalThis.caches;else globalThis.caches=priorCaches;});globalThis.caches={default:{match:async()=>null,put:async()=>{}}};
  const origin='https://at5tram98-hash.github.io',env={APP_ORIGIN:origin,ODPT_CONSUMER_KEY:'fixture-only',LIMIT:{limit:async()=>({success:true})}};
  const response=await worker.fetch(new Request('https://example.test/api/bus/rt',{headers:{Origin:origin}}),env);
  assert.equal(response.status,200);
  const data=await response.json(),v=data.vehicles[0];
  assert.equal(v.tripId,'T1');assert.equal(v.trip,'T1');assert.equal(v.directionId,0);assert.equal(v.serviceDate,'2026-10-17');assert.equal(v.startTime,'10:00:00');
  const ride={operator:'kyotobus',tripId:'T1',route:'40',directionId:0,serviceDate:v.serviceDate,startTime:v.startTime};
  assert.equal(realtimeRideEvidence(ride,data,{now:at}).directionVerified,true);
  assert.equal(realtimeRideEvidence({...ride,directionId:1},data,{now:at}).status,'contradictory');
  assert.equal(realtimeRideEvidence({...ride,directionId:undefined,direction:'north'},data,{now:at}).directionVerified,false);
  assert.equal(realtimeRideEvidence({...ride,serviceDate:'2026-10-18'},data,{now:at}).status,'neutral');
  assert.equal(realtimeRideEvidence({...ride,startTime:'11:00:00'},data,{now:at}).status,'neutral');
});

test('同じtrip IDでも別営業日・別発車時刻のTripUpdate遅延を混ぜない',()=>{
  const ts=1700000000,d=decodeGtfsRealtime(feed(ts));
  const updates=[{...d.tripUpdates[0],delay:60},{...d.tripUpdates[0],serviceDate:'2026-10-18',delay:600},{...d.tripUpdates[0],startTime:'11:00:00',delay:1200}];
  const v=filterKyotoBusVehicles(d.vehicles,updates,ts+1).vehicles[0];
  assert.equal(v.delay,1);assert.equal(v.direction,0);assert.equal(v.serviceDate,'2026-10-17');
});

test('未来の車両時刻は実測と見なさず、位置がない便も実測にしない',()=>{
  const ts=1_700_000_000,d=decodeGtfsRealtime(feed(ts));
  const future=filterKyotoBusVehicles([{...d.vehicles[0],timestamp:ts+30}],d.tripUpdates,ts);
  assert.equal(future.vehicles[0].fresh,false);
  const noCoords=filterKyotoBusVehicles([{...d.vehicles[0],lat:null}],d.tripUpdates,ts);
  assert.equal(noCoords.vehicles[0].fresh,false);
  assert.equal(noCoords.vehicles[0].lat,null);
  assert.equal(noCoords.vehicles[0].lon,null);
});

test('有効期限切れTripUpdatesの遅延を現在の車両に結合しない',()=>{
  const ts=1_700_000_000,d=decodeGtfsRealtime(feed(ts));
  const freshVehicle={...d.vehicles[0],timestamp:ts+180};
  const r=filterKyotoBusVehicles([freshVehicle],d.tripUpdates,ts+180);
  assert.equal(r.vehicles[0].fresh,true);
  assert.equal(r.vehicles[0].delay,null);
});

test('未来時刻・明示的に古い車両は測定便の照合証拠として採用しない',()=>{
  // Realtime consumers must honor the server-side fresh flag even when
  // another vehicle in the same feed makes the overall source live.
  const ts=1_700_000_000,d=decodeGtfsRealtime(feed(ts));
  const r=filterKyotoBusVehicles([{...d.vehicles[0],timestamp:ts+30}],d.tripUpdates,ts);
  assert.equal(r.vehicles[0].fresh,false);
});
