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

// The static feeds split a through train at Takeda. Kintetsu lists a
// northbound through train (headsign 国際会館 etc.) only up to Fushimi or
// Tambabashi, and the subway lists it from Takeda; a southbound one appears
// in the subway feed up to Takeda and in the Kintetsu feed from Takeda.
// These helpers list the possible continuations and build the joined ride;
// deciding which one is this train is left to the caller's evidence.
export function throughDirection(ride) {
  const stops = ride?.officialStops ?? [],
    last = stops.at(-1);
  if (stops.length < 2 || ride?.throughContinuation) return null;
  if (ride.operator === "kintetsu" && side(last?.id) === "kintetsu") return "north";
  if (ride.operator === "subway" && last?.id === "K15" && side(stops.at(-2)?.id) === "metro")
    return "south";
  return null;
}

export function throughContinuations(
  ride,
  { subwayFeed, kintetsuFeed, window = [1, 10] } = {},
) {
  const direction = throughDirection(ride);
  if (!direction) return [];
  const stops = ride.officialStops,
    reference = direction === "north" ? stops.at(-1) : stops.at(-2),
    at = [reference.departure, reference.time, reference.arrival].find(Number.isFinite);
  if (!Number.isFinite(at)) return [];
  const feed = direction === "north" ? subwayFeed : kintetsuFeed,
    wantSide = direction === "north" ? "metro" : "kintetsu",
    clean = (v) => String(v ?? "").replace(/行き?$/, ""),
    rows = [];
  for (const service of feed?.services ?? []) {
    if (service.stops?.[0] !== "K15" || side(service.stops[1]) !== wantSide) continue;
    for (const trip of service.trips ?? []) {
      if (!sameServiceDay(ride, trip)) continue;
      const depart = minuteAt(trip, 0);
      if (!Number.isFinite(depart)) continue;
      const gap = depart - at;
      if (gap < window[0] || gap > window[1]) continue;
      // Northbound through trains already carry the subway destination.
      if (direction === "north" && clean(trip.headsign) !== clean(ride.destination)) continue;
      rows.push({ service, trip, gap, depart, headsign: trip.headsign ?? null, direction });
    }
  }
  return rows.sort((a, b) => a.gap - b.gap);
}

export function applyThroughContinuation(ride, continuation, network, source) {
  const { service, trip, direction } = continuation;
  const rows = service.stops.map((id, i) => {
    const arrivalAt = trip.arrivals?.[i],
      departure = trip.departures?.[i],
      time = Number.isFinite(arrivalAt) ? arrivalAt : departure;
    return {
      id,
      name: network?.stops?.get(id)?.name ?? id,
      arrival: Number.isFinite(arrivalAt) ? arrivalAt : time,
      departure: Number.isFinite(departure) ? departure : time,
      time,
      estimated: false,
    };
  });
  if (rows.length < 2 || rows.some((s) => !Number.isFinite(s.time))) return null;
  const existing = ride.officialStops,
    last = existing.at(-1);
  // Southbound, the subway half already ends at Takeda: keep its arrival
  // and take the Kintetsu departure from there.
  const joined =
    direction === "south"
      ? [...existing.slice(0, -1), { ...last, departure: rows[0].departure }, ...rows.slice(1)]
      : [...existing, ...rows];
  return {
    ...ride,
    operator: "through",
    officialStops: joined,
    destination: trip.headsign ?? ride.destination,
    to: joined.at(-1).id,
    arrive: stopTime(joined.at(-1)),
    continuationServiceId: service.id,
    continuationTripId: trip.id,
    fullTerminus: true,
    syntheticTimes: false,
    throughContinuation: source,
  };
}

// Join without asking only when the evidence names one train: the official
// Takeda departure of this Kintetsu train, a destination heard in the car or
// chosen by the rider beyond Takeda, or (northbound) a single candidate.
export function joinThroughFromFeeds(
  ride,
  {
    subwayFeed,
    kintetsuFeed,
    network,
    takedaDeparture = null,
    heardDestinations = [],
  } = {},
) {
  const direction = throughDirection(ride);
  if (!direction) return null;
  const selectedId = ride.userDestination?.id ?? ride.userDestinationId ?? null;
  if (selectedId && ride.officialStops.some((s) => s.id === selectedId)) return null;
  const rows = throughContinuations(ride, { subwayFeed, kintetsuFeed });
  if (!rows.length) return null;
  const pick = (list, source) =>
    list.length === 1 ? applyThroughContinuation(ride, list[0], network, source) : null;
  if (Number.isFinite(takedaDeparture))
    return pick(rows.filter((r) => r.depart === takedaDeparture), "official-trip");
  const names = (id) => [network?.stops?.get(id)?.name, id].filter(Boolean),
    beyond = (r) => r.service.stops.slice(1),
    heard = rows.filter((r) =>
      heardDestinations.some(
        (id) => beyond(r).includes(id) && names(id).some((n) => String(r.headsign ?? "").includes(n)),
      ),
    );
  if (heard.length) return pick(heard, "announcement");
  if (selectedId) {
    const reaching = rows.filter((r) => beyond(r).includes(selectedId));
    return pick(reaching.slice(0, 1), "selected-destination");
  }
  if (direction === "north") {
    const close = rows.filter((r) => r.gap >= 3 && r.gap <= 8);
    return pick(close, "timetable-join");
  }
  return null;
}
