import test from 'node:test';
import assert from 'node:assert/strict';
import {createNetwork} from '../public/js/network.js';
import {buildCityBusTrip} from '../public/js/vnext-core.js';
import catalog from '../public/data/bus-catalog.json' with {type:'json'};

const network=createNetwork(catalog);

test('市バスの途中時刻を2分刻みで捏造しない',()=>{
  const service=network.services.find(s=>s.operator==='citybus'&&String(s.route)==='205'),currentStopId=service.stops[0],ride=buildCityBusTrip({route:'205',currentStopId,network,minute:600,destination:'九条車庫前'});
  assert.ok(ride);assert.equal(ride.depart,null);assert.equal(ride.arrive,null);assert.equal(ride.minutes,null);assert.equal(ride.observedMinute,600);assert.equal(ride.syntheticTimes,false);assert.ok(ride.officialStops.length>1);assert.ok(ride.officialStops.every(s=>s.time===null&&s.arrival===null&&s.departure===null));
});
