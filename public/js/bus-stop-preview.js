import { ui, placeName } from "./locale.js";
import { officialData } from "./timetable-ui.js";
import { esc, tokyoNow, state, icon } from "./vnext-state.js";
import { approachStops } from "./approach-stops.js";
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
import { lineBadge, lineKind } from "./line-badge.js";

// Kyoto Bus stops that 京都バスナビ resolves, and the onward stop that
// selects each served direction (route 40 and the 臨時 line).
const KYOTOBUS_NAV_TARGETS = {
  京都産業大学前: ["国際会館駅前"],
  国際会館駅前: ["京都産業大学前"],
  烏丸丸太町: ["千本丸太町"],
  千本丸太町: ["烏丸丸太町"],
};
const navClock = (m) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

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
    key = `citybus:${name}`,
    navTargets = city ? [] : (KYOTOBUS_NAV_TARGETS[stop.name] ?? []);
  let nav = null,
    navFailed = false;
  // Official 京都バスナビ departures: scheduled and predicted time, platform
  // and congestion. Nothing is shown when the navigation has no answer.
  function navHTML() {
    const now = tokyoNow(),
      buses = (nav ?? [])
        .flatMap((n) => n.buses ?? [])
        .filter(
          (b) =>
            (!route || String(b.route) === route) &&
            Number.isFinite(b.departure?.scheduled),
        )
        .sort(
          (a, b) =>
            (a.departure.predicted ?? a.departure.scheduled) -
            (b.departure.predicted ?? b.departure.scheduled),
        )
        .slice(0, 6);
    if (!buses.length)
      return nav?.some((n) => n.message)
        ? `<p class="source-note">${esc(nav.find((n) => n.message).message)}</p>`
        : "";
    const asOf = nav.map((n) => n.capturedAt).filter(Boolean).sort().at(-1);
    return `<h3 class="stop-section-heading">${esc(ui("kyotobus_nav_heading"))}</h3><div class="arrival-compact kyotobus-nav-departures">${buses
      .map((b) => {
        const depart = b.departure.predicted ?? b.departure.scheduled,
          wait = Number.isFinite(b.minutesToDeparture)
            ? b.minutesToDeparture
            : Math.max(0, depart - now.minute),
          late =
            Number.isFinite(b.departure.predicted) &&
            b.departure.predicted > b.departure.scheduled;
        return `<div>${lineBadge({ operator: "kyotobus", route: b.route }, { className: "arrival-route-badge" })}<span><b>${esc(ui("kyotobus_nav_destination", [b.destination ?? ""]))}</b><small><i class="source-dot live" aria-hidden="true"></i>${esc(
          [
            ui("kyotobus_nav_scheduled", [navClock(b.departure.scheduled)]),
            late ? ui("kyotobus_nav_late", [b.departure.predicted - b.departure.scheduled]) : "",
            b.platform ? ui("kyotobus_nav_platform", [b.platform]) : "",
            b.congestion ?? "",
          ]
            .filter(Boolean)
            .join(" · "),
        )}</small></span><strong>${esc(ui("kyotobus_nav_departs", [navClock(depart)]))}<small>${esc(ui("kyotobus_nav_wait", [wait]))}</small></strong></div>`;
      })
      .join(
        "",
      )}</div><p class="source-caption">${esc(ui("kyotobus_nav_source", [asOf ? new Date(asOf).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }) : "—"]))}</p>`;
  }
  async function loadNav(signal) {
    if (!navTargets.length) return;
    const results = await Promise.allSettled(
      navTargets.map((to) =>
        fetchRealtime(
          `kyotobus:nav:${stop.name}:${to}`,
          "/api/kyotobus/approach",
          { from: stop.name, to },
          { signal, timeout: 8000 },
        ),
      ),
    );
    if (signal.aborted) return;
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    navFailed = !ok.length;
    if (ok.length) nav = ok;
  }
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
      ? `${navTargets.length ? `<h3 class="stop-section-heading">${esc(ui("stop_schedule_heading"))}</h3>` : ""}<div class="arrival-compact scheduled-stop-departures">${entries.map((e) => `<div>${lineBadge({ operator: stop.type, route: e.route }, { className: "arrival-route-badge" })}<span><b>${esc(placeName(e.destination) ?? e.boardLabel ?? "")}</b><small>${esc(ui("audit_schedule_countdown", [clock(e.depart), Math.max(0, Math.ceil(e.depart - now.minute))]))}</small></span></div>`).join("")}</div><p class="source-caption">${ui("audit_schedule_note")}</p>${scheduleIncomplete ? `<p class="source-caption">${ui("audit_schedule_missing")}</p>` : ""}`
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
  // Named stops before this one, with each approaching bus placed on them.
  function updateApproachStops(target, row) {
    const list = row && approachStops(state.network, stop.id, row.route, row.dest);
    if (!list) {
      target.hidden = true;
      return;
    }
    const at = new Map();
    for (const a of row.arrivals ?? [])
      if (Number.isFinite(a.stopsAway) && a.stopsAway >= 0 && a.stopsAway < list.length)
        at.set(Math.round(a.stopsAway), a);
    target.hidden = false;
    updateHTML(
      target,
      `<h3 class="stop-section-heading">${esc(ui("approach_stops_heading"))}</h3><ol class="approach-stops" data-line="${esc(lineKind({ operator: stop.type, route: row.route }))}">${list
        .map(
          (s) =>
            `<li class="${s.away === 0 ? "here" : ""}${at.has(s.away) ? " bus" : ""}"><span class="approach-stop-dot" aria-hidden="true">${at.has(s.away) ? icon("bus") : ""}</span><b>${esc(s.name)}</b><small>${esc(s.away === 0 ? ui("approach_stops_here") : ui("approach_stops_away", [s.away]))}${at.has(s.away) ? ` · ${esc(ui("approach_stops_bus"))}` : ""}</small></li>`,
        )
        .join("")}</ol><p class="source-caption">${esc(ui("approach_stops_note"))}</p>`,
    );
  }
  function render({ updating = false, failed = false } = {}) {
    if (serviceKey) {
      if (!host.querySelector(".arrival-lines"))
        host.innerHTML = `<div class="arrival-lines" aria-live="polite"></div><p class="source-note" data-approach-message></p><section class="approach-stops-card" data-approach-stops hidden></section>`;
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
      updateApproachStops(host.querySelector("[data-approach-stops]"), rows[0]);
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
        rows || `${navHTML()}${scheduleHTML({ updating, failed })}`,
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
        await Promise.allSettled([loadNav(current.signal)]);
        if (shown && !disposed && !current.signal.aborted && nav) render({ updating: true });
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
