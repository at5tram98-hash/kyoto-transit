// Live bus radar (RTM): buses approaching the city bus stop nearest the
// rider, placed on the map from the official approach information. A bus
// reported "n stops away" is drawn at the stop n places back along its
// route, so nothing is shown that the operator did not report.
import { lineKind } from "./line-badge.js";
import { isFresh } from "./realtime.js";

export const RADAR_RADIUS = 500;
export const RADAR_MAX_STOPS = 8;

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
// first, wrapping round on loop routes.
function stopsBefore(service, stopId) {
  const stops = service.stops ?? [],
    circular = stops.length > 2 && stops[0] === stops.at(-1),
    cycle = circular ? stops.slice(0, -1) : stops,
    index = cycle.indexOf(stopId);
  if (index < 0) return null;
  const before = [];
  for (let i = 1; i <= RADAR_MAX_STOPS; i++) {
    const at = index - i;
    if (at < 0 && !circular) break;
    before.push(cycle[(at + cycle.length) % cycle.length]);
  }
  return { before, after: circular ? [...cycle.slice(index + 1), ...cycle.slice(0, index)] : cycle.slice(index + 1) };
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
export function radarBuses({ stop, data, network, geo, now = Date.now() } = {}) {
  if (!stop || !data || data.source !== "live" || data.stale || !isFresh(data.asOf, undefined, now))
    return [];
  const located = new Map((geo?.stops ?? []).map((s) => [s.id, s]));
  const out = [];
  for (const row of data.results ?? []) {
    const away = Number(row?.stopsAway);
    if (row?.source !== "live" || !Number.isInteger(away) || away < 0 || away > RADAR_MAX_STOPS)
      continue;
    const match = serviceFor(row, stop.id, network);
    if (!match) continue;
    const atId = away === 0 ? stop.id : match.path.before[away - 1],
      at = located.get(atId),
      toward = located.get(away <= 1 ? stop.id : match.path.before[away - 2]);
    if (!at) continue;
    out.push({
      key: `${row.route}|${row.dest}|${away}|${row.boarding ?? ""}`,
      route: String(row.route),
      dest: row.dest ?? "",
      stopsAway: away,
      minutes: Number.isFinite(row.minutes) ? row.minutes : null,
      lat: at.lat,
      lng: at.lng,
      atName: network.stops.get(atId)?.name ?? "",
      heading:
        toward && toward !== at
          ? (Math.atan2(toward.lng - at.lng, toward.lat - at.lat) * 180) / Math.PI
          : null,
      kind: lineKind({ operator: "citybus", route: row.route }),
    });
  }
  // One marker per reported bus; the closest first.
  const seen = new Set();
  return out
    .sort((a, b) => a.stopsAway - b.stopsAway)
    .filter((b) => !seen.has(b.key) && seen.add(b.key))
    .slice(0, 12);
}
