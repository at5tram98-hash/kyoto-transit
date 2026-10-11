import { distance } from "./mobility.js";
import { freshFix } from "./riding.js";
import { subwayIds, kintetsuIds } from "./network.js";

export const stopTime = (stop) =>
  [stop?.arrival, stop?.time, stop?.departure].find(Number.isFinite) ?? null;
const geometry = new WeakMap();
function stopPoints(geo) {
  let cached = geometry.get(geo);
  if (!cached || cached.count !== geo.stops.length) {
    cached = {
      count: geo.stops.length,
      points: new Map(geo.stops.map((s) => [s.id, s])),
    };
    geometry.set(geo, cached);
  }
  return cached.points;
}

export function journeyClock(ride, now) {
  let serviceDate = ride?.serviceDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate ?? "")) {
    const stops = ride?.officialStops ?? [],
      start = stopTime(stops[0]),
      end = stopTime(stops.at(-1));
    serviceDate = now.date;
    if (now.minute < 360 && start >= 1080 && end >= 1440) {
      const day = new Date(`${now.date}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() - 1);
      serviceDate = day.toISOString().slice(0, 10);
    }
  }
  const offset =
    Math.round((Date.parse(now.date) - Date.parse(serviceDate)) / 86400000) *
    1440;
  return { ...now, date: serviceDate, minute: now.minute + offset };
}

// Times stay unknown when the operator only supplies a sequence of stops.
export function journeyProgress(
  ride,
  {
    minute,
    shift = 0,
    fix = null,
    geo = null,
    trail = [],
    at = Date.now(),
  } = {},
) {
  const stops = ride?.officialStops ?? [],
    bus = ["citybus", "kyotobus"].includes(ride?.operator);
  const delay = Number.isFinite(shift) ? shift : 0;
  let nextIndex = stops.findIndex(
    (s) => Number.isFinite(stopTime(s)) && stopTime(s) + delay > minute,
  );
  let currentIndex = -1,
    source = "schedule";
  const last = trail.at(-1),
    previousTrail = trail.at(-2),
    previousIndex = previousTrail
      ? stops.findIndex((s) => s.id === previousTrail.id)
      : -1;
  const observed =
    bus && last && at - last.at < 8 * 60000
      ? stops.map((s, i) => (s.id === last.id ? i : -1)).filter((i) => i >= 0)
      : [];
  const observedIndex =
    observed.find((i) => i > previousIndex) ?? observed[0] ?? -1;
  if (freshFix(fix, at) && geo?.stops) {
    const points = stopPoints(geo);
    const close = stops
      .map((s, i) => ({
        i,
        s,
        meters: points.has(s.id) ? distance(fix, points.get(s.id)) : Infinity,
      }))
      .filter(
        (p) =>
          p.meters <= Math.max(45, Math.min(90, (fix.accuracy ?? 30) * 1.6)) &&
          (!Number.isFinite(stopTime(p.s)) ||
            Math.abs(stopTime(p.s) + delay - minute) <= 20),
      )
      .sort(
        (a, b) =>
          a.meters - b.meters ||
          (a.i === observedIndex ? -1 : b.i === observedIndex ? 1 : 0),
      )[0];
    if (close) {
      currentIndex = close.i;
      nextIndex = Math.min(close.i + 1, stops.length - 1);
      source = "location";
    }
  }
  if (currentIndex < 0 && bus) {
    const index = observedIndex;
    if (index >= 0) {
      currentIndex = index;
      nextIndex = Math.min(index + 1, stops.length - 1);
      source = "location";
    }
  }
  if (nextIndex < 0 && stops.length) {
    nextIndex = stops.every((s) => !Number.isFinite(stopTime(s)))
      ? Math.min(1, stops.length - 1)
      : stops.length - 1;
    source = stops.every((s) => !Number.isFinite(stopTime(s)))
      ? "unknown"
      : source;
  }
  const next = stops[nextIndex] ?? null,
    previous = stops[Math.max(0, nextIndex - 1)] ?? null;
  let fraction = 0;
  if (currentIndex >= 0)
    fraction = currentIndex / Math.max(1, stops.length - 1);
  else if (next) {
    const a = stopTime(previous),
      b = stopTime(next),
      segment =
        Number.isFinite(a) && Number.isFinite(b) && b > a
          ? Math.max(0, Math.min(1, (minute - delay - a) / (b - a)))
          : 0;
    fraction =
      (Math.max(0, nextIndex - 1) + segment) / Math.max(1, stops.length - 1);
  }
  return {
    stops,
    nextIndex,
    currentIndex,
    next,
    previous,
    source,
    fraction,
    remaining:
      currentIndex === stops.length - 1
        ? 0
        : Math.max(0, stops.length - nextIndex),
    arrival: Number.isFinite(stopTime(next)) ? stopTime(next) + delay : null,
    endArrival: Number.isFinite(stopTime(stops.at(-1)))
      ? stopTime(stops.at(-1)) + delay
      : null,
  };
}

// Use the local portion of a through service; its endpoints can belong to
// different axes, and the terminus still has a valid reverse direction.
export function reverseDirection(ride, stopId) {
  const stops = ride?.officialStops ?? [],
    index = stops.findIndex((s) => s.id === stopId);
  if (index < 0) return null;
  const axes =
    stopId.startsWith("K") && stopId !== "K15"
      ? [subwayIds]
      : stopId === "K15"
        ? [subwayIds, kintetsuIds]
        : [kintetsuIds];
  for (const offset of [1, -1])
    for (const axis of axes) {
      const a = axis.indexOf(stopId);
      if (a < 0) continue;
      for (let i = index + offset; i >= 0 && i < stops.length; i += offset) {
        const b = axis.indexOf(stops[i].id);
        if (b < 0 || a === b) continue;
        const south = offset === 1 ? b > a : a > b;
        return south ? "north" : "south";
      }
    }
  return ["north", "south"].includes(ride.direction)
    ? ride.direction === "south"
      ? "north"
      : "south"
    : null;
}

export function foldbackCandidates(ride, minute, shift = 0) {
  const stops = ride?.officialStops ?? [],
    index = stops.findIndex(
      (s) => !Number.isFinite(stopTime(s)) || stopTime(s) + shift >= minute - 1,
    );
  return index >= 0 ? stops.slice(index) : stops.slice(-1);
}

export function assessFoldback(
  stop,
  depart,
  { shift = 0, buffer = 3, now = -Infinity } = {},
) {
  const scheduled = stopTime(stop);
  if (
    !Number.isFinite(scheduled) ||
    !Number.isFinite(depart) ||
    !Number.isFinite(shift)
  )
    return { status: "unknown", arrival: null, slack: null };
  const arrival = scheduled + shift,
    slack = depart - Math.max(arrival, now) - buffer;
  return {
    status: slack < 0 ? "missed" : slack < 2 ? "tight" : "possible",
    arrival,
    slack,
    buffer,
  };
}

export function foldbackServiceDay(date, minute) {
  const offset = Math.floor(minute / 1440),
    day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offset);
  return { date: day.toISOString().slice(0, 10), offset: offset * 1440 };
}
