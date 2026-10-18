import { stopTime } from "./journey-core.js";

// Takeda uses K15 in the shared stop catalog (B05 on Kintetsu signage).
// Only an official service spanning both sides of Takeda may extend a ride;
// never infer a through train from a station name or a nearby departure.
const side = (id) =>
  id === "K15" ? null :
  /^K(?:0[1-9]|1[0-4])$/.test(id ?? "") ? "metro" :
  /^[BA]\d{2}$/.test(id ?? "") ? "kintetsu" : null;

export function spansTakeda(stops = []) {
  const ids = stops.map((stop) => typeof stop === "string" ? stop : stop.id);
  const at = ids.indexOf("K15");
  return at > 0 && at < ids.length - 1 &&
    side(ids[at - 1]) !== null &&
    side(ids[at + 1]) !== null &&
    side(ids[at - 1]) !== side(ids[at + 1]);
}

const minuteAt = (trip, i) =>
  [trip?.arrivals?.[i], trip?.departures?.[i]].find(Number.isFinite) ?? null;

const sameServiceDay = (ride, trip) =>
  !ride.serviceDate || !(trip.serviceDate ?? trip.date) ||
  ride.serviceDate === (trip.serviceDate ?? trip.date);

// A split official feed can lack the same service/trip identifier. In that
// case a unique, exact three-station timetable overlap is accepted ONLY when
// the rider explicitly selected a destination beyond the boundary.
export function findThroughContinuation(
  ride,
  feeds = [],
  { minute, network, toleranceMinutes = 1 } = {},
) {
  const existing = ride?.officialStops ?? [];
  if (
    !["subway", "kintetsu"].includes(ride?.operator) ||
    existing.length < 2 ||
    existing.at(-1)?.id !== "K15" ||
    !Number.isFinite(minute) ||
    !Number.isFinite(stopTime(existing.at(-1))) ||
    Math.abs(minute - stopTime(existing.at(-1))) > 15 ||
    ride?.userDestination?.id === "K15" ||
    ride?.userDestinationId === "K15"
  ) return null;

  const selectedId = ride.userDestination?.id ?? ride.userDestinationId ?? null;
  const candidates = new Map();
  for (const feed of feeds) for (const service of feed?.services ?? []) {
    if (service.operator !== "through" || !spansTakeda(service.stops)) continue;
    const start = service.stops.indexOf(existing[0].id);
    if (
      start < 0 || start + existing.length > service.stops.length ||
      !existing.every((stop, i) => stop.id === service.stops[start + i])
    ) continue;
    const takedaIndex = start + existing.length - 1;
    if (
      service.stops[takedaIndex] !== "K15" ||
      side(service.stops[start]) !== side(existing.at(-2).id)
    ) continue;
    // An explicitly selected stop on this side (including Takeda) means
    // that leaving the train is intentional, not a through continuation.
    if (selectedId && !service.stops.slice(takedaIndex + 1).includes(selectedId))
      continue;

    for (const trip of service.trips ?? []) {
      if (!sameServiceDay(ride, trip)) continue;
      const overlap = existing.slice(-Math.min(existing.length, 3));
      const offset = existing.length - overlap.length;
      if (!overlap.every((stop, i) => {
        const from = start + offset + i;
        const scheduled = minuteAt(trip, from);
        const current = stopTime(stop);
        return Number.isFinite(current) && Number.isFinite(scheduled) &&
          Math.abs(current - scheduled) <= toleranceMinutes;
      })) continue;
      const identicalTrip = Boolean(
        ride.serviceId && ride.tripId &&
        ride.serviceId === service.id && ride.tripId === trip.id,
      );
      if (!identicalTrip && (!selectedId || overlap.length < 3)) continue;

      const after = service.stops.slice(takedaIndex + 1);
      if (!after.length || after.some((id) => !network?.stops?.has(id))) continue;
      const extension = after.map((id, i) => {
        const index = takedaIndex + i + 1;
        const arrival = trip.arrivals?.[index];
        const departure = trip.departures?.[index];
        const time = Number.isFinite(arrival) ? arrival : departure;
        return {
          id, name: network.stops.get(id).name ?? id,
          arrival: Number.isFinite(arrival) ? arrival : time,
          departure: Number.isFinite(departure) ? departure : time,
          time, estimated: false,
        };
      });
      if (extension.some((stop) => !Number.isFinite(stop.time))) continue;
      const key = JSON.stringify([service.id, trip.id, trip.serviceDate ?? trip.date]);
      candidates.set(key, {
        ...ride,
        operator: "through",
        serviceId: service.id,
        tripId: trip.id,
        serviceDate: trip.serviceDate ?? trip.date ?? ride.serviceDate,
        category: service.category ?? ride.category,
        destination: trip.headsign ?? ride.destination,
        officialStops: [...existing, ...extension],
        to: extension.at(-1).id,
        arrive: stopTime(extension.at(-1)),
        fullTerminus: true,
        syntheticTimes: false,
        throughContinuation: "official-timetable",
      });
    }
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}
