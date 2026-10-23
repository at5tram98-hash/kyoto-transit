// Bus check-in. Telling which bus a rider boarded from location alone is
// unreliable, so the rider picks the route at their stop and checks in with a
// shake (or a double press of volume-down where the browser reports it).
// This module holds the pure parts: the choices at a stop and the gesture
// detectors. checkin-sheet.js presents them.
import { cityBusRideCandidates, kyotoBusStaticCandidates } from "./vnext-core.js";

const BUS = new Set(["citybus", "kyotobus"]);

// The bus stops a rider could be standing at, nearest first. City bus and
// Kyoto Bus poles of the same name are kept as separate entries.
export function checkInStops(nearby = [], { radius = 300, limit = 4 } = {}) {
  const seen = new Set();
  return nearby
    .filter((row) => BUS.has(row?.stop?.type) && row.meters <= radius)
    .filter((row) => !seen.has(row.id) && seen.add(row.id))
    .slice(0, limit);
}

// Every route and direction leaving this stop. City bus directions come from
// the route network (one entry per terminus); Kyoto Bus entries come from the
// static timetable, the departure nearest to now for each route and headsign.
export function checkInChoices(stop, { network, minute, kyotoFeed } = {}) {
  if (!stop || !network) return [];
  const choices = new Map();
  if (stop.type === "citybus") {
    const routes = new Set(
      (network.services ?? [])
        .filter(
          (s) =>
            s.operator === "citybus" &&
            s.stops?.includes(stop.id) &&
            s.stops.indexOf(stop.id) < s.stops.length - 1,
        )
        .map((s) => String(s.route)),
    );
    for (const route of routes)
      for (const ride of cityBusRideCandidates({
        route,
        currentStopId: stop.id,
        trail: [],
        network,
        minute,
      })) {
        const key = `citybus|${route}|${ride.to}`;
        if (!choices.has(key)) choices.set(key, { key, ride });
      }
  }
  if (stop.type === "kyotobus" && kyotoFeed) {
    const rides = kyotoBusStaticCandidates(kyotoFeed, {
      fromId: stop.id,
      minute,
      network,
      windowBefore: 20,
      windowAfter: 30,
    });
    for (const ride of rides) {
      const key = `kyotobus|${ride.route}|${ride.destination}`,
        old = choices.get(key);
      if (!old || Math.abs(ride.depart - minute) < Math.abs(old.ride.depart - minute))
        choices.set(key, { key, ride });
    }
  }
  const number = (route) => {
    const n = Number(String(route).replace(/\D/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 9999;
  };
  return [...choices.values()].sort(
    (a, b) =>
      number(a.ride.route) - number(b.ride.route) ||
      String(a.ride.route).localeCompare(String(b.ride.route), "ja") ||
      String(a.ride.destination).localeCompare(String(b.ride.destination), "ja"),
  );
}

// A deliberate shake: several sharp swings within a short window. Ordinary
// walking or a bus pulling away stays well under the threshold.
export function createShakeDetector({
  threshold = 13,
  peaks = 3,
  window = 1200,
  gap = 110,
  cooldown = 2000,
} = {}) {
  let hits = [],
    lastHit = -Infinity,
    lastFire = -Infinity;
  return function sample({ x, y, z, gravity = false }, at) {
    if (![x, y, z].every(Number.isFinite)) return false;
    const magnitude = Math.hypot(x, y, z),
      force = gravity ? Math.abs(magnitude - 9.81) : magnitude;
    if (at - lastFire < cooldown) return false;
    if (force >= threshold && at - lastHit >= gap) {
      lastHit = at;
      hits = [...hits.filter((t) => at - t <= window), at];
      if (hits.length >= peaks) {
        hits = [];
        lastFire = at;
        return true;
      }
    }
    return false;
  };
}

const VOLUME_DOWN = new Set(["AudioVolumeDown", "VolumeDown"]);
// Two presses of volume-down in quick succession. Only browsers that pass
// hardware volume keys to the page deliver these key events.
export function createVolumeDoublePress({ within = 650 } = {}) {
  let last = -Infinity;
  return function press(key, at) {
    if (!VOLUME_DOWN.has(key)) return false;
    const fired = at - last <= within;
    last = fired ? -Infinity : at;
    return fired;
  };
}
