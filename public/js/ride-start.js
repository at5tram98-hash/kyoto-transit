// Planning onward from the ride the rider is on: they pick where they will
// get off, and the search starts there at the ride's expected arrival
// (timetable time plus the ride's measured delay). Only the stops still
// ahead are offered.
import { stopTime } from "./journey-core.js";

const clock = (minute) =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(Math.floor(minute) % 60).padStart(2, "0")}`;

// The stops still ahead of the rider, each with its expected arrival
// (null when the ride has no times there).
export function rideAlightOptions(ride, { minute, shift = 0, nextId = null } = {}) {
  const stops = ride?.officialStops ?? [];
  if (stops.length < 2) return [];
  let start = nextId ? stops.findIndex((s, i) => i > 0 && s.id === nextId) : -1;
  if (start < 0 && Number.isFinite(minute))
    start = stops.findIndex((s, i) => i > 0 && Number.isFinite(stopTime(s)) && stopTime(s) + shift >= minute - 0.5);
  if (start < 0) start = 1;
  return stops.slice(start).map((stop) => {
    const time = stopTime(stop);
    return {
      id: stop.id,
      name: stop.name,
      arrive: Number.isFinite(time) ? Math.round(time + (Number.isFinite(shift) ? shift : 0)) : null,
      estimated: Boolean(stop.estimated),
    };
  });
}

// The search input that starts at the chosen stop when the ride gets there.
// Without a time there, the search starts now (and says so).
export function rideStartInput(ride, option, now) {
  const arrive = Number.isFinite(option?.arrive) ? Math.max(option.arrive, now.minute) : now.minute,
    // A trip past midnight keeps its service date; the clock wraps.
    date = new Date(`${now.date}T00:00:00Z`);
  if (arrive >= 1440) date.setUTCDate(date.getUTCDate() + 1);
  return {
    fromId: option.id,
    from: option.name,
    date: date.toISOString().slice(0, 10),
    time: clock(arrive),
    timeMode: "departure",
    rideStart: {
      operator: ride.operator,
      route: ride.route ?? null,
      label: ride.label ?? null,
      destination: ride.destination ?? null,
      tripId: typeof ride.tripId === "string" ? ride.tripId : null,
      alightId: option.id,
      alightName: option.name,
      arrive: Number.isFinite(option.arrive) ? option.arrive : null,
    },
  };
}

export { clock as rideClock };
