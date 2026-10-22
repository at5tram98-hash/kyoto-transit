// Reverse-direction departures for the foldback sheet, built from the static
// subway and Kintetsu feeds already on the device. The official per-station
// pages are a fallback only: they are slow and can be rate limited upstream,
// which left the foldback sheet showing an error instead of trains.
import { subwayIds, kintetsuIds } from "./network.js";
import { scheduledJourney } from "./journey-session.js";

// Direction of travel when the service leaves `index`.
export function serviceDirectionAt(stops, index) {
  const here = stops[index],
    next = stops[index + 1];
  if (!here || !next) return null;
  for (const axis of [subwayIds, kintetsuIds]) {
    const a = axis.indexOf(here),
      b = axis.indexOf(next);
    if (a >= 0 && b >= 0 && a !== b) return b > a ? "south" : "north";
  }
  return null;
}

export function staticReverseEntries(feeds, stopId, direction, date) {
  const rows = new Map();
  for (const feed of feeds)
    for (const service of feed?.services ?? []) {
      const index = service.stops?.indexOf(stopId) ?? -1;
      // A train ending here cannot be boarded in the reverse direction.
      if (index < 0 || index >= service.stops.length - 1) continue;
      if (serviceDirectionAt(service.stops, index) !== direction) continue;
      for (const trip of service.trips ?? []) {
        if (trip.date && trip.date !== date) continue;
        const depart = trip.departures?.[index] ?? trip.arrivals?.[index];
        if (!Number.isFinite(depart)) continue;
        const destination = trip.headsign ?? null,
          key = `${depart}|${destination ?? ""}`;
        // Through trains can appear in both operators' feeds; keep one.
        if (rows.has(key)) continue;
        rows.set(key, {
          depart,
          serviceDepart: depart,
          destination,
          category: service.category ?? null,
          tripId: trip.id,
          serviceId: service.id,
          operator: service.operator,
          date,
          source: "static",
        });
      }
    }
  return [...rows.values()].sort((a, b) => a.depart - b.depart);
}

// The full journey of a foldback train chosen from the static feeds.
export function staticFoldbackJourney(feeds, plan, network) {
  if (!plan?.serviceId || !plan?.tripId) return null;
  const feed = { services: feeds.flatMap((f) => f?.services ?? []), meta: {} };
  return scheduledJourney(
    { serviceId: plan.serviceId, tripId: plan.tripId, from: plan.stopId, serviceDate: plan.date },
    feed,
    network,
    plan.date,
  );
}

// Ready-made foldback options: for each upcoming station, the first reverse
// train the rider can still reach with the platform buffer, and when the
// rider has passed a station, when that train gets back there.
export function foldbackRecommendations({
  ride,
  feeds,
  stops,
  minute,
  shift = 0,
  buffer = 3,
  date,
  network,
  reverseOf,
  assess,
  limit = 4,
}) {
  const timeOf = (s) => s?.arrival ?? s?.time ?? s?.departure,
    passed = (ride?.officialStops ?? []).filter(
      (s) => Number.isFinite(timeOf(s)) && timeOf(s) + shift < minute,
    ),
    target = passed.at(-1) ?? null,
    rows = [];
  for (const stop of stops.slice(0, 6)) {
    const direction = reverseOf(stop.id);
    if (!direction) continue;
    const entries = staticReverseEntries(feeds, stop.id, direction, date);
    for (const entry of entries) {
      const assessment = assess(stop, entry.depart);
      if (!Number.isFinite(assessment.slack) || assessment.slack < 0) continue;
      const journey = staticFoldbackJourney(feeds, { ...entry, stopId: stop.id }, network),
        back = target && journey?.officialStops?.find((s) => s.id === target.id);
      rows.push({
        stop,
        entry: { ...entry, stopId: stop.id, direction },
        assessment,
        target: target ? { id: target.id, name: target.name } : null,
        returnArrival: back ? timeOf(back) : null,
      });
      break;
    }
  }
  const key = (r) => (Number.isFinite(r.returnArrival) ? r.returnArrival : r.entry.depart + 60);
  return rows.sort((a, b) => key(a) - key(b) || a.entry.depart - b.entry.depart).slice(0, limit);
}
