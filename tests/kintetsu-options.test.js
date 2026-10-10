import test from 'node:test';
import assert from 'node:assert/strict';
import {timetableOptions} from '../worker/timetables.js';

test('近鉄京都駅は終端駅なので南行きをd=1で取得する',async()=>{
  const options=await timetableOptions('B01');
  assert.equal(options.boards.length,1);
  assert.equal(options.boards[0].key,'south');
  const u=new URL(options.boards[0].sourceURL);
  assert.equal(u.searchParams.get('d'),'1');
  assert.equal(u.searchParams.get('slCode'),'360-0');
});

test('高の原など中間駅は北d=1・南d=2を保持する',async()=>{
  const options=await timetableOptions('B24');
  assert.equal(options.boards.find(b=>b.key==='north')&&new URL(options.boards.find(b=>b.key==='north').sourceURL).searchParams.get('d'),'1');
  assert.equal(options.boards.find(b=>b.key==='south')&&new URL(options.boards.find(b=>b.key==='south').sourceURL).searchParams.get('d'),'2');
});
