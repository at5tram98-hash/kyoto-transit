import { ui } from "./locale.js";
import { esc, state, tokyoNow, icon } from "./vnext-state.js";
import { getStaticFeed } from "./fast-data.js";
import { fetchRealtime, createLiveLoop, isFresh } from "./realtime.js";
import {
  buildRailArrivalRows,
  stationTimetableRows,
} from "./rail-arrivals-core.js";
import { updateArrivalRows, updateHTML } from "./view-rendering.js";

// A station screen owns only its visible subscription. Static requests remain
// deduplicated by fast-data; returning to the screen keeps its existing rows.
export function mountStationArrivals(host, stop) {
  let shown = false,
    disposed = false,
    controller = null,
    feed = null,
    live = null,
    serviceDate = null;
  host.innerHTML = `<div class="arrival-lines" aria-live="polite"></div><p class="source-caption" data-station-source></p><button type="button" class="plain-action" data-station-retry>${ui("station_retry")}</button>`;
  const root = host.querySelector(".arrival-lines");
  function render({ failed = false } = {}) {
    const now = tokyoNow();
    const observed =
      stop.type === "kintetsu" &&
      live &&
      !live.stale &&
      live.source !== "prediction" &&
      navigator.onLine !== false &&
      isFresh(live.asOf) &&
      (!feed || serviceDate === now.date);
    const measured = observed
      ? buildRailArrivalRows(
          live,
          serviceDate === now.date ? feed : null,
          stop.id,
          now.minute,
        )
      : [];
    const scheduled =
      serviceDate === now.date ? stationTimetableRows(feed, stop.id, now) : [];
    const identities = new Set(
      measured.filter((r) => r.tripId).map((r) => `${r.serviceId}:${r.tripId}`),
    );
    const rows = [
      ...measured,
      ...scheduled.filter((r) => !identities.has(`${r.serviceId}:${r.tripId}`)),
    ]
      .sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity))
      .slice(0, 8);
    updateArrivalRows(root, rows, (row) => ({
      operator: stop.type,
      service: `<span class="station-service"><span class="transport-icon" data-operator="${stop.type}">${icon("train")}</span><small>${esc(row.label ?? (row.category === "express" ? ui("timetable_ui_001") : row.category === "local" ? ui("timetable_ui_002") : ui("timetable_ui_004")))}</small></span>`,
      destination: `<b>${esc(row.dest || ui("vnext_arrivals_021"))}</b><small>${ui(row.direction === "north" ? "station_north" : "station_south", [stop.type === "subway" ? ui(row.direction === "north" ? "station_kokusai" : "station_takeda") : ui(row.direction === "north" ? "station_kyoto" : "station_nara")])}</small>`,
      minutes: Number.isFinite(row.minutes)
        ? `<span><b>${Math.max(0, Math.ceil(row.minutes))}</b><small>${ui("station_minutes")}</small></span>`
        : `<span class="arrival-unconfirmed">${ui("station_eta_unknown")}</span>`,
      details: Number.isFinite(row.scheduledDeparture)
        ? `<span>${ui("station_scheduled_at", [row.clock])}</span>`
        : "",
      source:
        row.source === "live"
          ? `<span class="arrival-source-label"><i class="source-dot live" aria-hidden="true"></i>${ui("station_observed_eta")}</span>`
          : `<span class="arrival-source-label"><i class="source-dot schedule" aria-hidden="true"></i>${ui("station_scheduled_position")}</span>`,
      stopsAway: row.stationsAway,
      vehicleSymbol: icon("train"),
      approachLabel: ui(
        row.source === "live"
          ? "station_observed_position"
          : "station_scheduled_position",
      ),
      approachStart: ui("station_six_before"),
      approachEnd: ui("station_this_station"),
      positionDescription: Number.isFinite(row.stationsAway)
        ? ui("station_position_description", [
            Math.round(row.stationsAway * 10) / 10,
          ])
        : "",
    }));
    if (!rows.length)
      updateHTML(
        root,
        `<p class="source-note">${
          failed
            ? ui("station_load_failed")
            : feed
              ? ui("station_no_services")
              : ui("station_loading")
        }</p>`,
      );
    host.querySelector("[data-station-source]").textContent =
      navigator.onLine === false
        ? ui("station_offline")
        : failed
          ? ui("station_load_failed")
          : stop.type === "subway"
            ? ui("station_schedule_disclaimer")
            : ui("station_live_disclaimer");
  }
  async function refresh() {
    controller?.abort();
    const current = (controller = new AbortController()),
      date = tokyoNow().date;
    host.setAttribute("aria-busy", "true");
    try {
      const results = await Promise.allSettled([
        getStaticFeed(stop.type, date, { signal: current.signal }),
        stop.type === "kintetsu"
          ? fetchRealtime(
              "rail:kintetsu",
              "/api/rail/live",
              {},
              { signal: current.signal, timeout: 9000 },
            )
          : Promise.resolve(null),
      ]);
      if (!shown || disposed || current.signal.aborted) return;
      if (results[0].status === "fulfilled") {
        feed = results[0].value;
        serviceDate = date;
      }
      live = results[1].status === "fulfilled" ? results[1].value : null;
      render({
        failed:
          results[0].status === "rejected" ||
          (stop.type === "kintetsu" && results[1].status === "rejected"),
      });
    } finally {
      if (controller === current) host.removeAttribute("aria-busy");
    }
  }
  const loop = createLiveLoop({
    run: refresh,
    active: () => shown && !disposed && !document.hidden,
  });
  host
    .querySelector("[data-station-retry]")
    .addEventListener("click", () => loop.poke());
  return {
    host,
    show() {
      shown = true;
      render();
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
  };
}
