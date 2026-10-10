import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVisualBus,normalizeVisualRail,visualBusApproach,visualRailSnapshot} from '../worker/visual-fallback.js';

test('市バス視覚抽出は明示された接近値だけを採用する',()=>{
  const value=normalizeVisualBus({noBus:false,buses:[{stopsAway:2,minutes:5,congestion:'空席あり'},{stopsAway:1,minutes:null,congestion:'不明'}]});
  assert.equal(value.buses.length,2);assert.equal(value.buses[0].stopsAway,1);assert.equal(value.buses[0].minutes,null);assert.equal(value.buses[1].minutes,5);assert.equal(value.buses[0].congestion,null);
});

test('市バス視覚抽出は根拠のない空配列を運行なし扱いしない',()=>{
  assert.throws(()=>normalizeVisualBus({noBus:false,buses:[]}),/確認できません/);
  assert.equal(normalizeVisualBus({noBus:true,buses:[]}).noBus,true);
});

test('近鉄視覚抽出は駅・隣接区間・方向を検証する',()=>{
  const value=normalizeVisualRail({trains:[
    {direction:'south',from:'京都',to:'京都',atStation:true,destination:'大和西大寺',category:'express',label:'急行',delay:2},
    {direction:'south',from:'京都',to:'東寺',atStation:false,destination:'新田辺',category:'local',label:'普通',delay:0},
    {direction:'south',from:'京都',to:'竹田',atStation:false,destination:'奈良',category:'express',label:'急行',delay:0}
  ]},{now:new Date('2026-10-10T12:00:00+09:00')});
  assert.equal(value.trains.length,2);assert.equal(value.trains[0].from,'B01');assert.equal(value.trains[0].position,1);assert.equal(value.trains[1].to,'B02');assert.equal(value.trains[1].position,2);assert.equal(value.sourceUpdatedAt,'2026-10-10T03:00:00.000Z');
});

test('Browser Run JSON応答を正規化して返す',async()=>{
  const env={BROWSER:{quickAction:async(action)=>{assert.equal(action,'json');return new Response(JSON.stringify({result:{noBus:false,buses:[{stopsAway:1,minutes:3,congestion:'混雑'}]}}),{status:200});}}};
  const bus=await visualBusApproach(env,'https://example.com/bus');assert.equal(bus.buses[0].minutes,3);
});

test('近鉄Browser Run JSON応答も内部駅IDへ変換する',async()=>{
  const env={BROWSER:{quickAction:async()=>new Response(JSON.stringify({result:{trains:[{direction:'north',from:'東寺',to:'京都',atStation:false,destination:'京都',category:'local',label:'普通',delay:0}]}}),{status:200})}};
  const rail=await visualRailSnapshot(env,'https://example.com/rail');assert.equal(rail.trains.length,1);assert.equal(rail.trains[0].from,'B02');assert.equal(rail.trains[0].to,'B01');assert.equal(rail.trains[0].position,2);
});
