import { ui } from "./locale.js";
import { CAPTURE_API } from "./live.js";
import { tokyoNow } from "./vnext-state.js";

const OPERATIONS_CACHE_KEY = "mymap-operations-cache-v2";
const feedJobs = new Map();
const FEED_TTL = 5 * 60 * 1000;
let operationsJob = null;

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

async function fetchJSON(path, params = {}, timeout = 6500) {
  const url = new URL(path, CAPTURE_API);
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function getStaticFeed(
  operator,
  date = tokyoNow().date,
  { signal, force = false } = {},
) {
  const key = `${operator}:${date}`;
  if (force && feedJobs.get(key)?.pending === false) feedJobs.delete(key);
  if (feedJobs.has(key) && Date.now() - feedJobs.get(key).started > FEED_TTL)
    feedJobs.delete(key);
  if (!feedJobs.has(key)) {
    const entry = { started: Date.now(), promise: null, pending: true };
    entry.promise = fetchJSON(
      "/api/static/feed",
      { operator, date },
      4000,
    ).catch((error) => {
      if (feedJobs.get(key) === entry) feedJobs.delete(key);
      throw error;
    }).finally(() => { entry.pending = false; });
    feedJobs.set(key, entry);
  }
  const job = feedJobs.get(key).promise;
  while (feedJobs.size > 16) feedJobs.delete(feedJobs.keys().next().value);
  if (!signal) return job;
  // Cancelling a search must not abort a feed shared by another screen.
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    job.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export function getKintetsuFeed(date = tokyoNow().date) {
  return getStaticFeed("kintetsu", date);
}

export function getOperations() {
  if (!operationsJob)
    operationsJob = fetchJSON("/operations")
      .then((data) => {
        try {
          localStorage.setItem(
            OPERATIONS_CACHE_KEY,
            JSON.stringify({ savedAt: Date.now(), data }),
          );
        } catch {}
        return data;
      })
      .finally(() => {
        operationsJob = null;
      });
  return operationsJob;
}

export function readOperationsCache(maxAge = 10 * 60 * 1000) {
  try {
    const value = JSON.parse(
      localStorage.getItem(OPERATIONS_CACHE_KEY) || "null",
    );
    if (!value?.data || Date.now() - Number(value.savedAt) > maxAge)
      return null;
    return value.data;
  } catch {
    return null;
  }
}

export function renderCachedOperations(root) {
  const data = readOperationsCache();
  if (!root || !data?.lines?.length) return false;
  root.innerHTML = `<div class="operations-head"><span>${esc(ui("operations_cached"))}</span><span class="source-caption">${esc(ui("operations_updating"))}</span></div><div class="native-list">${data.lines
    .map(
      (line) =>
        `<button class="native-row" data-operation-id="${esc(line.id)}"><span><b>${esc(line.name)}</b><small>${esc(line.summary)}</small></span><span class="chevron">›</span></button>`,
    )
    .join("")}</div>`;
  return true;
}

export function installFastData() {
  let leaving = false,
    pending = true,
    timer = null;
  const usesIdle = "requestIdleCallback" in globalThis;
  const cancel = () => {
    if (timer !== null) {
      if (usesIdle) cancelIdleCallback(timer);
      else clearTimeout(timer);
      timer = null;
    }
  };
  const warm = () => {
    timer = null;
    if (leaving || document.hidden) return;
    pending = false;
    const date = tokyoNow().date;
    Promise.allSettled([
      getStaticFeed("subway", date),
      getStaticFeed("kintetsu", date),
      getStaticFeed("citybus", date),
      getStaticFeed("kyotobus", date),
      getOperations(),
    ]).catch(() => {});
  };
  const schedule = () => {
    if (!pending || leaving || document.hidden || timer !== null) return;
    timer = usesIdle
      ? requestIdleCallback(warm, { timeout: 2500 })
      : setTimeout(warm, 700);
  };
  const suspend = () => {
    leaving = true;
    cancel();
  };
  // A queued warm-up can fire after beforeunload, while WebKit still reports
  // the old document as visible. Never start background requests in that gap.
  window.addEventListener("beforeunload", suspend);
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", () => {
    leaving = false;
    schedule();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancel();
    else schedule();
  });
  schedule();

  document.addEventListener(
    "pointerdown",
    (event) => {
      const button = event.target.closest?.('[data-tab="operations"]');
      if (!button) return;
      renderCachedOperations(document.querySelector("#operations-root"));
      void getOperations().catch(() => {});
    },
    true,
  );
}
