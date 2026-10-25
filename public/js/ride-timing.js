// Times for a detected ride that has none. A city bus ride is identified
// from the stop order (which route, which direction, where the rider got
// on) but not which trip; the official timetable then tells: the trip that
// leaves the boarding stop closest to when the ride was detected (buses run
// late more often than early, so a trip that already left is preferred).
// Each stop of the ride gets that trip's time. Times the timetable only
// completes from segment minutes are marked estimated; nothing is invented
// beyond what the feed gives.
import { stopTime } from "./journey-core.js";

export const TIMING_WINDOW_BEFORE = 25;
export const TIMING_WINDOW_AFTER = 6;

export const rideHasTimes = (ride) =>
  (ride?.officialStops ?? []).some((stop) => Number.isFinite(stopTime(stop)));
// Only a ride whose trip is unknown (no departure, no stop times) is looked
// up; a timetabled ride is left exactly as chosen.
export const rideNeedsTiming = (ride) =>
  Boolean(ride) && !Number.isFinite(ride.depart) && !Number.isFinite(ride.scheduledDepart) && !rideHasTimes(ride);

// The feed service this ride runs on: the same pattern by id, else one of
// the same route that leaves the boarding stop towards the ride's next stop.
export function feedServiceFor(ride, feed) {
  const services = feed?.services ?? [],
    ids = [ride?.serviceId, ride?.servicePatternId].filter(Boolean);
  for (const id of ids) {
    const found = services.find((s) => s.id === id || s.id === `official-${id}`);
    if (found && boardIndex(found, ride) >= 0) return found;
  }
  return (
    services.find(
      (s) =>
        (!s.operator || s.operator === ride?.operator) &&
        (!ride?.route || String(s.route) === String(ride.route)) &&
        boardIndex(s, ride) >= 0,
    ) ?? null
  );
}

// Where the ride boards on the service: the stop followed by the ride's next.
function boardIndex(service, ride) {
  const stops = service?.stops ?? [],
    next = ride?.officialStops?.[1]?.id;
  for (let i = 0; i < stops.length - 1; i++)
    if (stops[i] === ride?.from && (!next || stops[i + 1] === next)) return i;
  return -1;
}

// The trip the rider is most likely on, by its departure from the boarding
// stop: within [minute − 25, minute + 6], nearest first, an early trip
// counting double.
export function pickTrip(service, index, minute, date = null) {
  let best = null;
  for (const trip of service?.trips ?? []) {
    if (date && trip.date && trip.date !== date) continue;
    const depart = trip.departures?.[index] ?? trip.arrivals?.[index];
    if (!Number.isFinite(depart)) continue;
    if (depart < minute - TIMING_WINDOW_BEFORE || depart > minute + TIMING_WINDOW_AFTER) continue;
    const cost = depart <= minute ? minute - depart : (depart - minute) * 2;
    if (!best || cost < best.cost) best = { trip, depart, cost };
  }
  return best;
}

// The ride with each stop timed from the trip, or null when no trip fits.
export function timeRideFromFeed(ride, feed, { minute, date = null } = {}) {
  if (!ride || !Number.isFinite(minute) || !(ride.officialStops?.length >= 2)) return null;
  const service = feedServiceFor(ride, feed);
  if (!service) return null;
  const index = boardIndex(service, ride),
    chosen = pickTrip(service, index, minute, date);
  if (!chosen) return null;
  const { trip } = chosen,
    stops = service.stops,
    read = Array.isArray(service.officialStops) ? new Set(service.officialStops) : null,
    loop = stops.length > 3 && stops[0] === stops.at(-1),
    at = (k, list) => list?.[k] ?? null;
  let k = index,
    lap = 0;
  const officialStops = ride.officialStops.map((stop, n) => {
    if (n > 0) {
      k++;
      // A loop carries on round: the same trip's segment minutes again.
      if (loop && k >= stops.length) {
        k = 1;
        lap++;
      }
    }
    if (stops[k] !== stop.id) return { ...stop };
    const base = lap ? (trip.departures?.at(-1) ?? trip.arrivals?.at(-1)) - (trip.departures?.[0] ?? trip.arrivals?.[0]) : 0,
      arrival = at(k, trip.arrivals),
      departure = at(k, trip.departures);
    if (!Number.isFinite(arrival ?? departure) || !Number.isFinite(base)) return { ...stop };
    const a = (arrival ?? departure) + base,
      d = (departure ?? arrival) + base;
    return {
      ...stop,
      time: a,
      arrival: a,
      departure: d,
      estimated: lap > 0 || (service.officialFallback ? !read?.has(k) && k !== 0 : false) || Boolean(stop.estimated),
    };
  });
  if (!officialStops.some((stop) => Number.isFinite(stop.time))) return null;
  return {
    ...ride,
    officialStops,
    scheduledDepart: chosen.depart,
    tripId: trip.id ?? ride.tripId ?? null,
    timedFrom: {
      serviceId: service.id,
      headsign: trip.headsign || null,
      source: feed?.meta?.source ?? feed?.source ?? null,
    },
  };
}
