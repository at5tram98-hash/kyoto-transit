import { ui } from "./locale.js";
import { scheduledArrivalFallbacks } from "./arrival-schedule.js";
import { getStaticFeed } from "./fast-data.js";
import { mergeTimetableFeeds } from "./search-core.js";
import { navigation } from "./navigation.js";
import { searchStops } from "./network.js";
import {
  $,
  esc,
  icon,
  state,
  nearest,
  toast,
  tokyoNow,
} from "./vnext-state.js";
import {
  ARRIVAL_INTERVAL,
  LIVE_MAX_AGE,
  getCached,
  fetchRealtime,
  predictCityBus,
  predictRail,
  isFresh,
  freshnessNotice,
  createLiveLoop,
  realtimeLog,
  interpolateCityBusRecovery,
  interpolateRailRecovery,
} from "./realtime.js";
import { CAPTURE_API } from "./live.js";
import { buildRailArrivalRows } from "./rail-arrivals-core.js";
import {
  groupCityBusRows,
  busServiceKey,
  busServiceLabel,
  busArrivalText,
  busArrivalEpoch,
  busCongestionText,
  shouldShowKintetsuArrival,
  normalizedBusSources,
  busPreviewRows,
} from "./arrival-stability.js";
import { updateArrivalRows, updateHTML } from "./view-rendering.js";

const STORE = "mymap-arrivals-v3";
const saved = () => {
  try {
    const value = JSON.parse(localStorage.getItem(STORE) || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
};
const persist = (value) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(value));
  } catch {}
};
const cityStops = (network) =>
  [...network.stops.values()].filter((s) => s.type === "citybus");
const stopName = (stop) => stop?.fullName ?? stop?.name ?? "";
const sourceDot = (source) =>
  `<i class="source-dot ${source === "live" ? "live" : source === "prediction" ? "prediction" : "schedule"}" aria-hidden="true"></i>`;
const delayText = (d) =>
  Number.isFinite(d)
    ? Math.abs(Math.round(d)) < 1
      ? ui("vnext_arrivals_001")
      : ui("vnext_arrivals_041", [
          Math.abs(Math.round(d)),
          d > 0 ? ui("vnext_arrivals_002") : ui("vnext_arrivals_003"),
        ])
    : "—";
const minuteText = (r) =>
  Number.isFinite(r.minutes)
    ? ui("vnext_arrivals_004", [Math.max(0, Math.round(r.minutes))])
    : (r.status ?? "—");
const sourceLabel = (source) =>
  source === "live"
    ? ui("vnext_arrivals_005")
    : source === "prediction"
      ? ui("vnext_arrivals_006")
      : ui("vnext_arrivals_007");
const timestamp = (value) =>
  typeof value === "number" ? value : Date.parse(value);
const updateTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
});

function arrivalValue(r) {
  if (Number.isFinite(r.minutes))
    return ui("vnext_arrivals_008", [
      esc(minuteText(r)),
      Math.max(0, Math.round(r.minutes)),
    ]);
  if (Number.isFinite(r.stopsAway))
    return ui("vnext_arrivals_009", [Math.max(0, Math.round(r.stopsAway))]);
  const scheduled = r.scheduledDeparture ?? r.depart;
  if (Number.isFinite(scheduled))
    return ui("vnext_arrivals_010", [
      String(Math.floor(scheduled / 60) % 24).padStart(2, "0"),
      String(scheduled % 60).padStart(2, "0"),
    ]);
  return `<span class="arrival-unconfirmed">${esc(r.status === "時刻未確定" || !r.status ? ui("vnext_arrivals_011") : r.status)}</span>`;
}
export function busRow(r) {
  const arrivals = (r.arrivals ?? [r]).slice(0, 2),
    primary = arrivals[0],
    congestion = busCongestionText(r),
    observed = arrivals.find((a) => Number.isFinite(a.stopsAway)),
    source = (a) =>
      `<span class="arrival-source-label">${sourceDot(a.source)}${a.scheduleStale ? ui("vnext_arrivals_012") : sourceLabel(a.source)}${Number.isFinite(timestamp(a.asOf)) ? ui("vnext_arrivals_013", [updateTime.format(timestamp(a.asOf))]) : ""}</span>`;
  return {
    operator: "citybus",
    delayed: r.delay > 0,
    imminent:
      primary.source === "live" &&
      ((Number.isFinite(primary.stopsAway) && primary.stopsAway <= 1) ||
        (Number.isFinite(primary.minutes) && primary.minutes <= 1)),
    service: `<b class="arrival-route-badge" aria-label="${esc(busServiceLabel(r))}" title="${esc(busServiceLabel(r))}">${esc(r.route)}</b>`,
    destination: `<b>${esc(r.dest || ui("vnext_arrivals_014"))}</b>`,
    minutes: arrivalValue(primary),
    second: arrivals[1]
      ? ui("vnext_arrivals_015", [arrivalValue(arrivals[1])])
      : "",
    delay: Number.isFinite(r.delay)
      ? ui("vnext_arrivals_016", [
          esc(delayText(r.delay)),
          esc(delayText(r.delay)),
        ])
      : "",
    details: `${r.boarding ? `<span>${esc(r.boarding)}</span>` : ""}${congestion !== "—" ? `<span>${esc(congestion)}</span>` : ""}`,
    source: `${source(primary)}${arrivals[1] && (arrivals[1].source !== primary.source || arrivals[1].asOf !== primary.asOf) ? ui("vnext_arrivals_017", [source(arrivals[1])]) : ""}`,
    // Animate only an observed stop count; never derive minutes from it.
    stopsAway: observed?.stopsAway,
    approachLabel:
      observed?.source === "live"
        ? ui("vnext_arrivals_018")
        : ui("vnext_arrivals_019"),
  };
}
function railRow(r) {
  return {
    operator: "kintetsu",
    delayed: r.delay > 0,
    service: `<b class="arrival-rail-badge">${esc(r.label ?? r.category ?? ui("vnext_arrivals_020"))}</b>`,
    destination: `<b>${esc(r.dest ?? ui("vnext_arrivals_021"))}</b>`,
    minutes: arrivalValue(r),
    delay: Number.isFinite(r.delay)
      ? ui("vnext_arrivals_022", [
          esc(delayText(r.delay)),
          esc(delayText(r.delay)),
        ])
      : "",
    details: "",
    source: `<span class="arrival-source-label">${sourceDot(r.source)}${sourceLabel(r.source)}${Number.isFinite(timestamp(r.asOf)) ? ui("vnext_arrivals_023", [updateTime.format(timestamp(r.asOf))]) : ""}</span>`,
  };
}
function stale(data, limit = LIVE_MAX_AGE) {
  return (
    navigator.onLine === false ||
    Boolean(data?.stale) ||
    !isFresh(data?.asOf, limit)
  );
}
function applyNotice(el, data, { initial = false } = {}) {
  const n = freshnessNotice(data, { initial });
  el.hidden = !n.show;
  el.textContent = n.text;
}
function kintetsuNear() {
  return nearest().all.find((x) => x.stop.type === "kintetsu") ?? null;
}
function railContext() {
  const near = kintetsuNear();
  return {
    visible: shouldShowKintetsuArrival({
      locationStatus: state.location?.status,
      rideOperator: state.ride?.operator,
      kintetsuMeters: near?.meters,
    }),
    near,
  };
}
function railTarget() {
  const { visible, near } = railContext();
  if (!visible) return null;
  if (near?.meters <= 500) return near.id;
  if (["kintetsu", "through"].includes(state.ride?.operator)) {
    const candidate = [state.ride?.from, state.ride?.to].find(
      (id) => state.network?.stops.get(id)?.type === "kintetsu",
    );
    return candidate ?? "K15";
  }
  return null;
}
function normalizeRail(data, timetable = null, nowMinute = null) {
  if (!data) return null;
  const target = railTarget();
  if (!target) return { ...data, target: null, results: [] };
  const predicted = stale(data) ? predictRail(data) : data,
    results = buildRailArrivalRows(predicted, timetable, target, nowMinute);
  return { ...predicted, target, results };
}

export function compactBusHTML(data, { stopId } = {}) {
  const rows = busPreviewRows(data);
  if (!rows.length) return "";
  const clock = (minute) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const arrival = r => {
    const eta = busArrivalEpoch(r);
    if (Number.isFinite(eta))
      return eta >= Date.now() - 60000
        ? ui("audit_arrival_at", [updateTime.format(eta)])
        : Number.isFinite(r.stopsAway) ? busArrivalText({...r, minutes: null}) : ui("station_eta_unknown");
    return Number.isFinite(r.scheduledDeparture)
      ? ui("station_scheduled_at", [clock(r.scheduledDeparture)]) : busArrivalText(r);
  };
  return `<div class="arrival-compact">${rows.map((r) => `<${stopId ? `button type="button" data-bus-approach="${esc(busServiceKey(r))}" data-approach-stop="${esc(stopId)}"` : "div"}><b class="arrival-route-badge">${esc(r.route)}</b><span><b>${esc(r.dest)}</b><small>${sourceDot(r.source)}${sourceLabel(r.source)}${r.boarding ? ` · ${esc(r.boarding)}` : ""}</small></span><strong>${esc(arrival(r))}</strong></${stopId ? "button" : "div"}>`).join("")}</div><details class="source-caption"><summary>${ui("audit_freshness")}</summary>${rows.map((r) => `<p>${esc(r.route)} · ${sourceLabel(r.source)}${Number.isFinite(timestamp(r.asOf)) ? ui("vnext_arrivals_024", [updateTime.format(timestamp(r.asOf))]) : ""}</p>`).join("")}</details>`;
}

export function mountArrivals({ network }) {
  const root = $("#arrivals-root");
  let stopId = saved().stopId ?? null,
    busData = null,
    railData = null,
    railSchedule = null,
    railScheduleDate = null,
    railScheduleAt = 0,
    busBusy = false,
    railBusy = false;
  if (network.stops.get(stopId)?.type !== "citybus") stopId = null;
  let busController = null,
    stopVersion = 0,
    shown = false,
    lastRailTarget = null,
    disposed = false,
    busSchedule = null,
    busScheduleDate = null,
    busScheduleJob = null,
    busScheduleController = null,
    railScheduleJob = null,
    awaitingLocation = !stopId && !state.fix;
  root.innerHTML = ui("vnext_arrivals_025", [
    icon("location"),
    icon("refresh"),
  ]);
  const stopEl = () => root.querySelector("#arrival-stop-name"),
    busRoot = () => root.querySelector("#arrival-live"),
    railRoot = () => root.querySelector("#arrival-rail"),
    railCard = () => root.querySelector("#kintetsu-arrival-card");
  root
    .querySelector("#arrival-stop-search")
    .setAttribute("aria-label", ui("vnext_arrivals_026"));
  const stopButton = root.querySelector("[data-arrival-change]");
  stopButton.setAttribute("aria-expanded", "false");
  stopButton.setAttribute("aria-controls", "arrival-stop-picker");
  for (const [card, id] of [
    [root.querySelector(".arrival-card"), "bus-update-status"],
    [railCard(), "rail-update-status"],
  ]) {
    const status = document.createElement("p");
    status.className = "arrival-update-status";
    status.id = id;
    status.textContent = ui("vnext_arrivals_027");
    card.querySelector(".section-heading").after(status);
  }
  const setStatus = (id, data) => {
    const at = Date.parse(data?.asOf),
      text =
        navigator.onLine === false
          ? ui("vnext_arrivals_028")
          : data
            ? `${sourceLabel(data.source)}${Number.isFinite(at) ? ui("vnext_arrivals_029", [updateTime.format(at)]) : ""}`
            : ui("vnext_arrivals_030");
    root.querySelector(`#${id}`).textContent = text;
  };
  const showEmpty = (target, message) =>
    updateHTML(target, ui("vnext_arrivals_031", [icon("bus"), esc(message)]));
  function showLoading() {
    updateHTML(
      busRoot(),
      '<div class="arrival-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>',
    );
    root.querySelector("#bus-update-status").textContent =
      ui("vnext_arrivals_032");
  }
  const currentStop = () => network.stops.get(stopId);
  function updateRailVisibility() {
    const visible = railContext().visible;
    railCard().hidden = !visible;
    return visible;
  }
  function renderStop() {
    stopEl().textContent = currentStop()?.name ?? ui("vnext_arrivals_033");
  }
  function renderSearch(q = "") {
    const items = searchStops(network, q, "bus")
      .filter((s) => s.type === "citybus")
      .slice(0, 24);
    root.querySelector("#arrival-stop-results").innerHTML =
      `<div class="native-list">${items.map((s) => `<button class="native-row" data-arrival-stop="${esc(s.id)}"><span class="mode-symbol bus">${icon("bus")}</span><span><b>${esc(s.name)}</b><small>${esc(s.lines.join("・"))}</small></span><span class="chevron">›</span></button>`).join("")}</div>${!items.length ? ui("vnext_arrivals_034") : ""}`;
  }
  function ensureBusSchedule(rows) {
    const current = tokyoNow();
    if (
      busScheduleDate === current.date ||
      busScheduleJob ||
      !rows.some(
        (r) => !Number.isFinite(r.minutes) && !Number.isFinite(r.stopsAway),
      )
    )
      return;
    const controller = new AbortController();
    busScheduleController = controller;
    busScheduleJob = getStaticFeed("citybus", current.date, {
      signal: controller.signal,
    })
      .then((feed) => {
        if (controller.signal.aborted) return;
        busSchedule = mergeTimetableFeeds(network, [feed], {
          date: current.date,
        });
        busScheduleDate = current.date;
        if (busData && active()) renderBus(busData);
      })
      .catch(() => {})
      .finally(() => {
        if (busScheduleController === controller) {
          busScheduleJob = null;
          busScheduleController = null;
        }
      });
  }
  function renderBus(data, opts = {}) {
    if (!data) {
      setStatus("bus-update-status", null);
      showEmpty(busRoot(), ui("vnext_arrivals_035"));
      return;
    }
    const recovered = interpolateCityBusRecovery(busData, data);
    busData = recovered;
    const base = stale(recovered) ? predictCityBus(recovered) : recovered,
      projected = { ...base, results: normalizedBusSources(base) },
      rows = groupCityBusRows(projected.results ?? []),
      now = tokyoNow(),
      presented =
        busScheduleDate === now.date && busSchedule
          ? scheduledArrivalFallbacks(busSchedule, stopId, rows, {
              date: now.date,
              minute: now.minute,
            })
          : rows;
    ensureBusSchedule(rows);
    applyNotice(root.querySelector("#bus-stale"), projected, opts);
    updateArrivalRows(busRoot(), presented, busRow);
    if (!rows.length) updateHTML(busRoot(), ui("vnext_arrivals_036"));
    setStatus("bus-update-status", projected);
    state.busLive = {
      ...projected,
      results:
        busScheduleDate === now.date && busSchedule
          ? scheduledArrivalFallbacks(
              busSchedule,
              stopId,
              projected.results ?? [],
              { date: now.date, minute: now.minute },
            )
          : projected.results,
    };
    state.busLiveAt = Date.now();
    root.dispatchEvent(
      new CustomEvent("mymap-arrivals-updated", { bubbles: true }),
    );
  }
  function renderRail(data, opts = {}) {
    if (!updateRailVisibility()) return;
    if (!data) {
      setStatus("rail-update-status", null);
      showEmpty(railRoot(), ui("vnext_arrivals_037"));
      return;
    }
    const recovered = interpolateRailRecovery(railData, data);
    railData = recovered;
    const view = normalizeRail(recovered, railSchedule, tokyoNow().minute);
    applyNotice(root.querySelector("#rail-stale"), view, opts);
    updateArrivalRows(railRoot(), view?.results ?? [], railRow);
    if (view && !view.results.length)
      updateHTML(railRoot(), ui("vnext_arrivals_038"));
    setStatus("rail-update-status", view);
    state.railFeed = {
      ...recovered,
      sourceUpdatedAt: recovered.asOf,
      capturedAt: recovered.asOf,
      trains: (recovered.trains ?? []).map((t) => ({
        ...t,
        destination: t.destination ?? t.dest,
      })),
    };
    state.railFeedAt = Date.now();
  }
  function chooseNearest() {
    const n = nearest().all.find((x) => x.stop.type === "citybus");
    if (!n) {
      toast(ui("vnext_arrivals_039"));
      return false;
    }
    return selectStop(n.id, true);
  }
  async function selectStop(id, close = false) {
    if (network.stops.get(id)?.type !== "citybus") return false;
    awaitingLocation = false;
    if (close) {
      root.querySelector("#arrival-stop-picker").hidden = true;
      stopButton.setAttribute("aria-expanded", "false");
      stopButton.focus();
    }
    if (id === stopId) {
      busLoop.poke();
      return true;
    }
    stopVersion++;
    busController?.abort();
    busController = null;
    busBusy = false;
    stopId = id;
    busData = null;
    state.busLive = null;
    renderStop();
    persist({ stopId });
    showLoading();
    await loadBusCache();
    busLoop.poke();
    return true;
  }
  async function loadBusCache() {
    if (!currentStop()) return;
    const version = stopVersion,
      c = await getCached(`citybus:${stopName(currentStop())}`);
    if (version === stopVersion && !disposed && !busData && c?.data)
      renderBus(c.data, { initial: true });
  }
  async function loadRailCache() {
    if (!updateRailVisibility()) return;
    const c = await getCached("rail:kintetsu");
    if (!disposed && !railData && c?.data)
      renderRail(c.data, { initial: true });
  }
  async function loadRailSchedule(force = false) {
    if (!updateRailVisibility()) return null;
    const date = tokyoNow().date;
    if (
      !force &&
      railSchedule &&
      railScheduleDate === date &&
      Date.now() - railScheduleAt < 30 * 60 * 1000
    )
      return railSchedule;
    if (railScheduleJob) return railScheduleJob;
    const u = new URL("/api/static/feed", CAPTURE_API);
    u.searchParams.set("operator", "kintetsu");
    u.searchParams.set("date", date);
    railScheduleJob = (async () => {
      const r = await fetch(u, {
        signal: AbortSignal.timeout(7000),
        cache: "no-store",
      });
      if (!r.ok) throw Error(ui("vnext_arrivals_040"));
      const d = await r.json();
      railSchedule = d;
      railScheduleDate = date;
      railScheduleAt = Date.now();
      return d;
    })();
    try {
      return await railScheduleJob;
    } finally {
      railScheduleJob = null;
    }
  }
  let busJob = null,
    railJob = null;
  function refreshBus() {
    if (busBusy) return busJob;
    return (busJob = runRefreshBus());
  }
  async function runRefreshBus() {
    if (busBusy || !currentStop() || disposed) return;
    busBusy = true;
    const version = stopVersion,
      controller = new AbortController();
    busController = controller;
    busRoot().setAttribute("aria-busy", "true");
    try {
      const data = await fetchRealtime(
        `citybus:${stopName(currentStop())}`,
        "/api/citybus/arrivals",
        { stop: stopName(currentStop()) },
        { timeout: 10000, signal: controller.signal },
      );
      if (version === stopVersion && !disposed) renderBus(data);
    } catch (e) {
      if (version !== stopVersion || disposed) return;
      const cached = e.cached?.data ?? busData;
      if (cached) renderBus(predictCityBus(cached));
      else renderBus(null);
      throw e;
    } finally {
      if (busController === controller) {
        busBusy = false;
        busController = null;
        busRoot().removeAttribute("aria-busy");
      }
    }
  }
  function refreshRail() {
    if (railBusy) return railJob;
    return (railJob = runRefreshRail());
  }
  async function runRefreshRail() {
    if (railBusy || !updateRailVisibility() || disposed) return;
    railBusy = true;
    railRoot().setAttribute("aria-busy", "true");
    try {
      const schedule = loadRailSchedule().catch(() => null),
        data = await fetchRealtime(
          "rail:kintetsu",
          "/api/rail/live",
          {},
          { timeout: 9000 },
        );
      await schedule;
      if (!disposed) renderRail(data);
    } catch (e) {
      if (disposed) return;
      const cached = e.cached?.data ?? railData;
      if (cached) renderRail(predictRail(cached));
      else renderRail(null);
      throw e;
    } finally {
      railBusy = false;
      railRoot().removeAttribute("aria-busy");
    }
  }
  const active = () =>
    !document.hidden &&
    (navigation.route.type === "arrivals" ||
      (state.tab === "now" && navigation.route.type === "root"));
  const busLoop = createLiveLoop({
      run: refreshBus,
      active,
      interval: ARRIVAL_INTERVAL,
    }),
    railLoop = createLiveLoop({
      run: refreshRail,
      active: () => active() && railContext().visible,
      interval: ARRIVAL_INTERVAL,
    });
  root.addEventListener("input", (e) => {
    if (e.target.id === "arrival-stop-search") renderSearch(e.target.value);
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-arrival-change")) {
      const picker = root.querySelector("#arrival-stop-picker");
      picker.hidden = !picker.hidden;
      stopButton.setAttribute("aria-expanded", String(!picker.hidden));
      if (!picker.hidden) {
        renderSearch("");
        root.querySelector("#arrival-stop-search").focus();
      }
    } else if (b.dataset.arrivalStop) selectStop(b.dataset.arrivalStop, true);
    else if (b.hasAttribute("data-rail-refresh")) {
      railScheduleAt = 0;
      railLoop.poke();
    } else if (b.hasAttribute("data-arrival-retry")) {
      if (b.closest("#arrival-rail")) railLoop.poke();
      else busLoop.poke();
    }
  });
  root.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      !root.querySelector("#arrival-stop-picker").hidden
    ) {
      e.preventDefault();
      root.querySelector("#arrival-stop-picker").hidden = true;
      stopButton.setAttribute("aria-expanded", "false");
      stopButton.focus();
    }
  });
  async function show() {
    if (disposed) return;
    if (!stopId) {
      const n = nearest().all.find((x) => x.stop.type === "citybus");
      stopId =
        n?.id ??
        cityStops(network).find((s) => s.name.includes("烏丸丸太町"))?.id ??
        cityStops(network)[0]?.id;
      persist({ stopId });
      renderStop();
    }
    if (awaitingLocation && state.fix) {
      awaitingLocation = false;
      const n = nearest().all.find((x) => x.stop.type === "citybus");
      if (n && n.id !== stopId) await selectStop(n.id);
    }
    const first = !shown;
    shown = true;
    if (first) {
      showLoading();
      await loadBusCache();
    }
    if (!active()) return;
    const target = railTarget(),
      railChanged = target !== lastRailTarget;
    lastRailTarget = target;
    const railVisible = updateRailVisibility();
    busLoop.start();
    if (railVisible) {
      if (railChanged) {
        if (railData) renderRail(railData);
        else await loadRailCache();
      }
      railLoop.start();
    } else railLoop.stop();
  }
  function logChanged() {
    state.realtimeLog = realtimeLog();
  }
  function offlineChanged() {
    if (navigator.onLine !== false) return;
    if (busData) renderBus(predictCityBus(busData));
    if (railData) renderRail(predictRail(railData));
  }
  window.addEventListener("offline", offlineChanged);
  renderStop();
  updateRailVisibility();
  window.addEventListener("mymap-realtime-log", logChanged);
  return {
    show,
    selectStop,
    refreshBus,
    refreshRail,
    pause() {
      busScheduleController?.abort();
      busLoop.stop();
      railLoop.stop();
    },
    dispose() {
      disposed = true;
      busController?.abort();
      busScheduleController?.abort();
      busLoop.stop();
      railLoop.stop();
      window.removeEventListener("mymap-realtime-log", logChanged);
      window.removeEventListener("offline", offlineChanged);
    },
    get data() {
      return busData;
    },
  };
}
