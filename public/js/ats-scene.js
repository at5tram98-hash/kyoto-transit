// ATS scene engine. Judges the rider's situation from a sensor snapshot
// (ats-sensors.js) and steadies it over time, so one jittery fix does not
// flip the screen between "at the stop" and "walking".
//   riding_bus / riding_train – a ride is in progress (confirmed)
//   checking   – a ride is being re-checked
//   home       – within reach of the home point and not travelling
//   at_stop    – standing at a bus stop (with how long)
//   at_station – at a subway or Kintetsu station
//   vehicle    – moving at vehicle speed (or, underground with no GPS, the
//                accelerometer shows a vehicle), ride not identified yet
//   walking    – moving on foot
//   nearby     – located, none of the above
//   unknown    – nothing usable
import { distance } from "./mobility.js";

export const HOME_RADIUS = 120;
export const SCENE_HOLD_MS = 10000;
const STOP_RADIUS = 40;
const STATION_RADIUS = 150;
const VEHICLE_SPEED = 5.5;
const WALK_SPEED = 0.6;

const busOperator = (operator) => ["citybus", "kyotobus"].includes(operator);

export function classifyScene(snap) {
  const ride = snap?.ride?.active;
  if (ride)
    return {
      scene: busOperator(ride.operator) ? "riding_bus" : "riding_train",
      confidence: 1,
      evidence: [{ key: "ride" }],
    };
  if (snap?.ride?.phase === "rechecking")
    return { scene: "checking", confidence: 0.5, evidence: [{ key: "recheck" }] };
  const located = ["precise", "coarse"].includes(snap?.location?.quality),
    activity = snap?.motion?.activity ?? "unknown",
    speed = snap?.speed?.value ?? null,
    evidence = [{ key: "location", value: snap?.location?.quality ?? "missing" }];
  if (activity !== "unknown") evidence.push({ key: "motion", value: activity });
  if (speed !== null) evidence.push({ key: "speed", value: Math.round(speed * 3.6) });
  // Underground: no GPS, but the accelerometer can still tell a vehicle.
  if (!located)
    return activity === "vehicle"
      ? { scene: "vehicle", confidence: 0.5, evidence }
      : { scene: "unknown", confidence: 0, evidence };
  const fix = snap.location.fix,
    accuracy = snap.location.accuracy ?? 50;
  evidence.push({ key: "accuracy", value: Math.round(accuracy) });
  if ((speed !== null && speed >= VEHICLE_SPEED) || (activity === "vehicle" && speed !== null && speed >= 2.8))
    return { scene: "vehicle", confidence: activity === "vehicle" ? 0.8 : 0.6, evidence };
  const home = snap.context?.home;
  if (home && (speed === null || speed < 2) && activity !== "vehicle") {
    const meters = distance(fix, home);
    if (meters <= Math.max(HOME_RADIUS, Math.min(accuracy, 250))) {
      evidence.push({ key: "home", value: Math.round(meters) });
      return { scene: "home", confidence: meters <= HOME_RADIUS / 2 ? 0.9 : 0.7, evidence };
    }
  }
  const nearby = snap.context?.nearby ?? [],
    closest = (test) => nearby.find((row) => test(row.stop?.type)),
    stop = closest(busOperator),
    station = closest((type) => type === "subway" || type === "kintetsu"),
    walking = activity === "walking" || (speed !== null && speed >= WALK_SPEED),
    still = !walking;
  if (still && station && station.meters <= STATION_RADIUS) {
    evidence.push({ key: "place", name: station.stop.name, value: Math.round(station.meters) });
    return { scene: "at_station", confidence: station.meters <= 60 ? 0.8 : 0.6, place: station, evidence };
  }
  if (still && stop && stop.meters <= Math.max(STOP_RADIUS, Math.min(accuracy, 60))) {
    evidence.push({ key: "place", name: stop.stop.name, value: Math.round(stop.meters) });
    return { scene: "at_stop", confidence: stop.meters <= 20 ? 0.8 : 0.6, place: stop, evidence };
  }
  if (walking) return { scene: "walking", confidence: 0.6, place: stop ?? station ?? null, evidence };
  return { scene: "nearby", confidence: 0.5, place: nearby[0] ?? null, evidence };
}

// Scenes that take effect at once: a ride starts or ends, or the location
// is lost. Others must hold for SCENE_HOLD_MS (or be judged with high
// confidence) before the screen follows.
const IMMEDIATE = new Set(["riding_bus", "riding_train", "checking"]);

export function assessScene(snap, memory = {}) {
  const now = snap?.at ?? Date.now(),
    raw = classifyScene(snap),
    samePlace = (a, b) => (a?.id ?? null) === (b?.id ?? null);
  if (!memory.scene || (raw.scene === memory.scene && samePlace(raw.place, memory.place)))
    return { ...raw, since: memory.scene === raw.scene ? memory.since : now, memory: { scene: raw.scene, place: raw.place ?? null, since: memory.scene === raw.scene ? memory.since : now } };
  const switchNow =
    IMMEDIATE.has(raw.scene) ||
    IMMEDIATE.has(memory.scene) ||
    // The first usable reading is shown at once.
    memory.scene === "unknown" ||
    raw.confidence >= 0.8 ||
    (memory.pending?.scene === raw.scene && now - memory.pending.since >= SCENE_HOLD_MS);
  if (switchNow)
    return { ...raw, since: now, memory: { scene: raw.scene, place: raw.place ?? null, since: now } };
  const pending = memory.pending?.scene === raw.scene ? memory.pending : { scene: raw.scene, since: now };
  return {
    scene: memory.scene,
    confidence: memory.confidence ?? raw.confidence,
    place: memory.place ?? null,
    evidence: raw.evidence,
    since: memory.since,
    pending: raw.scene,
    memory: { ...memory, pending },
  };
}
