import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {selectGtfsVersion,parseResourcePage,parseCSV,gtfsMinute,compactGtfsZip,serviceActive,dateFeed} from '../worker/static-gtfs.js';

const version=(date,start,end,temporary=false)=>({url:`https://example/${date}.zip`,versionDate:date,effectiveFrom:start,effectiveTo:end,updatedAt:date,temporary});
test('GTFS版は未来版を使わず、対象日に有効な最新版を選ぶ',()=>{const rows=[version('2026-09-11','2026-09-11','2026-09-27',true),version('2026-09-28','2026-09-28','2027-03-31'),version('2026-10-13','2026-10-13','2027-03-31')];assert.equal(selectGtfsVersion(rows,'2026-10-10').versionDate,'2026-09-28');assert.equal(selectGtfsVersion(rows,'2026-10-13').versionDate,'2026-10-13');});
test('有効期間が重なる日は臨時・イベント対応版を優先する',()=>{const rows=[version('2026-09-01','2026-09-01','2026-09-30'),version('2026-09-11','2026-09-11','2026-09-27',true)];assert.equal(selectGtfsVersion(rows,'2026-09-21').versionDate,'2026-09-11');});
test('カタログ詳細から有効期間・版・ZIP URLを読む',()=>{const html='<h1>京都バス-20260928</h1><p>有効期間 : 2026年9月28日 〜 2027年3月31日</p><a href="https://api.odpt.org/api/v4/files/odpt/KyotoBus/a.zip?date=20260928&amp;acl:consumerKey=[token]">DL</a>';const r=parseResourcePage(html,'https://ckan.example/resource/x');assert.equal(r.versionDate,'2026-09-28');assert.equal(r.effectiveFrom,'2026-09-28');assert.equal(r.effectiveTo,'2027-03-31');assert.match(r.url,/a\.zip/);});
test('CSVの引用符と24時以降のGTFS時刻を保持する',()=>{const rows=parseCSV('id,name\r\n1,"A, B"\r\n');assert.equal(rows[0].name,'A, B');assert.equal(gtfsMinute('25:07:30'),1507.5);});

function zip(files){const locals=[],centrals=[];let offset=0;for(const [name,text]of Object.entries(files)){const n=Buffer.from(name),plain=Buffer.from(text),packed=deflateRawSync(plain),local=Buffer.alloc(30+n.length);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(plain.length,22);local.writeUInt16LE(n.length,26);n.copy(local,30);locals.push(local,packed);const c=Buffer.alloc(46+n.length);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(plain.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);n.copy(c,46);centrals.push(c);offset+=local.length+packed.length;}const central=Buffer.concat(centrals),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(centrals.length,8);e.writeUInt16LE(centrals.length,10);e.writeUInt32LE(central.length,12);e.writeUInt32LE(offset,16);return Buffer.concat([...locals,central,e]);}
const fixture=()=>zip({
  'stops.txt':'stop_id,stop_name,stop_lat,stop_lon\nA,丸太町,35.01,135.75\nB,四条,35.00,135.75\nC,除外,34.99,135.75\n',
  'routes.txt':'route_id,route_short_name,route_long_name,route_type\nr1,10,10系統,3\nr2,999,除外,3\n',
  'trips.txt':'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\nr1,w,t1,四条,0,s1\nr1,x,t2,四条,0,s1\nr2,w,x1,除外,0,s2\n',
  'stop_times.txt':'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,08:00:00,08:00:00,A,1\nt1,08:10:00,08:10:00,B,2\nt2,09:00:00,09:00:00,A,1\nt2,09:10:00,09:10:00,B,2\nx1,10:00:00,10:00:00,B,1\nx1,10:10:00,10:10:00,C,2\n',
  'calendar.txt':'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nw,1,1,1,1,1,0,0,20261001,20261031\nx,0,0,0,0,0,0,0,20261001,20261031\n',
  'calendar_dates.txt':'service_id,date,exception_type\nw,20261012,2\nx,20261012,1\n',
  'shapes.txt':'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\ns1,35.01,135.75,1\ns1,35.005,135.75,2\ns1,35.00,135.75,3\n'
});
test('GTFS ZIPを対象系統だけに軽量化しshape・改正日を保持する',async()=>{const f=await compactGtfsZip(fixture(),{operator:'citybus',source:'fixture',version:{versionDate:'2026-09-30'}});assert.equal(f.routes.length,1);assert.equal(f.trips.length,2);assert.equal(f.stops.length,2);assert.equal(f.shapes.length,1);assert.equal(f.revisionDate,'2026-09-30');});
test('calendar_datesは通常カレンダーより優先する',async()=>{const f=await compactGtfsZip(fixture(),{operator:'citybus',source:'fixture',version:{versionDate:'2026-09-30'}});assert.equal(serviceActive(f,'w','2026-10-12'),false);assert.equal(serviceActive(f,'x','2026-10-12'),true);const d=dateFeed(f,'2026-10-12');assert.equal(d.services.length,1);assert.equal(d.services[0].trips[0].id,'t2');});
