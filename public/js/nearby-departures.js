import { subwayIds } from "./network.js";

const cache = new WeakMap();
export function nearbyDepartures(feed, stopId, { date, minute }, limit = 2) {
  const key = `${stopId}|${date}|${minute}|${limit}`;
  let saved = feed && cache.get(feed);
  if (saved?.has(key)) return saved.get(key);
  const groups = { north: [], south: [] };
  for (const service of feed?.services ?? []) {
    if (!["subway", "through"].includes(service.operator)) continue;
    const index = service.stops.indexOf(stopId);
    if (index < 0 || index === service.stops.length - 1) continue;
    const next = service.stops
      .slice(index + 1)
      .find((id) => subwayIds.includes(id));
    if (!next) continue;
    const direction =
      subwayIds.indexOf(next) > subwayIds.indexOf(stopId) ? "south" : "north";
    for (const trip of service.trips ?? []) {
      const depart = trip.departures?.[index];
      if (
        trip.date !== date ||
        !Number.isFinite(depart) ||
        depart < minute ||
        depart > minute + 60
      )
        continue;
      groups[direction].push({
        depart,
        destination: trip.headsign,
        tripId: trip.id,
        serviceId: service.id,
      });
    }
  }
  const result = Object.entries(groups).map(([direction, entries]) => ({
    direction,
    entries: entries.sort((a, b) => a.depart - b.depart).slice(0, limit),
  }));
  if (feed) {
    if (!saved) {
      saved = new Map();
      cache.set(feed, saved);
    }
    if (saved.size >= 32) saved.delete(saved.keys().next().value);
    saved.set(key, result);
  }
  return result;
}
