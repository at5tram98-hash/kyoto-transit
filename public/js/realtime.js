import { ui } from "./locale.js";
import { CAPTURE_API } from './live.js';

export const ARRIVAL_INTERVAL = 20000;
export const LIVE_MAX_AGE = 90000;
export const USER_STALE_WARNING_AGE = 300000;
export const FETCH_TIMEOUT = 4000;
const DB = 'mymap-live-v1',
  STORE = 'cache';
const logs = new Map();
const memoryCache = new Map(),
  inflight = new Map();
let databasePromise = null;

export const decayDelay = (delay, followingTrips = 0) =>
  Number.isFinite(delay) ? delay * 0.5 ** Math.max(0, followingTrips) : null;
export const isFresh = (asOf, limit = LIVE_MAX_AGE, now = Date.now()) => {
  const t = typeof asOf === 'number' ? asOf : Date.parse(asOf);
  return Number.isFinite(t) && t <= now + 5000 && now - t <= limit;
};
export function freshnessNotice(
  data,
  { initial = false, warnAge = USER_STALE_WARNING_AGE, now = Date.now() } = {},
) {
  if (!data || initial) return { show: false, text: '' };
  const raw = data.asOf ?? data.capturedAt ?? data.sourceUpdatedAt,
    t = typeof raw === 'number' ? raw : Date.parse(raw),
    age = Number.isFinite(t) ? Math.max(0, now - t) : null;
  if (Number.isFinite(age) && age > warnAge)
    return { show: true, text: ui('data_stale') };
  return { show: false, text: '' };
}
export function predictedMinutes(eta, now = Date.now()) {
  const t = typeof eta === 'number' ? eta : Date.parse(eta);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now) / 60000)) : null;
}

export class Backoff {
  constructor(steps = [2000, 4000, 8000, 30000]) {
    this.steps = steps;
    this.index = 0;
  }
  fail() {
    const v = this.steps[Math.min(this.index, this.steps.length - 1)];
    this.index = Math.min(this.index + 1, this.steps.length - 1);
    return v;
  }
  success() {
    this.index = 0;
  }
  peek() {
    return this.steps[Math.min(this.index, this.steps.length - 1)];
  }
}

function remember(key, value) {
  memoryCache.delete(key);
  memoryCache.set(key, value);
  if (memoryCache.size > 128)
    memoryCache.delete(memoryCache.keys().next().value);
  return value;
}
function openDB() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };
      db.onclose = () => {
        databasePromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      databasePromise = null;
      reject(req.error);
    };
  });
  return databasePromise;
}
async function access(mode, key, value) {
  if (!('indexedDB' in globalThis)) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode),
      store = tx.objectStore(STORE),
      req = mode === 'readonly' ? store.get(key) : store.put(value, key);
    let out = null;
    req.onsuccess = () => (out = req.result);
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function getCached(key) {
  if (memoryCache.has(key)) return memoryCache.get(key);
  const value = await access('readonly', key).catch(() => null);
  if (value) remember(key, value);
  return value;
}
export async function putCached(key, value) {
  remember(key, value);
  return access('readwrite', key, value).catch(() => null);
}

export function realtimeLog() {
  return [...logs.entries()].map(([key, v]) => ({ key, ...v }));
}
function note(key, patch) {
  logs.set(key, { ...(logs.get(key) ?? {}), ...patch });
  globalThis.window?.dispatchEvent?.(new CustomEvent('mymap-realtime-log'));
}
function endpoint(path, params = {}) {
  const u = new URL(path, CAPTURE_API);
  for (const [k, v] of Object.entries(params))
    if (v !== null && v !== undefined && v !== '') u.searchParams.set(k, v);
  return u;
}
const diagnosticPatch = (data) =>
  data?.diagnostic
    ? {
        diagnostic: data.diagnostic,
        error: data.diagnostic.message ?? data.diagnostic.code ?? null,
      }
    : { diagnostic: null, error: null };

export function fetchRealtime(key, path, params = {}, options = {}) {
  // Caller-owned cancellation stays isolated; shared reads coalesce by URL.
  if (options.signal) return requestRealtime(key, path, params, options);
  const requestKey = `${key}|${endpoint(path, params).href}`;
  if (inflight.has(requestKey)) return inflight.get(requestKey);
  const pending = requestRealtime(key, path, params, options).finally(() =>
    inflight.delete(requestKey),
  );
  inflight.set(requestKey, pending);
  return pending;
}
async function requestRealtime(key, path, params = {}, options = {}) {
  const timeout = options.timeout ?? FETCH_TIMEOUT,
    cached = await getCached(key),
    headers = { Accept: 'application/json' };
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    note(key, {
      source: 'prediction',
      online: false,
      error: 'offline',
      freshness: cached?.data?.asOf ?? cached?.savedAt ?? null,
    });
    const e = Error('offline');
    e.code = 'offline';
    e.cached = cached;
    throw e;
  }
  const controller = new AbortController(),
    timer = setTimeout(
      () =>
        controller.abort(
          new DOMException('通信がタイムアウトしました', 'TimeoutError'),
        ),
      timeout,
    ),
    abort = () => controller.abort(options.signal?.reason);
  const started = Date.now();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const r = await fetch(endpoint(path, params), {
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (r.status === 304 && cached?.data) {
      note(key, {
        source: cached.data.source ?? 'live',
        online: true,
        status: 304,
        latency: Date.now() - started,
        freshness: cached.data.asOf ?? cached.savedAt,
        ...diagnosticPatch(cached.data),
      });
      return cached.data;
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok)
      throw Object.assign(Error(`HTTP ${r.status}`), {
        status: r.status,
        code: data.code,
        detail: data.error,
      });
    const saved = { data, etag: r.headers.get('ETag'), savedAt: Date.now() };
    await putCached(key, saved);
    note(key, {
      source: data.source ?? (data.stale ? 'prediction' : 'live'),
      online: true,
      status: r.status,
      latency: Date.now() - started,
      freshness: data.asOf ?? data.capturedAt ?? saved.savedAt,
      ...diagnosticPatch(data),
    });
    return data;
  } catch (error) {
    const e = error instanceof Error ? error : Error(String(error));
    note(key, {
      source: 'prediction',
      online:
        typeof navigator === 'undefined' ? true : navigator.onLine !== false,
      status: e.status ?? 0,
      latency: Date.now() - started,
      error: e.name === 'TimeoutError' ? 'timeout' : String(e.message ?? e),
      diagnostic: typeof e.code === 'string' ? { code: e.code } : null,
      freshness: cached?.data?.asOf ?? cached?.savedAt ?? null,
    });
    e.cached = cached;
    throw e;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

export function predictCityBus(data, now = Date.now()) {
  if (!data) return null;
  return {
    ...data,
    stale: true,
    source: 'prediction',
    results: (data.results ?? []).map((r) => {
      const minutes = predictedMinutes(r.eta, now);
      return {
        ...r,
        minutes: Number.isFinite(minutes) ? minutes : r.minutes,
        source: 'prediction',
      };
    }),
  };
}
export function predictRail(data, now = Date.now()) {
  if (!data) return null;
  const asOf = Date.parse(data.asOf ?? data.sourceUpdatedAt ?? data.capturedAt),
    age = Number.isFinite(asOf) ? Math.max(0, (now - asOf) / 60000) : 0;
  return {
    ...data,
    stale: true,
    source: 'prediction',
    trains: (data.trains ?? []).map((t) => {
      const dir = t.direction === 'north' ? -1 : 1,
        advance = Math.min(6, age / 1.5) * dir,
        pos = Math.max(1, Math.min(51, (Number(t.position) || 1) + advance));
      return { ...t, position: pos, predicted: true };
    }),
  };
}
const recoveringFromPrediction = (data) =>
  Boolean(
    data &&
      (data.stale ||
        data.source === 'prediction' ||
        data.trains?.some((t) => t.predicted) ||
        data.results?.some((r) => r.source === 'prediction')),
  );
export function interpolateCityBusRecovery(previous, actual, fraction = 0.65) {
  if (
    !recoveringFromPrediction(previous) ||
    !actual ||
    actual.stale ||
    actual.source === 'prediction'
  )
    return actual;
  const old = new Map((previous.results ?? []).map((r) => [String(r.key), r]));
  return {
    ...actual,
    recovering: true,
    results: (actual.results ?? []).map((r) => {
      const p = old.get(String(r.key));
      if (!p || !Number.isFinite(p.minutes) || !Number.isFinite(r.minutes))
        return r;
      return {
        ...r,
        minutes: Math.max(
          0,
          Math.round((p.minutes + (r.minutes - p.minutes) * fraction) * 10) /
            10,
        ),
        recovering: true,
      };
    }),
  };
}
const railSignature = (t) =>
  `${t.direction ?? ''}|${t.category ?? ''}|${t.dest ?? t.destination ?? ''}|${t.label ?? ''}`;
export function interpolateRailRecovery(previous, actual, fraction = 0.6) {
  if (
    !recoveringFromPrediction(previous) ||
    !actual ||
    actual.stale ||
    actual.source === 'prediction'
  )
    return actual;
  const pool = (previous.trains ?? []).map((t, i) => ({ t, i, used: false }));
  const trains = (actual.trains ?? []).map((t) => {
    const pos = Number(t.position);
    if (!Number.isFinite(pos)) return t;
    const matches = pool
        .filter(
          (p) =>
            !p.used &&
            railSignature(p.t) === railSignature(t) &&
            Number.isFinite(Number(p.t.position)),
        )
        .sort(
          (a, b) =>
            Math.abs(Number(a.t.position) - pos) -
            Math.abs(Number(b.t.position) - pos),
        ),
      match = matches[0];
    if (!match || Math.abs(Number(match.t.position) - pos) > 12) return t;
    match.used = true;
    return {
      ...t,
      position:
        Number(match.t.position) + (pos - Number(match.t.position)) * fraction,
      recovering: true,
      predicted: false,
    };
  });
  return { ...actual, recovering: true, trains };
}

export function createLiveLoop({
  run,
  active = () => true,
  interval = ARRIVAL_INTERVAL,
  schedule: setTimer = setTimeout,
  cancel: clearTimer = clearTimeout,
}) {
  let timer = null,
    stopped = true,
    running = false,
    pending = false;
  const backoff = new Backoff();
  const schedule = (ms) => {
    clearTimer(timer);
    timer = null;
    if (!stopped && active()) timer = setTimer(tick, ms);
  };
  async function tick() {
    timer = null;
    if (stopped || !active() || running) return;
    running = true;
    let delay = interval;
    try {
      await run();
      backoff.success();
    } catch {
      delay = backoff.fail();
    } finally {
      running = false;
      const immediate = pending;
      pending = false;
      schedule(immediate ? 0 : delay);
    }
  }
  function poke() {
    if (stopped || !active()) return;
    if (running) {
      pending = true;
      return;
    }
    schedule(0);
  }
  const onOnline = poke,
    onVisibility = () => {
      if (active()) poke();
      else {
        clearTimer(timer);
        timer = null;
        pending = false;
      }
    };
  return {
    start() {
      if (!stopped) return;
      stopped = false;
      globalThis.addEventListener?.('online', onOnline);
      globalThis.document?.addEventListener?.('visibilitychange', onVisibility);
      poke();
    },
    stop() {
      stopped = true;
      pending = false;
      clearTimer(timer);
      timer = null;
      globalThis.removeEventListener?.('online', onOnline);
      globalThis.document?.removeEventListener?.(
        'visibilitychange',
        onVisibility,
      );
    },
    poke,
    get backoff() {
      return backoff.peek();
    },
  };
}
