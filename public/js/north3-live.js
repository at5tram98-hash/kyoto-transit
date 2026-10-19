import { CAPTURE_API } from "./live.js";
import { state } from "./vnext-state.js";
import {
  groupCityBusRows,
  busArrivalText,
  busDirectionLabel,
} from "./arrival-stability.js";
import { updateHTML } from "./view-rendering.js";
import { navigation } from "./navigation.js";
import { isFresh } from "./realtime.js";

const cache = new Map();
const jobs = new Map();
const attempts = new WeakMap();
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const isNorth3 = (route) =>
  /^(北3|北３|N030)$/i.test(String(route ?? "").replace(/\s|系統/g, ""));

async function arrivals(stopName) {
  if (jobs.has(stopName)) return jobs.get(stopName);
  const job = readArrivals(stopName).finally(() => jobs.delete(stopName));
  jobs.set(stopName, job);
  return job;
}
async function readArrivals(stopName) {
  const old = cache.get(stopName);
  if (old && Date.now() - old.at < 15000) return old.data;
  const url = new URL("/api/citybus/arrivals", CAPTURE_API);
  url.searchParams.set("stop", stopName);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(4500),
    cache: "no-store",
  });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const data = await response.json();
  cache.set(stopName, { at: Date.now(), data });
  return data;
}

async function enrichRow(row) {
  if (
    document.hidden ||
    state.tab !== "now" ||
    navigation.route.type !== "root"
  )
    return;
  const stop = state.network?.stops?.get(row.dataset.nearbyDetail);
  if (!stop?.lines?.includes("北3") || row.dataset.north3LiveBusy === "true")
    return;
  if (Date.now() - (attempts.get(row) ?? 0) < 15000) return;
  attempts.set(row, Date.now());
  row.dataset.north3LiveBusy = "true";
  try {
    const data = await arrivals(stop.fullName ?? stop.name);
    if (!row.isConnected) return;
    const rows = groupCityBusRows(data.results ?? [])
      .filter((item) => isNorth3(item.route))
      .slice(0, 2);
    if (!rows.length) return;
    row.parentElement
      ?.querySelector(`.north3-inline[data-for="${CSS.escape(stop.id)}"]`)
      ?.remove();
    let box = row.parentElement?.querySelector(
      `.north3-live[data-for="${CSS.escape(stop.id)}"]`,
    );
    const created = !box;
    box ??= document.createElement("div");
    box.className = "nearby-departures compact-departures north3-live";
    box.dataset.for = stop.id;
    const observed =
      data.source === "live" && !data.stale && isFresh(data.asOf);
    updateHTML(
      box,
      rows
        .map(
          (item) =>
            `<div><span><b>北3</b> · ${esc(busDirectionLabel(item.route, item.dest))}</span><b>${esc(busArrivalText({ ...item, arrivals: item.arrivals?.slice(0, 1) }))}<small>${observed ? "接近・実測" : "接近・予測"}</small></b></div>`,
        )
        .join(""),
    );
    if (created) row.after(box);
  } catch {
    // The saved official timetable already rendered by the core remains visible.
  } finally {
    row.dataset.north3LiveBusy = "false";
  }
}

function scan() {
  document
    .querySelectorAll(".nearby-guide .nearby-row[data-nearby-detail]")
    .forEach((row) => void enrichRow(row));
}

export function installNorth3Live() {
  const root = document.querySelector("#nearby-panel");
  if (!root) return;
  new MutationObserver(scan).observe(root, { childList: true, subtree: true });
  scan();
  setInterval(() => {
    if (!document.hidden && state.tab === "now") scan();
  }, 15000);
}
