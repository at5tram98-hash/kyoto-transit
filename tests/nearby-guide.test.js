import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseNearbyGuide} from '../public/js/vnext-core.js';

test('バスも本当に近い停留所だけを周辺案内に出す',()=>{
  assert.equal(chooseNearbyGuide({rail:null,bus:{id:'far',meters:1200}},350,350),null);
  assert.equal(chooseNearbyGuide({rail:null,bus:{id:'near',meters:120}},350,350).id,'near');
});

test('鉄道とバスが両方近い時は距離が短い方を選ぶ',()=>{
  assert.equal(chooseNearbyGuide({rail:{id:'rail',meters:180},bus:{id:'bus',meters:90}},350,350).id,'bus');
  assert.equal(chooseNearbyGuide({rail:{id:'rail',meters:80},bus:{id:'bus',meters:120}},350,350).id,'rail');
});
