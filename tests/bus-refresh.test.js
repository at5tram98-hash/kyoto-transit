import test from 'node:test';
import assert from 'node:assert/strict';
import {BUS_CHOICE_CACHE_TTL,BUS_CHOICE_LIVE_AGE,choiceAge,oldestChoiceIndexes} from '../worker/bus-refresh.js';

test('方面キャッシュは短時間で失効させず最古データから更新する',()=>{
  const now=1_000_000,iso=ms=>new Date(ms).toISOString(),cached=[
    {capturedAt:iso(now-20_000)},
    {capturedAt:iso(now-200_000)},
    null,
    {capturedAt:iso(now-80_000)}
  ];
  assert.equal(BUS_CHOICE_CACHE_TTL,900);
  assert.equal(BUS_CHOICE_LIVE_AGE,240000);
  assert.equal(choiceAge(cached[1],now),200000);
  assert.deepEqual(oldestChoiceIndexes(cached,2,now),[2,1]);
});
