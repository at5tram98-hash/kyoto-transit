import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLiveLoop,
  fetchRealtime,
  putCached,
  getCached,
} from '../public/js/realtime.js';

function scheduler() {
  let serial = 0;
  const tasks = new Map();
  return {
    tasks,
    schedule: (fn, delay) => {
      const id = ++serial;
      tasks.set(id, { fn, delay });
      return id;
    },
    cancel: (id) => tasks.delete(id),
    async next() {
      const [id, task] = tasks.entries().next().value;
      tasks.delete(id);
      await task.fn();
    },
  };
}

test('取得中の更新要求をまとめ、並行取得せず次の20秒更新へ戻る', async () => {
  const clock = scheduler();
  let calls = 0,
    finish;
  const loop = createLiveLoop({
    ...clock,
    run: () => {
      calls++;
      return new Promise((resolve) => (finish = resolve));
    },
  });
  loop.start();
  const first = clock.next();
  assert.equal(calls, 1);
  for (let i = 0; i < 12; i++) loop.poke();
  assert.equal(clock.tasks.size, 0);
  finish();
  await first;
  assert.equal(clock.tasks.size, 1);
  assert.equal([...clock.tasks.values()][0].delay, 0);
  const second = clock.next();
  assert.equal(calls, 2);
  finish();
  await second;
  assert.equal([...clock.tasks.values()][0].delay, 20000);
  loop.stop();
});

test('非表示では取得もタイマーも動かさず、停止後の取得完了で再開しない', async () => {
  const clock = scheduler();
  let visible = false,
    calls = 0,
    finish;
  const loop = createLiveLoop({
    ...clock,
    active: () => visible,
    run: () => {
      calls++;
      return new Promise((resolve) => (finish = resolve));
    },
  });
  loop.start();
  loop.poke();
  assert.equal(clock.tasks.size, 0);
  assert.equal(calls, 0);
  visible = true;
  loop.poke();
  const task = clock.next();
  assert.equal(calls, 1);
  loop.stop();
  finish();
  await task;
  assert.equal(clock.tasks.size, 0);
});

test('失敗後はバックオフを維持し、復旧後に通常の更新間隔へ戻る', async () => {
  const clock = scheduler();
  let broken = true;
  const loop = createLiveLoop({
    ...clock,
    run: async () => {
      if (broken) throw Error('network');
    },
  });
  loop.start();
  await clock.next();
  assert.equal([...clock.tasks.values()][0].delay, 2000);
  await clock.next();
  assert.equal([...clock.tasks.values()][0].delay, 4000);
  broken = false;
  await clock.next();
  assert.equal([...clock.tasks.values()][0].delay, 20000);
  loop.stop();
});

test('同じリアルタイム要求を共有し、通信完了後は新しい要求を許可する', async (t) => {
  let calls = 0,
    finish;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    await new Promise((resolve) => (finish = resolve));
    return Response.json({ source: 'live', results: [] });
  });
  const a = fetchRealtime('coalescing-test', '/api/test'),
    b = fetchRealtime('coalescing-test', '/api/test');
  assert.equal(a, b);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  finish();
  await Promise.all([a, b]);
  const c = fetchRealtime('coalescing-test', '/api/test');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  finish();
  await c;
});

test('停留所変更で古い通信をキャンセルしても他の要求を中断しない', async (t) => {
  const signals = [];
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => {
    signals.push(signal);
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
      if (signals.length === 2) resolve(Response.json({ results: [] }));
    });
  });
  const controller = new AbortController(),
    old = fetchRealtime(
      'old-stop',
      '/api/test',
      {},
      { signal: controller.signal },
    );
  await new Promise((resolve) => setImmediate(resolve));
  const next = fetchRealtime('new-stop', '/api/test');
  controller.abort();
  await assert.rejects(old, { name: 'AbortError' });
  await next;
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
});

test('IndexedDBが使えない場合も保存データをメモリから復元する', async () => {
  const record = {
    data: { results: [{ key: 'offline', stopsAway: 3 }] },
    savedAt: 123,
  };
  await putCached('memory-fallback-test', record);
  assert.deepEqual(await getCached('memory-fallback-test'), record);
});
