import test from "node:test";
import assert from "node:assert/strict";
import { cachedOperationInformation } from "../worker/operations.js";

function fakeCache() {
  const store = new Map();
  return {
    store,
    async match(request) {
      const body = store.get(request.url);
      return body ? new Response(body) : undefined;
    },
    async put(request, response) {
      store.set(request.url, await response.text());
    },
  };
}
const page = () =>
  new Response("<html><body>通常通り運行しています</body></html>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

test("operations come from a fresh snapshot without fetching", async () => {
  const cache = fakeCache();
  globalThis.caches = { default: cache };
  let fetches = 0;
  const fetcher = async () => (fetches++, page());
  const first = await cachedOperationInformation(fetcher, null);
  assert.equal(first.kind, "operations");
  const before = fetches;
  const second = await cachedOperationInformation(fetcher, null);
  assert.equal(fetches, before, "fresh snapshot is served from the cache");
  assert.equal(second.fetchedAt, first.fetchedAt);
});

test("a stale snapshot is returned at once and refreshed in the background", async () => {
  const cache = fakeCache();
  globalThis.caches = { default: cache };
  const fetcher = async () => page();
  const old = await cachedOperationInformation(fetcher, null);
  const pending = [];
  const later = Date.parse(old.fetchedAt) + 5 * 60_000;
  const served = await cachedOperationInformation(fetcher, { waitUntil: (p) => pending.push(p) }, later);
  assert.equal(served.revalidating, true);
  assert.equal(served.fetchedAt, old.fetchedAt);
  assert.equal(pending.length, 1);
  await Promise.all(pending);
});
