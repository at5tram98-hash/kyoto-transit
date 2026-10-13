const quotaPattern = /(?:KV\s*put\(\)\s*limit\s*exceeded|KV[^\n]*(?:write|put)[^\n]*(?:quota|limit)|(?:quota|limit)[^\n]*KV[^\n]*(?:write|put))/i;
const wrappers = new WeakMap();

export function isKvWriteQuotaError(error) {
  const message = String(error?.message ?? error ?? "");
  return quotaPattern.test(message);
}

function nextUtcReset(now) {
  const d = new Date(now);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
    0,
    5,
    0,
    0,
  );
}

export function bestEffortKv(kv, { now = Date.now, warn = console.warn } = {}) {
  if (!kv || typeof kv.put !== "function") return kv;
  if (wrappers.has(kv)) return wrappers.get(kv);

  let writeDisabledUntil = 0;
  let quotaWarningEmitted = false;

  const safe = new Proxy(kv, {
    get(target, property) {
      if (property === "put") {
        return async (...args) => {
          if (now() < writeDisabledUntil) return undefined;
          try {
            return await target.put(...args);
          } catch (error) {
            if (!isKvWriteQuotaError(error)) throw error;
            writeDisabledUntil = nextUtcReset(now());
            if (!quotaWarningEmitted) {
              quotaWarningEmitted = true;
              warn(
                "LIVE_KV write quota is exhausted; realtime responses will continue without persistence until the next UTC reset.",
              );
            }
            return undefined;
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  wrappers.set(kv, safe);
  return safe;
}

export function withBestEffortKv(env) {
  if (!env?.LIVE_KV) return env;
  const liveKv = bestEffortKv(env.LIVE_KV);
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "LIVE_KV") return liveKv;
      return Reflect.get(target, property, receiver);
    },
  });
}
