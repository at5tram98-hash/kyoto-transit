import { ui } from "./locale.js";
import { esc, tokyoNow, icon } from "./vnext-state.js";
import { getStaticFeed } from "./fast-data.js";
import { fetchRealtime, createLiveLoop, isFresh } from "./realtime.js";
import {
  buildRailArrivalRows,
  stationTimetableRows,
  railPositionNames,
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
    serviceDate = null,
    subwayFeed = null,
    subwayDate = null;
  const connected = stop.id === "K15";
  const hasKintetsu = connected || stop.type === "kintetsu";
  host.innerHTML = `<div class="arrival-lines" aria-live="polite"></div><p class="source-caption" data-station-source></p><button type="button" class="plain-action" data-station-retry>${ui("station_retry")}</button>`;
  const root = host.querySelector(".arrival-lines");
  function render({ failed = false } = {}) {
    const now = tokyoNow();
    const observed =
      hasKintetsu &&
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
    const scheduled = [
      ...(serviceDate === now.date
        ? stationTimetableRows(feed, stop.id, now)
        : []),
      ...(connected && subwayDate === now.date
        ? stationTimetableRows(subwayFeed, stop.id, now)
        : []),
    ];
    const identities = new Set(
      measured.filter((r) => r.tripId).map((r) => `${r.serviceId}:${r.tripId}`),
    );
    const unique = new Map();
    const rows = [
      ...measured,
      ...scheduled.filter((r) => !identities.has(`${r.serviceId}:${r.tripId}`)),
    ].sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity));
    // Through services retain the planner's shared K15 identity. Do not list
    // the same physical departure twice when both operator feeds include it.
    for (const row of rows) {
      const key =
        connected && Number.isFinite(row.scheduledDeparture)
          ? `${row.direction}:${row.category}:${row.scheduledDeparture}:${row.dest}`
          : row.tripId
            ? `${row.serviceId}:${row.tripId}`
            : row.key;
      if (!unique.has(key)) unique.set(key, row);
    }
    const groups = new Map();
    for (const row of unique.values()) {
      const operator = row.operator ?? stop.type;
      const key = `${operator}:${row.direction}`;
      if (!groups.has(key))
        groups.set(key, { operator, direction: row.direction, rows: [] });
      groups.get(key).rows.push(row);
    }
    const keys = [...groups.keys()].sort();
    for (const section of [...root.children])
      if (!groups.has(section.dataset.directionGroup)) section.remove();
    for (const key of keys) {
      const group = groups.get(key);
      let section = [...root.children].find(
        (el) => el.dataset.directionGroup === key,
      );
      if (!section) {
        section = document.createElement("section");
        section.dataset.directionGroup = key;
        section.innerHTML =
          '<h3 class="station-direction-heading"></h3><div class="station-direction-rows"></div>';
        root.append(section);
      }
      const direction =
        group.operator === "subway"
          ? ui(
              group.direction === "north" ? "station_north" : "station_south",
              [
                ui(
                  group.direction === "north"
                    ? "station_kokusai"
                    : "station_takeda",
                ),
              ],
            )
          : ui(
              group.direction === "north"
                ? "audit_rail_north"
                : "audit_rail_south",
            );
      section.querySelector("h3").textContent = connected
        ? `${ui(group.operator === "subway" ? "audit_subway" : "audit_kintetsu")} · ${direction}`
        : direction;
      updateArrivalRows(
        section.querySelector(".station-direction-rows"),
        group.rows.slice(0, 6),
        (row) => ({
          operator: group.operator,
          expandable: false,
          service: `<span class="station-service"><span class="transport-icon" data-operator="${group.operator}">${icon("train")}</span><small>${esc(row.label ?? (row.category === "express" ? ui("timetable_ui_001") : row.category === "local" ? ui("timetable_ui_002") : ui("timetable_ui_004")))}</small></span>`,
          destination: `<b>${esc(row.dest || ui("vnext_arrivals_021"))}</b>`,
          minutes: Number.isFinite(row.minutes)
            ? `<span><b>${Math.max(0, Math.ceil(row.minutes))}</b><small>${ui("station_minutes")}</small></span>`
            : `<span class="arrival-unconfirmed">${ui("station_eta_unknown")}</span>`,
          details: Number.isFinite(row.scheduledDeparture)
            ? `<span>${ui("station_scheduled_at", [row.clock])}</span>`
            : "",
          source:
            row.source === "live"
              ? `<span class="arrival-source-label"><i class="source-dot live" aria-hidden="true"></i>${ui(Number.isFinite(row.minutes) ? "station_observed_eta" : "station_observed_position")}</span>`
              : `<span class="arrival-source-label"><i class="source-dot schedule" aria-hidden="true"></i>${ui("audit_timetable")}</span>`,
          compactPosition: railPositionNames(row)?.join(" ››› "),
          compactPositionSource: ui(
            row.source === "live"
              ? "audit_position_live"
              : "audit_position_schedule",
          ),
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
        }),
      );
    }
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
          : connected
            ? `${ui("station_schedule_disclaimer")} ${ui("station_live_disclaimer")}`
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
        getStaticFeed(hasKintetsu ? "kintetsu" : stop.type, date, {
          signal: current.signal,
        }),
        hasKintetsu
          ? fetchRealtime(
              "rail:kintetsu",
              "/api/rail/live",
              {},
              { signal: current.signal, timeout: 9000 },
            )
          : Promise.resolve(null),
        connected
          ? getStaticFeed("subway", date, { signal: current.signal })
          : Promise.resolve(null),
      ]);
      if (!shown || disposed || current.signal.aborted) return;
      if (results[0].status === "fulfilled") {
        feed = results[0].value;
        serviceDate = date;
      }
      if (results[2].status === "fulfilled" && connected) {
        subwayFeed = results[2].value;
        subwayDate = date;
      }
      live = results[1].status === "fulfilled" ? results[1].value : null;
      render({
        failed:
          results[0].status === "rejected" ||
          (hasKintetsu && results[1].status === "rejected") ||
          (connected && results[2].status === "rejected"),
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
