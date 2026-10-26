// Kintetsu trips a rider at (or between) stations could be on, from the
// day's static timetable feed. It holds the same official trips (same trip
// ids) as the per-station official pages, so candidates are ready at once
// and without asking the server to read a dozen official pages; the
// official reading, when it arrives, replaces a trip by its id (it also
// carries the terminus the static feed may lack).
import { kintetsuIds } from "./network.js";

export const KINTETSU_WINDOW_BEFORE = 25;
export const KINTETSU_WINDOW_AFTER = 2;
const TYPE_LABEL = { local: "普通", express: "急行" };

// The station and its neighbours on the line, the station first.
export function kintetsuProbeStops(stopId) {
  const i = kintetsuIds.indexOf(stopId);
  if (i < 0) return [stopId];
  return [stopId, kintetsuIds[i - 1], kintetsuIds[i + 1]].filter(Boolean);
}

// Trips that run past the station (or a neighbour) now: for each trip, the
// stop it called at last before that point is where the rider boarded, and
// it left there in [minute − 25, minute + 2]. A train that passes the
// station without stopping (an express at Jujo) counts too, boarded at the
// stop before. One record per trip; the station itself is tried first,
// then its neighbours (the nearest station by GPS can be the one before).
export function kintetsuStaticTrips(feed, stopId, { minute, date = null, network = null, perStop = 3 } = {}) {
  if (!feed?.services?.length || !Number.isFinite(minute)) return [];
  const name = (id) => network?.stops.get(id)?.name ?? feed.stops?.find?.((s) => s.id === id)?.name ?? id,
    axis = (id) => kintetsuIds.indexOf(id),
    seen = new Set(),
    trips = [];
  for (const probe of kintetsuProbeStops(stopId)) {
    const target = axis(probe),
      rows = [];
    if (target < 0) continue;
    for (const service of feed.services) {
      if (service.operator && service.operator !== "kintetsu") continue;
      const stops = service.stops ?? [];
      // The service's stop at the probe, or the one before it on the way.
      let index = -1;
      for (let i = 0; i < stops.length - 1; i++) {
        const a = axis(stops[i]),
          b = axis(stops[i + 1]);
        if (a < 0 || b < 0) continue;
        if (a === target || (Math.min(a, b) < target && target < Math.max(a, b))) {
          index = i;
          break;
        }
      }
      if (index < 0) continue;
      for (const trip of service.trips ?? []) {
        if (date && trip.date && trip.date !== date) continue;
        const depart = trip.departures?.[index] ?? trip.arrivals?.[index];
        if (!Number.isFinite(depart)) continue;
        if (depart < minute - KINTETSU_WINDOW_BEFORE || depart > minute + KINTETSU_WINDOW_AFTER) continue;
        rows.push({ service, trip, index, depart });
      }
    }
    rows.sort((a, b) => b.depart - a.depart);
    let taken = 0;
    for (const { service, trip, index } of rows) {
      const id = trip.id ?? null;
      if (id && seen.has(id)) continue;
      if (taken >= (probe === stopId ? perStop * 2 : perStop)) break;
      const stops = [];
      for (let i = index; i < service.stops.length; i++) {
        const arrival = trip.arrivals?.[i] ?? trip.departures?.[i] ?? null,
          departure = trip.departures?.[i] ?? trip.arrivals?.[i] ?? null;
        if (!Number.isFinite(arrival ?? departure)) continue;
        stops.push({ id: service.stops[i], name: name(service.stops[i]), arrival, departure });
      }
      if (stops.length < 2) continue;
      if (id) seen.add(id);
      taken++;
      const destination = trip.headsign || stops.at(-1).name;
      trips.push({
        operator: "kintetsu",
        title: `${TYPE_LABEL[service.category] ?? service.label ?? "近鉄"} ${destination}行き`,
        tripId: id,
        destination,
        category: service.category ?? "local",
        stops,
        boardStop: service.stops[index],
        date: trip.date ?? date,
        source: "static",
      });
    }
  }
  return trips;
}

// The trip reaches its terminus in the record: the last stop is the
// destination ("大和西大寺" and "西大寺" are the same station).
const terminus = (name) => String(name ?? "").replace(/^大和西大寺$/, "西大寺").replace(/^近鉄/, "");
export function kintetsuTripComplete(trip) {
  const last = trip?.stops?.at(-1)?.name;
  return Boolean(last) && terminus(last) === terminus(trip.destination);
}

// Official readings first; a static trip only where no official reading of
// the same trip exists.
export function mergeKintetsuTrips(official = [], fromStatic = []) {
  const ids = new Set(official.map((t) => t.tripId).filter(Boolean));
  return [...official, ...fromStatic.filter((t) => !t.tripId || !ids.has(t.tripId))];
}
