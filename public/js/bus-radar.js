// Live bus radar (RTM): buses approaching the city bus stop nearest the
// rider, placed on the map from the official approach information. A bus
// reported "n stops away" is drawn at the stop n places back along its
// route, so nothing is shown that the operator did not report.
import { lineKind } from "./line-badge.js";
import { isFresh } from "./realtime.js";

export const RADAR_RADIUS = 500;
export const RADAR_MAX_STOPS = 8;
// How far towards the next stop an estimate may go before the next report.
export const RADAR_MAX_PROGRESS = 0.9;

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

// The stops a bus on this service passes before reaching `stopId`, nearest
// first, wrapping round on loop routes, with the scheduled minutes from each
// of them to `stopId`.
function stopsBefore(service, stopId) {
  const stops = service.stops ?? [],
    offsets = service.offsets ?? [],
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
      // Wrapping round a loop, the segment into the first stop is the last one.
      segment = to === 0 ? offsets[cycle.length] - offsets[from] : offsets[to] - offsets[from];
    total += Number.isFinite(segment) && segment > 0 ? segment : 2;
    before.push(cycle[from]);
    minutes.push(total);
  }
  return { before, minutes, after: circular ? [...cycle.slice(index + 1), ...cycle.slice(0, index)] : cycle.slice(index + 1) };
}

// Which of a route's services serves this approach row (by its headsign).
function serviceFor(row, stopId, network) {
  const candidates = (network?.services ?? [])
    .filter((s) => s.operator === "citybus" && String(s.route) === String(row.route))
    .map((service) => ({ service, path: stopsBefore(service, stopId) }))
    .filter((c) => c.path && c.path.after.length);
  if (candidates.length <= 1) return candidates[0] ?? null;
  const words = headings(row.dest);
  const names = (ids) => ids.map((id) => normalize(network.stops.get(id)?.name));
  return (
    candidates.find((c) =>
      words.some((w) => names(c.path.after).some((n) => n.includes(w) || w.includes(n))),
    ) ?? null
  );
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
    const match = serviceFor(row, stop.id, network);
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
      segment = Math.max(1, remaining - ahead),
      minutes = Number.isFinite(row.minutes) ? row.minutes : null,
      progress =
        away === 0 || !toward || toward === at
          ? 0
          : minutes === null
            ? 0
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
