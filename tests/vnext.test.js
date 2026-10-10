import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseNearbyGuide,buildCityBusTrip,routeIntersection,projectSubwayTrains,delayLabel} from '../public/js/vnext-core.js';
import {busChoiceValue} from '../public/js/live.js';
import {subwayIds,createNetwork} from '../public/js/network.js';

const subwayNetwork={stops:new Map(subwayIds.map((id,i)=>[id,{id,name:`S${i+1}`}]))};

test('設定距離より遠い地下鉄・バスは近くの案内に出さない',()=>{const rail={id:'K07',meters:410,stop:{name:'丸太町'}},bus={id:'bus-1',meters:700,stop:{name:'バス停'}};assert.equal(chooseNearbyGuide({rail,bus},350),null);});
test('地下鉄feedがない時は固定2分刻みの列車を生成しない',()=>{const trains=projectSubwayTrains({nowMinute:600,network:subwayNetwork});assert.deepEqual(trains,[]);});
test('市バスの終点までの停留所順を生成する',()=>{const network={stops:new Map([['a',{name:'A'}],['b',{name:'B'}],['c',{name:'C'}]]),services:[{id:'202-down',operator:'citybus',route:'202',stops:['a','b','c']}]};const ride=buildCityBusTrip({route:'202',currentStopId:'b',network,minute:720});assert.deepEqual(ride.officialStops.map(s=>s.id),['b','c']);assert.equal(ride.destination,'C');assert.equal(ride.officialStops[0].time,null);});
test('市バスは直前の停留所から進行方向を優先する',()=>{const network={stops:new Map([['a',{name:'A'}],['b',{name:'B'}],['c',{name:'C'}]]),services:[{id:'out',operator:'citybus',route:'10',stops:['a','b','c']},{id:'back',operator:'citybus',route:'10',stops:['c','b','a']}]};const ride=buildCityBusTrip({route:'10',currentStopId:'b',previousStopId:'a',network,minute:600});assert.equal(ride.to,'c');assert.equal(ride.serviceId,'out');});
test('連続して観測した停留所に共通する市バス系統だけを残す',()=>{const network={stops:new Map([['a',{lines:['10','202']}],['b',{lines:['202','204']}],['c',{lines:['202']} ]])};assert.deepEqual(routeIntersection(['a','b','c'],network),['202']);});
test('遅れ表示は公式と推定を区別する',()=>{assert.equal(delayLabel(4,true),'4分遅れ');assert.equal(delayLabel(4,false),'推定 4分遅れ');assert.equal(delayLabel(0,false),'ほぼ定刻');});
test('ポケロケ候補はオブジェクトでもvalueだけをAPIへ渡す',()=>{const choice={route:'204',destination:'円町',boarding:'Bのりば',value:'204000001;1:2:3'};assert.equal(busChoiceValue(choice),'204000001;1:2:3');assert.equal(busChoiceValue(choice.value),choice.value);assert.equal(busChoiceValue(null),'');});
test('京都バス臨時の丸太町区間を公式停留所ID付きで登録する',()=>{const network=createNetwork({});assert.equal(network.stops.get('kyotobus-karasuma-marutamachi').officialId,'51_1');assert.equal(network.stops.get('kyotobus-senbon-marutamachi').officialId,'152_2');assert.ok(network.services.some(s=>s.operator==='kyotobus'&&s.route==='臨時'));});
