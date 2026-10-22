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
