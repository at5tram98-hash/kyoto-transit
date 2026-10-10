import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSubwayTrains,railTimetableEta,subwayRideCandidates} from '../public/js/vnext-core.js';
import {mergeTimetableFeeds} from '../public/js/search-core.js';

const network={stops:new Map([
  ['K01',{id:'K01',name:'国際会館',type:'subway',aliases:[]}],['K02',{id:'K02',name:'松ヶ崎',type:'subway',aliases:[]}],['K03',{id:'K03',name:'北山',type:'subway',aliases:[]}],
  ['B01',{id:'B01',name:'京都',type:'kintetsu',aliases:[]}],['B02',{id:'B02',name:'東寺',type:'kintetsu',aliases:[]}],['K15',{id:'K15',name:'竹田',type:'subway',aliases:[]}],['B06',{id:'B06',name:'伏見',type:'kintetsu',aliases:[]}]
]),services:[],walks:[]};

const subwayFeed={
  validDates:['2026-10-10'],
  meta:{operator:'subway',terminalArrivalDerived:true},
  services:[{
    id:'subway-south',operator:'subway',label:'地下鉄烏丸線',category:'local',stops:['K01','K02','K03'],
    trips:[{id:'s1',date:'2026-10-10',arrivals:[600,602,605],departures:[600,602,605],headsign:'北山'}]
  }]
};

test('subway ride candidates use real per-station times instead of a fixed two-minute step',()=>{
  const rows=subwayRideCandidates(subwayFeed,{fromId:'K02',direction:'south',minute:602,network});
  assert.equal(rows.length,1);
  assert.equal(rows[0].syntheticTimes,false);
  assert.deepEqual(rows[0].officialStops.map(s=>s.time),[602,605]);
  assert.equal(rows[0].arrive,605);
});

test('subway network projection interpolates between actual timetable points',()=>{
  const rows=projectSubwayTrains({feed:subwayFeed,nowMinute:603.5,network});
  assert.equal(rows.length,1);
  assert.equal(rows[0].from,'K02');
  assert.equal(rows[0].to,'K03');
  assert.equal(rows[0].direction,'south');
  assert.ok(Math.abs(rows[0].position-1.5)<0.001);
});

test('ODPT-native subway stop IDs normalize to internal K IDs before ride matching',()=>{
  const raw={validDates:['2026-10-10'],stops:[
    {id:'odpt.stop.1',name:'国際会館'},{id:'odpt.stop.2',name:'松ヶ崎'},{id:'odpt.stop.3',name:'北山'}
  ],services:[{
    id:'odpt-service',operator:'subway',label:'地下鉄烏丸線',category:'local',stops:['odpt.stop.1','odpt.stop.2','odpt.stop.3'],
    trips:[{id:'odpt-trip',date:'2026-10-10',arrivals:[600,602,605],departures:[600,602,605],headsign:'北山'}]
  }]};
  const mapped=mergeTimetableFeeds(network,[raw]);
  assert.deepEqual(mapped.services[0].stops,['K01','K02','K03']);
  const rows=subwayRideCandidates({...raw,services:mapped.services},{fromId:'K02',direction:'south',minute:602,network});
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0].officialStops.map(s=>s.id),['K02','K03']);
});

test('Kintetsu ETA is matched to the official timetable and live delay',()=>{
  const feed={services:[{
    id:'k-exp',operator:'kintetsu',category:'express',stops:['B01','B02','K15','B06'],
    trips:[{id:'k1',arrivals:[600,602,610,612],departures:[600,602,610,612],headsign:'大和西大寺'}]
  }]};
  const train={position:5,direction:'south',category:'express',dest:'大和西大寺',delay:2};
  const eta=railTimetableEta(feed,train,'K15',607);
  assert.ok(eta);
  assert.equal(eta.minutes,5);
  assert.equal(eta.scheduledArrival,610);
  assert.equal(eta.delay,2);
  assert.ok(eta.matchError<1);
});
