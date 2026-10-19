import { ui } from "./locale.js";
import { officialData } from "./timetable-ui.js";
import { esc, tokyoNow } from "./vnext-state.js";
import { compactBusHTML, busRow } from "./vnext-arrivals.js";
import {
  getCached,
  fetchRealtime,
  createLiveLoop,
  isFresh,
} from "./realtime.js";
import {
  busServiceKey,
  normalizedBusSources,
  groupCityBusRows,
} from "./arrival-stability.js";
import { navigation } from "./navigation.js";
import { updateArrivalRows, updateHTML } from "./view-rendering.js";

// A visible stop detail owns this loop. It uses the existing cache/network
// layer; leaving the screen stops it and does not change the arrivals picker.
export function mountBusStopPreview(host, stop, { serviceKey = null } = {}) {
  let shown = false,
    disposed = false,
    controller = null,
    data = null,
    route = null,
    schedule = null,
    scheduleDate = null,
    scheduleAt = 0,
    scheduleIncomplete = false;
  const city = stop.type === "citybus",
    name = stop.fullName ?? stop.name,
    key = `citybus:${name}`;
  function scheduleHTML({ updating, failed }) {
    const now = tokyoNow();
    const entries =
      scheduleDate === now.date
        ? (schedule ?? [])
            .filter(
              (e) =>
                (!route || String(e.route) === route) &&
                Number.isFinite(e.depart) &&
                e.depart >= now.minute &&
                e.depart <= now.minute + 120,
            )
            .sort((a, b) => a.depart - b.depart)
            .slice(0, 8)
        : [];
    const clock = (m) =>
      `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    return entries.length
      ? `<div class="arrival-compact scheduled-stop-departures">${entries.map((e) => `<div><b class="arrival-route-badge">${esc(e.route ?? "")}</b><span><b>${esc(e.destination ?? e.boardLabel ?? "")}</b><small>${esc(ui("audit_schedule_countdown", [clock(e.depart), Math.max(0, Math.ceil(e.depart - now.minute))]))}</small></span></div>`).join("")}</div><p class="source-caption">${ui("audit_schedule_note")}</p>${scheduleIncomplete ? `<p class="source-caption">${ui("audit_schedule_missing")}</p>` : ""}`
      : `<p class="source-note">${ui(updating ? "audit_schedule_loading" : failed || scheduleIncomplete || scheduleDate !== now.date ? "audit_schedule_missing" : "audit_schedule_empty")}</p>`;
  }
  async function loadSchedule(signal) {
    const now = tokyoNow();
    if (
      scheduleDate === now.date &&
      Date.now() - scheduleAt < (scheduleIncomplete ? 20000 : 300000)
    )
      return;
    const options = await officialData(
      "/timetable/options",
      { stop: stop.id },
      signal,
    );
    const results = await Promise.allSettled(
      options.boards.map((b) =>
        officialData(
          "/timetable",
          { stop: stop.id, direction: b.key, day: "auto", date: now.date },
          signal,
        ).then((board) =>
          (board.entries ?? [])
            .filter(
              (e) =>
                !e.operatingConditions?.schoolDayRequired ||
                e.operatingConditions.status === "verified",
            )
            .map((e) => ({ ...e, boardLabel: b.label })),
        ),
      ),
    );
    if (signal.aborted) return;
    const boards = results.filter((r) => r.status === "fulfilled");
    if (!boards.length) throw Error("Timetable unavailable");
    scheduleIncomplete = boards.length !== results.length;
    schedule = boards.flatMap((r) => r.value);
    scheduleDate = now.date;
    scheduleAt = Date.now();
  }
  function render({ updating = false, failed = false } = {}) {
    if (serviceKey) {
      if (!host.querySelector(".arrival-lines"))
        host.innerHTML = `<div class="arrival-lines" aria-live="polite"></div><p class="source-note" data-approach-message></p>`;
      const rows = groupCityBusRows(
        normalizedBusSources(data).filter(
          (r) => busServiceKey(r) === serviceKey,
        ),
      );
      const root = host.querySelector(".arrival-lines");
      updateArrivalRows(root, rows, busRow);
      root.querySelectorAll(".arrival-line").forEach((el) => {
        el.classList.add("expanded");
        el.querySelector(".arrival-toggle")?.setAttribute(
          "aria-expanded",
          "true",
        );
      });
      host.querySelector("[data-approach-message]").textContent = failed
        ? ui("bus_stop_preview_007").replace(/<[^>]+>/g, "")
        : !rows.some((r) =>
              r.arrivals.some((a) => Number.isFinite(a.stopsAway)),
            )
          ? ui("arrival_position_unavailable")
          : "";
      return;
    }
    const filtered = data && {
        ...data,
        results: route
          ? data.results?.filter((r) => String(r.route) === route)
          : data.results,
      },
      rows =
        city && filtered ? compactBusHTML(filtered, { stopId: stop.id }) : "",
      fresh = data && !data.stale && isFresh(data.asOf);
    const scroll = host.querySelector(".stop-route-chips")?.scrollLeft ?? 0,
      focus = document.activeElement?.dataset.previewRoute;
    updateHTML(
      host,
      ui("bus_stop_preview_010", [
        route === null ? "active" : "",
        route === null,
        (stop.lines ?? [])
          .map(
            (r) =>
              `<button type="button" class="${route === String(r) ? "active" : ""}" data-preview-route="${esc(r)}" aria-pressed="${route === String(r)}">${esc(r)}</button>`,
          )
          .join(""),
        rows || scheduleHTML({ updating, failed }),
        updating && rows ? ui("bus_stop_preview_005") : "",
        data && !fresh ? ui("bus_stop_preview_006") : "",
        failed && city ? ui("bus_stop_preview_007") : "",
        city
          ? `data-open-arrivals="${esc(stop.id)}"`
          : `data-open-timetable="${esc(stop.id)}"`,
        city ? ui("bus_stop_preview_008") : ui("bus_stop_preview_009"),
      ]),
    );
    const chips = host.querySelector(".stop-route-chips");
    if (chips) chips.scrollLeft = scroll;
    if (focus !== undefined)
      [...host.querySelectorAll("[data-preview-route]")]
        .find((b) => b.dataset.previewRoute === focus)
        ?.focus({ preventScroll: true });
  }
  async function refresh() {
    controller?.abort();
    controller = new AbortController();
    const current = controller;
    render({ updating: true });
    try {
      if (!city) {
        await loadSchedule(current.signal);
        if (shown && !disposed && !current.signal.aborted) render();
        return;
      }
      const result = await fetchRealtime(
        key,
        "/api/citybus/arrivals",
        { stop: name },
        { signal: current.signal },
      );
      if (!shown || disposed || current.signal.aborted) return;
      data = result;
      if (!compactBusHTML(data))
        await loadSchedule(current.signal).catch(() => {});
      if (!shown || disposed || current.signal.aborted) return;
      render();
    } catch (error) {
      if (current.signal.aborted || !shown || disposed) return;
      if (error.cached?.data)
        data = { ...error.cached.data, stale: true, source: "prediction" };
      render({ failed: true });
      throw error;
    }
  }
  const loop = createLiveLoop({
    run: refresh,
    active: () => shown && !disposed && !document.hidden,
  });
  host.addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (b?.dataset.busApproach)
      navigation.push("arrival-detail", {
        stopId: stop.id,
        serviceKey: b.dataset.busApproach,
      });
    if (b?.dataset.previewRoute !== undefined) {
      route = b.dataset.previewRoute || null;
      render();
    }
    if (b?.hasAttribute("data-preview-retry")) loop.poke();
  });
  return {
    async show() {
      shown = true;
      if (city && !data) {
        const cached = await getCached(key);
        if (shown && !disposed && cached?.data) data = cached.data;
      }
      if (!shown || disposed) return;
      render({ updating: city ? !data : !schedule });
      loop.start();
    },
    pause() {
      shown = false;
      controller?.abort();
      loop.stop();
    },
    dispose() {
      disposed = true;
      shown = false;
      controller?.abort();
      loop.stop();
    },
    get host() {
      return host;
    },
  };
}
