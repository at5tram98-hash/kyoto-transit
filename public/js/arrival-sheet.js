// Arrived at the destination. A sheet says so and, unless the rider is
// home, offers the next leg from here: the next trains from the subway and
// Kintetsu stations within walking distance (one tap sets it as the next
// ride, which ATS then watches for), or a route search starting here.
// At home the trip is over: no connections are offered.
import { ui, displayStopName } from "./locale.js";
import { esc, state, tokyoNow } from "./vnext-state.js";
import { icon } from "./icons.js";
import { lineBadge } from "./line-badge.js";
import { openContextSheet } from "./context-sheet.js";
import { formatMinute } from "./vnext-core.js";
import { distance } from "./mobility.js";
import { readHome } from "./ats.js";

export const HOME_ARRIVAL_METRES = 400;
export const CONNECTION_RADIUS = 600;
export const CONNECTION_WINDOW = 40;
const RAIL = new Set(["subway", "kintetsu"]);
// Streets are about 1.3× the straight line; 80 m a minute on foot, plus a
// minute to the platform.
const walkMinutes = (meters) => Math.max(1, Math.ceil((meters * 1.3) / 80)) + 1;

// Home: the arrival stop (or the rider's own fix) is within reach of home.
export function arrivedHome(point, home, fix = null) {
  if (!home) return false;
  return [point, fix].some(
    (p) => p && [p.lat, p.lng].every(Number.isFinite) && distance(p, home) <= HOME_ARRIVAL_METRES,
  );
}

// Stations within walking distance of a point, nearest first.
export function stationsNear(point, geo, network, radius = CONNECTION_RADIUS) {
  if (!point || !geo) return [];
  return (geo.stops ?? [])
    .map((s) => ({ stop: network?.stops.get(s.id), meters: distance(point, s) }))
    .filter((row) => row.stop && RAIL.has(row.stop.type) && row.meters <= radius)
    .sort((a, b) => a.meters - b.meters)
    .filter((row, i, all) => all.findIndex((r) => r.stop.id === row.stop.id) === i)
    .slice(0, 2);
}

// The next trips leaving a station from a timetable feed, at most two per
// destination, as rides that can be armed.
export function departuresFrom(feed, stationId, { minute, network, window = CONNECTION_WINDOW, limit = 4 } = {}) {
  const rows = [];
  for (const service of feed?.services ?? []) {
    const index = service.stops?.indexOf(stationId) ?? -1;
    if (index < 0 || index >= service.stops.length - 1) continue;
    for (const trip of service.trips ?? []) {
      const depart = trip.departures?.[index] ?? trip.arrivals?.[index];
      if (!Number.isFinite(depart) || depart < minute || depart > minute + window) continue;
      const officialStops = [];
      for (let i = index; i < service.stops.length; i++) {
        const arrival = trip.arrivals?.[i] ?? trip.departures?.[i],
          departure = trip.departures?.[i] ?? trip.arrivals?.[i];
        if (!Number.isFinite(arrival ?? departure)) continue;
        const id = service.stops[i];
        officialStops.push({ id, name: network?.stops.get(id)?.name ?? id, time: arrival, arrival, departure, estimated: false });
      }
      if (officialStops.length < 2) continue;
      const last = officialStops.at(-1);
      rows.push({
        kind: "ride",
        operator: service.operator,
        category: service.category ?? "local",
        label: service.label,
        destination: trip.headsign || last.name,
        from: stationId,
        to: last.id,
        depart,
        arrive: last.arrival,
        minutes: last.arrival - depart,
        officialStops,
        fullTerminus: true,
        syntheticTimes: false,
        serviceId: service.id,
        tripId: trip.id,
        serviceDate: trip.date,
        timetableSource: "static",
      });
    }
  }
  rows.sort((a, b) => a.depart - b.depart);
  const perDestination = new Map();
  return rows
    .filter((ride) => {
      const n = perDestination.get(ride.destination) ?? 0;
      perDestination.set(ride.destination, n + 1);
      return n < 2;
    })
    .slice(0, limit);
}

let offered = [];
export const arrivalChoice = (index) => offered[Number(index)] ?? null;

export async function openArrivalSheet({ stop, loadFeed }) {
  if (!stop) return;
  const now = tokyoNow(),
    point = state.geo?.stops?.find((s) => s.id === stop.id) ?? stop,
    home = arrivedHome(point, readHome(), state.fix),
    name = displayStopName(stop) || stop.name,
    head = `<div class="arrival-hero" data-home="${home}">${icon(home ? "home" : "checkmark")}<h3>${esc(ui(home ? "arrival_home_title" : "arrival_title", [name]))}</h3><p>${esc(ui(home ? "arrival_home_note" : "arrival_note", [formatMinute(now.minute)]))}</p></div>`;
  offered = [];
  if (home) {
    openContextSheet(ui("arrival_sheet_title"), `<section class="arrival-sheet">${head}<div class="screen-action-group"><button type="button" class="primary-action" data-arrival-close>${esc(ui("arrival_close"))}</button></div></section>`);
    return;
  }
  const actions = `<div class="screen-action-group"><button type="button" class="primary-action" data-arrival-search="${esc(stop.id)}">${icon("search")}<span>${esc(ui("arrival_search"))}</span></button><button type="button" class="plain-action" data-arrival-close>${esc(ui("arrival_close"))}</button></div>`;
  const stations = stationsNear(point, state.geo, state.network);
  const body = (list) =>
    `<section class="arrival-sheet">${head}${list}${actions}</section>`;
  openContextSheet(
    ui("arrival_sheet_title"),
    body(stations.length ? `<h4 class="ats-sheet-label">${esc(ui("arrival_connect_title"))}</h4><p class="source-caption" role="status">${esc(ui("arrival_connect_loading"))}</p>` : ""),
  );
  if (!stations.length) return;
  let reached = 0;
  const groups = await Promise.all(
    stations.map(async ({ stop: station, meters }) => {
      const feed = await loadFeed(station.type).catch(() => null);
      if (feed) reached++;
      // Only trains the rider can still walk to.
      const walk = walkMinutes(meters);
      return { station, meters, rides: departuresFrom(feed, station.id, { minute: now.minute + walk, network: state.network }) };
    }),
  );
  const sheet = globalThis.document?.querySelector("#context-sheet");
  if (!sheet?.open || !sheet.querySelector(".arrival-sheet")) return;
  const html = groups
    .filter((g) => g.rides.length)
    .map(({ station, meters, rides }) => {
      const rows = rides
        .map((ride) => {
          const i = offered.push(ride) - 1,
            walk = walkMinutes(meters);
          return `<button type="button" class="setting-row arrival-connection" data-arrival-arm="${i}">${lineBadge({ operator: ride.operator }, { name: false, size: "small" })}<span><b>${esc(ui("arrival_connection", [formatMinute(ride.depart), ride.destination]))}</b><small>${esc(ui("arrival_connection_note", [Math.max(0, Math.round(ride.depart - now.minute)), walk]))}</small></span><span class="chevron" aria-hidden="true">›</span></button>`;
        })
        .join("");
      return `<h4 class="ats-sheet-label">${esc(ui("arrival_station", [displayStopName(station) || station.name, Math.round(meters)]))}</h4><div class="settings-card">${rows}</div>`;
    })
    .join("");
  openContextSheet(
    ui("arrival_sheet_title"),
    body(
      html
        ? `<p class="source-caption">${esc(ui("arrival_connect_intro"))}</p>${html}`
        : `<p class="source-caption">${esc(ui(reached ? "arrival_connect_none" : "arrival_connect_offline"))}</p>`,
    ),
  );
}
