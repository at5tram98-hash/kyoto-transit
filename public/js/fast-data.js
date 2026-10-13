import { CAPTURE_API } from "./live.js";
import { tokyoNow } from "./vnext-state.js";

const OPERATIONS_CACHE_KEY = "mymap-operations-cache-v2";
const feedJobs = new Map();
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

export function getStaticFeed(operator, date = tokyoNow().date) {
  const key = `${operator}:${date}`;
  if (!feedJobs.has(key))
    feedJobs.set(
      key,
      fetchJSON("/api/static/feed", { operator, date }).catch((error) => {
        feedJobs.delete(key);
        throw error;
      }),
    );
  return feedJobs.get(key);
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
    const value = JSON.parse(localStorage.getItem(OPERATIONS_CACHE_KEY) || "null");
    if (!value?.data || Date.now() - Number(value.savedAt) > maxAge) return null;
    return value.data;
  } catch {
    return null;
  }
}

export function renderCachedOperations(root) {
  const data = readOperationsCache();
  if (!root || !data?.lines?.length) return false;
  root.innerHTML = `<div class="operations-head"><span>直前に取得した運行情報</span><span class="source-caption">更新中</span></div><div class="native-list">${data.lines
    .map(
      (line) =>
        `<button class="native-row" data-operation-id="${esc(line.id)}"><span><b>${esc(line.name)}</b><small>${esc(line.summary)}</small></span><span class="chevron">›</span></button>`,
    )
    .join("")}</div>`;
  return true;
}

export function installFastData() {
  const warm = () => {
    const date = tokyoNow().date;
    Promise.allSettled([
      getStaticFeed("subway", date),
      getStaticFeed("kintetsu", date),
      getStaticFeed("citybus", date),
      getStaticFeed("kyotobus", date),
      getOperations(),
    ]).catch(() => {});
  };
  if ("requestIdleCallback" in globalThis)
    requestIdleCallback(warm, { timeout: 2500 });
  else setTimeout(warm, 700);

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
