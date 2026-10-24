// Live bus radar (RTM): buses approaching the city bus stop nearest the
// rider, placed on the map from the official approach information. A bus
// reported "n stops away" is drawn between the stop n places back along
// its route and the next one, and moves on at the average bus pace.
import { lineKind } from "./line-badge.js";
import { isFresh } from "./realtime.js";
import { loopRotation } from "./bus-direction.js";

export const RADAR_RADIUS = 500;
export const RADAR_MAX_STOPS = 8;
// How far towards the next stop an estimate may go before the next report.
export const RADAR_MAX_PROGRESS = 0.9;
export const RADAR_UNKNOWN_START = 0.25;

// Where a radar bus is at `now`: along the straight line from the stop it
// was reported at towards the next one, advancing at the scheduled pace.
export function busPosition(bus, now = Date.now()) {
  if (!bus?.to) return { lat: bus.from?.lat ?? bus.lat, lng: bus.from?.lng ?? bus.lng, along: 0 };
  const elapsed = Number.isFinite(bus.reportedAt) ? Math.max(0, now - bus.reportedAt) / 60000 : 0,
    along = Math.min(RADAR_MAX_PROGRESS, (bus.progress ?? 0) + elapsed / bus.segment);
  return {
    lat: bus.from.lat + (bus.to.lat - bus.from.lat) * along,
    lng: bus.from.lng + (bus.to.lng - bus.from.lng) * along,
    along,
  };
}

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s・･（）()]/g, "");

// The heading words of a destination such as "高野・銀閣寺（方面）".
const headings = (dest) =>
  String(dest ?? "")
    .replace(/（[^）]*）|\([^)]*\)/g, "・")
    .split(/[・、,\s]+/)
    .map((part) => normalize(part.replace(/(?:まで|行き?|方面)$/, "")))
    .filter((part) => part.length >= 2);

// The nearest city bus stop within the radius, with its distance.
export function radarStop(nearby = [], radius = RADAR_RADIUS) {
  return (
    nearby.find((row) => row?.stop?.type === "citybus" && row.meters <= radius) ?? null
  );
}

// Average city bus pace between stops (stops included): about 14 km/h.
export const BUS_METRES_PER_MINUTE = 230;
const metres = (a, b) => {
  const r = Math.PI / 180,
    x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) * r) / 2),
    y = (b.lat - a.lat) * r;
  return 6371000 * Math.hypot(x, y);
};

// The stops a bus on this service passes before reaching `stopId`, nearest
// first, wrapping round on loop routes, with the minutes from each of them
// to `stopId`. A segment's minutes come from its length at the average bus
// pace (the catalog has no real segment times), else two minutes.
function stopsBefore(service, stopId, located = new Map()) {
  const stops = service.stops ?? [],
    circular = stops.length > 2 && stops[0] === stops.at(-1),
    cycle = circular ? stops.slice(0, -1) : stops,
    index = cycle.indexOf(stopId);
  if (index < 0) return null;
  const before = [],
    minutes = [];
  let total = 0;
  for (let i = 1; i <= RADAR_MAX_STOPS; i++) {
    const at = index - i;
    if (at < 0 && !circular) break;
    const from = (at + cycle.length) % cycle.length,
      to = (from + 1) % cycle.length,
      a = located.get(cycle[from]),
      b = located.get(cycle[to]);
    total += a && b ? Math.max(0.5, metres(a, b) / BUS_METRES_PER_MINUTE) : 2;
    before.push(cycle[from]);
    minutes.push(total);
  }
  return { before, minutes, after: circular ? [...cycle.slice(index + 1), ...cycle.slice(0, index)] : cycle.slice(index + 1) };
}

// Which of a route's services serves this approach row (by its headsign).
// On a loop both directions pass every stop; the right one reaches the
// places in the headsign soonest.
export function serviceFor(row, stopId, network, located = new Map()) {
  const candidates = (network?.services ?? [])
    .filter((s) => s.operator === "citybus" && String(s.route) === String(row.route))
    .map((service) => ({ service, path: stopsBefore(service, stopId, located) }))
    .filter((c) => c.path && c.path.after.length);
  if (candidates.length <= 1) return candidates[0] ?? null;
  const words = headings(row.dest);
  const names = (ids) => ids.map((id) => normalize(network.stops.get(id)?.name));
  const reach = (c) => {
    const list = names(c.path.after),
      at = list.findIndex((n) => words.some((w) => n.includes(w) || w.includes(n)));
    return at < 0 ? Infinity : at;
  };
  const best = candidates
    .map((c) => ({ c, at: reach(c) }))
    .sort((a, b) => a.at - b.at)[0];
  return best && best.at !== Infinity ? best.c : null;
}

// Buses to draw: fresh live rows with a stop count, each placed at the stop
// it was reported at. Rows that cannot be placed are left out.
export function radarBuses({ stop, data, network, geo, now = Date.now(), previous = [] } = {}) {
  if (!stop || !data || data.source !== "live" || data.stale || !isFresh(data.asOf, undefined, now))
    return [];
  const located = new Map((geo?.stops ?? []).map((s) => [s.id, s])),
    asOf = typeof data.asOf === "number" ? data.asOf : Date.parse(data.asOf);
  const out = [];
  for (const row of data.results ?? []) {
    const away = Number(row?.stopsAway);
    if (row?.source !== "live" || !Number.isInteger(away) || away < 0 || away > RADAR_MAX_STOPS)
      continue;
    const match = serviceFor(row, stop.id, network, located);
    if (!match) continue;
    const atId = away === 0 ? stop.id : match.path.before[away - 1],
      towardId = away <= 1 ? stop.id : match.path.before[away - 2],
      at = located.get(atId),
      toward = located.get(towardId);
    if (!at) continue;
    // "n stops away" places the bus between that stop and the next one. The
    // reported minutes say how far along it is, by the scheduled minutes of
    // the segments still ahead; it then moves on with the clock, but never
    // reaches the next stop before the operator reports it there.
    const remaining = away === 0 ? 0 : match.path.minutes[away - 1],
      ahead = away <= 1 ? 0 : match.path.minutes[away - 2],
      segment = Math.max(0.5, remaining - ahead),
      minutes = Number.isFinite(row.minutes) ? row.minutes : null,
      progress =
        away === 0 || !toward || toward === at
          ? 0
          : minutes === null
            ? // Reported once it passes a stop, so on average it is a
              // quarter of the way along when the report is read.
              RADAR_UNKNOWN_START
            : Math.max(0, Math.min(RADAR_MAX_PROGRESS, (remaining - minutes) / segment));
    out.push({
      key: `${row.route}|${row.dest}|${away}|${row.boarding ?? ""}`,
      route: String(row.route),
      dest: row.dest ?? "",
      stopsAway: away,
      minutes,
      lat: at.lat,
      lng: at.lng,
      from: { lat: at.lat, lng: at.lng },
      to: toward && toward !== at ? { lat: toward.lat, lng: toward.lng } : null,
      segment,
      progress,
      reportedAt: asOf,
      atName: network.stops.get(atId)?.name ?? "",
      heading:
        toward && toward !== at
          ? (Math.atan2(toward.lng - at.lng, toward.lat - at.lat) * 180) / Math.PI
          : null,
      kind: lineKind({ operator: "citybus", route: row.route }),
      rotation: loopRotation(match.service, located),
    });
  }
  // A bus still reported at the same stop keeps going from where it was
  // drawn: a new report never sends it backwards.
  const before = new Map((previous ?? []).map((b) => [b.key, b]));
  for (const bus of out) {
    const old = before.get(bus.key);
    if (old?.to && bus.to && old.from.lat === bus.from.lat && old.from.lng === bus.from.lng) {
      const along = busPosition(old, now).along;
      if (along > bus.progress) Object.assign(bus, { progress: along, reportedAt: now });
    }
    Object.assign(bus, busPosition(bus, now));
  }
  // One marker per reported bus; the closest first.
  const seen = new Set();
  return out
    .sort((a, b) => a.stopsAway - b.stopsAway)
    .filter((b) => !seen.has(b.key) && seen.add(b.key))
    .slice(0, 12);
}
