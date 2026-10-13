import test from "node:test";
import assert from "node:assert/strict";
import { getStaticFeed } from "../public/js/fast-data.js";
const data = { services: [], stops: [], validDates: [] };
const response = () =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

test("重複した検索・事前取得を共有し、1つの検索を中断しても他画面の取得は続ける", async (t) => {
  const saved = globalThis.fetch;
  t.after(() => (globalThis.fetch = saved));
  let count = 0,
    finish;
  globalThis.fetch = () => {
    count++;
    return new Promise((resolve) => (finish = () => resolve(response())));
  };
  const first = getStaticFeed("subway", "2098-01-01"),
    controller = new AbortController(),
    cancelled = getStaticFeed("subway", "2098-01-01", {
      signal: controller.signal,
    });
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  finish();
  assert.deepEqual(await first, data);
  assert.deepEqual(await getStaticFeed("subway", "2098-01-01"), data);
  assert.equal(count, 1);
});
test("取得失敗をキャッシュせず再試行できる。5分後には同じ日付でも再取得する", async (t) => {
  const saved = globalThis.fetch,
    now = Date.now;
  t.after(() => {
    globalThis.fetch = saved;
    Date.now = now;
  });
  let count = 0,
    time = now();
  Date.now = () => time;
  globalThis.fetch = async () => {
    count++;
    return count === 1 ? new Response("{}", { status: 503 }) : response();
  };
  await assert.rejects(getStaticFeed("subway", "2098-01-02"), /503/);
  await getStaticFeed("subway", "2098-01-02");
  assert.equal(count, 2);
  await getStaticFeed("subway", "2098-01-02");
  assert.equal(count, 2);
  time += 300001;
  await getStaticFeed("subway", "2098-01-02");
  assert.equal(count, 3);
});
test("別日検索を繰り返しても取得キャッシュを無制限に保持しない", async (t) => {
  const saved = globalThis.fetch;
  t.after(() => (globalThis.fetch = saved));
  let count = 0;
  globalThis.fetch = async () => {
    count++;
    return response();
  };
  for (let i = 1; i <= 18; i++)
    await getStaticFeed("citybus", `2098-02-${String(i).padStart(2, "0")}`);
  await getStaticFeed("citybus", "2098-02-01");
  assert.equal(count, 19);
});
