import test from 'node:test';
import assert from 'node:assert/strict';
import { validBusStop } from '../worker/bus-stops.js';
import worker from '../worker/index.js';

test('STOP_NAMESを設定していない公開用設定でも対象の市バス停を利用できる', () => {
  assert.equal(validBusStop('烏丸丸太町'), true);
  assert.equal(validBusStop('京都駅前'), true);
  for (const value of [
    null,
    undefined,
    '',
    '丸太町',
    '任意の場所',
    'https://example.com',
  ])
    assert.equal(validBusStop(value), false);
});
test('明示された停留所制限は保持し、部分一致を許可しない', () => {
  assert.equal(validBusStop('京都駅前', ['京都駅前']), true);
  assert.equal(validBusStop('烏丸丸太町', ['京都駅前']), false);
  assert.equal(validBusStop('京都駅前', '["京都駅前"]'), true);
  assert.equal(validBusStop('京都', '["京都駅前"]'), false);
  assert.equal(validBusStop('京都駅前', []), false);
});

test('公開用Workerで設定なしの対象停留所はキャッシュを返し、不明な停留所は400で終了する', async (t) => {
  const original = globalThis.caches;
  let reads = 0;
  globalThis.caches = {
    default: {
      async match() {
        reads++;
        return Response.json({
          kind: 'citybus-arrivals',
          stop: '京都駅前',
          results: [],
        });
      },
    },
  };
  t.after(() => {
    if (original === undefined) delete globalThis.caches;
    else globalThis.caches = original;
  });
  const env = {
    APP_ORIGIN: 'https://example.com',
    LIMIT: {
      async limit() {
        return { success: true };
      },
    },
  };
  const request = (stop) =>
    new Request(
      `https://worker.example/api/citybus/arrivals?stop=${encodeURIComponent(stop)}`,
      { headers: { Origin: env.APP_ORIGIN } },
    );
  const valid = await worker.fetch(request('京都駅前'), env);
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).stop, '京都駅前');
  assert.equal(reads, 1);
  assert.equal((await worker.fetch(request('京都'), env)).status, 400);
  assert.equal(reads, 1);
  assert.equal(
    (await worker.fetch(request('京都駅前'), { ...env, STOP_NAMES: [] }))
      .status,
    400,
  );
  assert.equal(reads, 1);
});
