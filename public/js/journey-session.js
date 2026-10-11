import { journeyClock, stopTime, reverseDirection } from "./journey-core.js";
import { normalize } from "./network.js";

export const JOURNEY_KEY = "mymap-active-journey-v1";
const operators = new Set([
  "subway",
  "kintetsu",
  "through",
  "citybus",
  "kyotobus",
]);
export const journeyKey = (ride) =>
  ride
    ? JSON.stringify([
        ride.operator,
        ride.route,
        ride.from,
        ride.to,
        ride.depart,
        ride.destination,
      ])
    : "";

export function boardingAvailable(ride, now) {
  if (
    !ride ||
    !operators.has(ride.operator) ||
    !Array.isArray(ride.officialStops) ||
    ride.officialStops.length < 2
  )
    return false;
  const clock = journeyClock(ride, now),
    start = ride.depart ?? stopTime(ride.officialStops[0]),
    end = ride.arrive ?? stopTime(ride.officialStops.at(-1));
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    clock.minute >= start - 10 &&
    clock.minute <= end + 10
  );
}

// Resolve a selected route back to the official trip, retaining every stop
// through the terminus rather than ending the display at the search destination.
export function scheduledJourney(leg, feed, network, date) {
  const service = feed?.services?.find((s) => s.id === leg.serviceId),
    trip = service?.trips?.find(
      (t) => t.id === leg.tripId && (!t.date || t.date === date),
    );
  const start = service?.stops?.indexOf(leg.from) ?? -1;
  if (!trip || start < 0) return null;
  const stops = service.stops.slice(start).map((id, n) => {
    const i = start + n;
    return {
      id,
      name: network.stops.get(id)?.name ?? id,
      arrival: trip.arrivals[i],
      departure: trip.departures[i],
      time: trip.arrivals[i] ?? trip.departures[i],
      estimated: Boolean(
        feed.meta?.terminalArrivalDerived && i === service.stops.length - 1,
      ),
    };
  });
  if (stops.length < 2 || !stops.every((s) => Number.isFinite(stopTime(s))))
    return null;
  return {
    kind: "ride",
    operator: service.operator,
    category: service.category,
    route: service.route,
    label: service.label,
    destination: trip.headsign ?? stops.at(-1).name,
    from: leg.from,
    to: stops.at(-1).id,
    depart: stops[0].departure,
    arrive: stopTime(stops.at(-1)),
    officialStops: stops,
    tripId: trip.id,
    serviceId: service.id,
    serviceDate: trip.date ?? date,
    fullTerminus: true,
  };
}

export function scheduledBoarding(feed, selection, network) {
  const destination = (value) =>
    normalize(String(value ?? "").replace(/行き?$|方面$|駅$/g, ""));
  const matches = new Map();
  for (const service of feed?.services ?? []) {
    const index = service.stops.indexOf(selection.stopId);
    if (index < 0) continue;
    for (const trip of service.trips ?? []) {
      if (
        trip.date !== selection.date ||
        trip.departures[index] !== selection.depart ||
        (selection.tripId && trip.id !== selection.tripId) ||
        (selection.destination &&
          destination(trip.headsign) !== destination(selection.destination))
      )
        continue;
      const ride = scheduledJourney(
        { serviceId: service.id, tripId: trip.id, from: selection.stopId },
        feed,
        network,
        selection.date,
      );
      if (
        ride &&
        reverseDirection(ride, selection.stopId) ===
          (selection.direction === "north" ? "south" : "north")
      )
        matches.set(`${trip.id}|${service.id}`, ride);
    }
  }
  // An unlabeled departure must not silently pick one of several services.
  return matches.size === 1 ? [...matches.values()][0] : null;
}

export function readJourney(storage, { now, at = Date.now(), network } = {}) {
  try {
    const raw = storage.getItem(JOURNEY_KEY);
    if (!raw || raw.length > 120000) return null;
    const value = JSON.parse(raw),
      ride = value?.ride,
      stops = ride?.officialStops;
    if (
      value?.version !== 1 ||
      !operators.has(ride?.operator) ||
      !Number.isFinite(value.savedAt) ||
      !Number.isFinite(value.startedAt) ||
      value.savedAt > at + 60000 ||
      value.startedAt > at + 60000 ||
      at - value.savedAt > 4 * 3600000 ||
      at - value.startedAt > 6 * 3600000 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(ride.serviceDate ?? "") ||
      !Array.isArray(stops) ||
      stops.length < 2 ||
      stops.length > 250 ||
      !network.stops.has(ride.from) ||
      !stops.every(
        (s) =>
          s &&
          typeof s.name === "string" &&
          s.name.length <= 180 &&
          (s.id == null || typeof s.id === "string") &&
          [s.arrival, s.time, s.departure].every(
            (t) => t == null || (Number.isFinite(t) && t >= 0 && t <= 2880),
          ),
      ) ||
      !Number.isFinite(value.shift) ||
      Math.abs(value.shift) > 120
    )
      return null;
    const clock = journeyClock(ride, now),
      start = ride.depart ?? stopTime(stops[0]),
      end = ride.arrive ?? stopTime(stops.at(-1));
    if (!Number.isFinite(clock.minute)) return null;
    const plan = value.foldbackPlan;
    const validPlan =
      plan &&
      plan.rideKey === journeyKey(ride) &&
      stops.some((s) => s.id === plan.stopId) &&
      Number.isFinite(plan.depart) &&
      plan.depart >= clock.minute - 5 &&
      plan.depart <= 2880 &&
      [2, 3, 5, 8].includes(plan.buffer) &&
      ["north", "south"].includes(plan.direction) &&
      typeof plan.destination === "string" &&
      plan.destination.length <= 180 &&
      /^\d{4}-\d{2}-\d{2}$/.test(plan.date ?? "");
    if (
      Number.isFinite(end)
        ? clock.minute < start - 10 ||
          clock.minute >
            Math.max(
              end + value.shift + 30,
              validPlan ? plan.depart + 5 : -Infinity,
            )
        : at - value.startedAt > 3 * 3600000 || clock.date !== now.date
    )
      return null;
    return {
      ride,
      rideShift: value.shift,
      rideSource:
        typeof value.source === "string"
          ? value.source.slice(0, 180)
          : "保存した乗車案内",
      rideConfidence: 0,
      rideStartedAt: value.startedAt,
      foldbackPlan: validPlan ? plan : null,
    };
  } catch {
    return null;
  }
}

export function writeJourney(storage, state, { now, at = Date.now() } = {}) {
  try {
    if (!state.ride) {
      storage.removeItem(JOURNEY_KEY);
      return;
    }
    const ride = {
      ...state.ride,
      serviceDate: journeyClock(state.ride, now).date,
    };
    // No GPS coordinates or location history are stored with the journey.
    delete ride.officialTrip;
    storage.setItem(
      JOURNEY_KEY,
      JSON.stringify({
        version: 1,
        ride,
        shift: state.rideShift,
        source: state.rideSource,
        startedAt: state.rideStartedAt || at,
        savedAt: at,
        foldbackPlan: state.foldbackPlan,
      }),
    );
  } catch {
    /* The active display still works when storage is unavailable. */
  }
}
