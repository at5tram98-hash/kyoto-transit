// Where the bus of a planned city-bus leg is now, from the official approach
// data of the leg's own boarding stop. The approach rows say a bus of the
// route is N stops away (or M minutes); the leg's own timetable trip gives
// how long the last N stops take, so its arrival here is now + that. Of the
// buses of the same route heading the same way, the one whose arrival is
// closest to the leg's scheduled departure is taken (a late bus more readily
// than an early one). The trip is not identified by the operator, so the
// result is always a prediction, never an exact match.
import { normalize } from "./network.js";

const clamp = (n) => Math.max(-5, Math.min(60, n));
const trimDest = (text) =>
  String(text ?? "")
    .normalize("NFKC")
    .replace(/（[^）]*）|\([^)]*\)/g, "・")
    .split(/[・、,\s]+/)
    .map((part) => normalize(part.replace(/(?:まで|行き?|方面)$/, "")))
    .filter((part) => part.length >= 2);

// The live row names a place this leg's service still reaches.
export function rowServesLeg(row, downstreamNames) {
  const names = downstreamNames.map((name) => normalize(name));
  return trimDest(row?.dest).some((part) =>
    names.some((name) => name.includes(part) || part.includes(name)),
  );
}

export function cityBusLegRealtime(leg, data, { network, nowMinute, nowEpoch = Date.now(), isFresh } = {}) {
  if (leg?.operator !== "citybus" || !data || !Number.isFinite(nowMinute)) return null;
  if (leg.depart < nowMinute - 10 || leg.depart > nowMinute + 30) return null;
  const service = network?.services?.find((s) => s.id === leg.serviceId),
    trip = service?.trips?.find((t) => (t.tripId ?? t.id) === leg.tripId),
    times = trip?.departures ?? trip?.arrivals ?? [];
  if (!service) return null;
  // The boarding index: the stop whose time is the leg's departure.
  let index = -1;
  service.stops.forEach((id, i) => {
    if (id !== leg.from) return;
    if (index < 0 || Math.abs((times[i] ?? Infinity) - leg.depart) < Math.abs((times[index] ?? Infinity) - leg.depart)) index = i;
  });
  if (index < 0) return null;
  const downstream = service.stops
    .slice(index + 1)
    .map((id) => network.stops?.get?.(id)?.name)
    .filter(Boolean);
  const best = (data.results ?? [])
    .filter((row) => String(row.route) === String(leg.route) && rowServesLeg(row, downstream))
    .map((row) => {
      let eta = null;
      if (Number.isFinite(row.minutes)) eta = nowMinute + row.minutes;
      else if (Number.isFinite(row.stopsAway)) {
        const from = index - row.stopsAway;
        if (from >= 0 && Number.isFinite(times[from]) && Number.isFinite(times[index]))
          eta = nowMinute + Math.max(0, times[index] - times[from]);
        else if (row.stopsAway === 0) eta = nowMinute;
      }
      return { row, eta };
    })
    .filter(({ eta }) => Number.isFinite(eta) && eta - leg.depart >= -4 && eta - leg.depart <= 25)
    .sort((a, b) => {
      const cost = ({ eta }) => (eta >= leg.depart ? eta - leg.depart : (leg.depart - eta) * 2);
      return cost(a) - cost(b);
    })[0];
  if (!best) return null;
  const asOf = best.row.asOf ?? data.asOf,
    fresh = data.source === "live" && !data.stale && best.row.source !== "schedule" && (isFresh ? isFresh(asOf, 90000, nowEpoch) : true);
  if (!fresh) return null;
  return {
    delay: clamp(Math.round(best.eta - leg.depart)),
    source: "prediction",
    exact: false,
    asOf,
    stopsAway: Number.isFinite(best.row.stopsAway) ? best.row.stopsAway : null,
    eta: Math.round(best.eta),
  };
}
