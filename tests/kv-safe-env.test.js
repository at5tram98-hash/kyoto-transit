import test from "node:test";
import assert from "node:assert/strict";
import {
  bestEffortKv,
  isKvWriteQuotaError,
  withBestEffortKv,
} from "../worker/kv-safe-env.js";

test("KV write quota exhaustion does not break realtime reads", async () => {
  let now = Date.UTC(2026, 9, 13, 23, 45),
    puts = 0,
    throwQuota = true,
    warnings = 0;
  const kv = {
    async get(key) {
      return `cached:${key}`;
    },
    async put() {
      puts++;
      if (throwQuota) throw Error("KV put() limit exceeded for the day.");
      return "stored";
    },
  };
  const safe = bestEffortKv(kv, {
    now: () => now,
    warn: () => warnings++,
  });

  assert.equal(await safe.put("citybus:test", "fresh"), undefined);
  assert.equal(puts, 1);
  assert.equal(warnings, 1);
  assert.equal(await safe.get("citybus:test"), "cached:citybus:test");

  await safe.put("citybus:test", "fresh-again");
  assert.equal(puts, 1, "writes stay circuit-broken for the exhausted UTC day");
  assert.equal(warnings, 1);

  throwQuota = false;
  now = Date.UTC(2026, 9, 14, 0, 6);
  assert.equal(await safe.put("citybus:test", "next-day"), "stored");
  assert.equal(puts, 2);
});

test("non-quota KV failures still surface", async () => {
  const kv = {
    async put() {
      throw Error("network storage failure");
    },
  };
  const safe = bestEffortKv(kv, { warn: () => {} });
  await assert.rejects(() => safe.put("x", "y"), /network storage failure/);
});

test("environment wrapper replaces only LIVE_KV behavior", async () => {
  const env = {
    APP_ORIGIN: "https://example.test",
    LIVE_KV: {
      async get() {
        return "ok";
      },
      async put() {
        throw Error("KV put() limit exceeded for the day.");
      },
    },
  };
  const wrapped = withBestEffortKv(env);
  assert.equal(wrapped.APP_ORIGIN, env.APP_ORIGIN);
  assert.equal(await wrapped.LIVE_KV.get("key"), "ok");
  assert.equal(await wrapped.LIVE_KV.put("key", "value"), undefined);
  assert.ok(isKvWriteQuotaError(Error("KV put() limit exceeded for the day.")));
});
