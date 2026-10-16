import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/entry.js";

const origin = "https://at5tram98-hash.github.io";
const payload = { source: "live", stale: false, trains: [{ key: "train" }] };
const env = {
  APP_ORIGIN: origin,
  LIMIT: { limit: async () => ({ success: true }) },
};
function cached(t, response) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      default: {
        match: async () => response,
        put: async () => assert.fail("A cache hit must not fetch or rewrite data"),
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "caches", original);
    else delete globalThis.caches;
  });
}
const request = (headers = {}) =>
  new Request("https://worker.example/api/rail/live", {
    headers: { Origin: origin, ...headers },
  });

test("cached rail JSON with immutable headers still receives CORS without mutating the cached response", async (t) => {
  // Fetch responses have the same immutable header guard as Cache API hits.
  const hit = await fetch(
    `data:application/json,${encodeURIComponent(JSON.stringify(payload))}`,
  );
  assert.throws(() => hit.headers.set("X-Probe", "test"), TypeError);
  cached(t, hit);
  const response = await worker.fetch(request(), env, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.deepEqual(await response.json(), payload);
  assert.equal(hit.headers.get("Access-Control-Allow-Origin"), null);
});

test("conditional cache hits preserve 304, ETag, empty body and CORS", async (t) => {
  cached(
    t,
    Response.json(payload, {
      headers: { ETag: '"rail-version"', "Cache-Control": "public, max-age=12" },
    }),
  );
  const response = await worker.fetch(
    request({ "If-None-Match": '"rail-version"' }),
    env,
    {},
  );
  assert.equal(response.status, 304);
  assert.equal(response.headers.get("ETag"), '"rail-version"');
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(await response.text(), "");
});
