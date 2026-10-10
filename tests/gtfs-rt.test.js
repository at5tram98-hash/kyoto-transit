import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeGtfsRealtime,filterKyotoBusVehicles,routeLabel,freshMeasurement,decayDelay} from '../worker/gtfs-rt.js';

const enc=new TextEncoder();
const cat=(...parts)=>Uint8Array.from(parts.flatMap(p=>[...p]));
function vi(n){let v=BigInt(n),a=[];do{let b=Number(v&127n);v>>=7n;if(v)b|=128;a.push(b);}while(v);return Uint8Array.from(a);}
const tag=(n,w)=>vi((n<<3)|w);
const ld=(n,b)=>cat(tag(n,2),vi(b.length),b);
const st=(n,s)=>ld(n,enc.encode(s));
const vint=(n,v)=>cat(tag(n,0),vi(v));
function fl(n,v){const b=new Uint8Array(4);new DataView(b.buffer).setFloat32(0,v,true);return cat(tag(n,5),b);}
function trip(id='T1',route='odpt.KyotoBus.40'){return cat(st(1,id),st(5,route),vint(6,0));}
function vehicle(ts){const pos=cat(fl(1,35.06),fl(2,135.75),fl(3,90),fl(5,8.5)),desc=cat(st(1,'V1'),st(2,'101'));return cat(ld(1,trip()),ld(2,pos),vint(3,4),vint(5,ts),vint(6,2),st(7,'S4'),ld(8,desc),vint(9,2));}
function tripUpdate(ts){return cat(ld(1,trip()),vint(4,ts),vint(5,180));}
function feed(ts){return cat(ld(2,cat(st(1,'v'),ld(4,vehicle(ts)))),ld(2,cat(st(1,'u'),ld(3,tripUpdate(ts)))));}

test('GTFS-RT VehiclePositionとTripUpdateを最小protobuf decoderで読める',()=>{const ts=1_700_000_000,d=decodeGtfsRealtime(feed(ts));assert.equal(d.vehicles.length,1);assert.equal(d.tripUpdates.length,1);assert.equal(d.vehicles[0].trip,'T1');assert.equal(d.vehicles[0].route,'odpt.KyotoBus.40');assert.ok(Math.abs(d.vehicles[0].lat-35.06)<.001);assert.equal(d.tripUpdates[0].delay,180);});
test('京都バス対象系統だけを軽量化しTripUpdate遅延を分へ統合する',()=>{const ts=1_700_000_000,d=decodeGtfsRealtime(feed(ts)),r=filterKyotoBusVehicles(d.vehicles,d.tripUpdates,ts+20);assert.equal(r.vehicles.length,1);assert.equal(r.vehicles[0].route,'40');assert.equal(r.vehicles[0].delay,3);assert.equal(r.vehicles[0].fresh,true);});
test('対象外route_idは公開レスポンスへ混ぜない',()=>{assert.equal(routeLabel('odpt.KyotoBus.40'),'40');assert.equal(routeLabel('odpt.KyotoBus.特40'),'特40');assert.equal(routeLabel('other.55'),null);});
test('京都バス実測は90秒を超えたら実測扱いしない',()=>{assert.equal(freshMeasurement(100,189,90),true);assert.equal(freshMeasurement(100,191,90),false);});
test('Worker側の遅延減衰も1便ごとに半減する',()=>{assert.equal(decayDelay(6,1),3);assert.equal(decayDelay(6,2),1.5);});
