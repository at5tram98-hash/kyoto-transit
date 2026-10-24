// ATS: what situation the rider is in, from what the app already knows.
// Each scene lists the evidence it rests on, so the screen can say why.
//   riding_bus / riding_train – a ride is in progress (confirmed)
//   checking   – a ride is being re-checked
//   home       – within reach of the home point and not travelling
//   at_stop    – standing at a bus stop
//   at_station – at a subway or Kintetsu station
//   vehicle    – moving at vehicle speed, ride not identified yet
//   walking    – moving on foot
//   nearby     – located, none of the above
//   unknown    – no usable location
import { distance } from "./mobility.js";

export const HOME_RADIUS = 120;
const STOP_RADIUS = 40;
const STATION_RADIUS = 150;
const VEHICLE_SPEED = 5.5;
const WALK_SPEED = 0.6;

const busOperator = (operator) => ["citybus", "kyotobus"].includes(operator);

export function classifyScene({
  ride = null,
  rechecking = false,
  fix = null,
  speed = null,
  nearby = [],
  home = null,
  now = Date.now(),
} = {}) {
  if (ride)
    return {
      scene: busOperator(ride.operator) ? "riding_bus" : "riding_train",
      confidence: 1,
      evidence: [{ key: "ride" }],
    };
  if (rechecking) return { scene: "checking", confidence: 0.5, evidence: [{ key: "recheck" }] };
  const fresh =
    fix && [fix.lat, fix.lng].every(Number.isFinite) && now - fix.timestamp <= 60000;
  if (!fresh) return { scene: "unknown", confidence: 0, evidence: [{ key: "no_location" }] };
  const accuracy = Number.isFinite(fix.accuracy) ? fix.accuracy : 50,
    moving = Number.isFinite(speed) ? speed : null,
    still = moving === null || moving < WALK_SPEED,
    evidence = [{ key: "accuracy", value: Math.round(accuracy) }];
  if (moving !== null) evidence.push({ key: "speed", value: Math.round(moving * 3.6) });
  if (moving !== null && moving >= VEHICLE_SPEED)
    return { scene: "vehicle", confidence: 0.6, evidence };
  if (home && (moving === null || moving < 2)) {
    const meters = distance(fix, home);
    if (meters <= Math.max(HOME_RADIUS, Math.min(accuracy, 250))) {
      evidence.push({ key: "home", value: Math.round(meters) });
      return { scene: "home", confidence: meters <= HOME_RADIUS / 2 ? 0.9 : 0.7, evidence };
    }
  }
  const closest = (test) => nearby.find((row) => test(row.stop?.type));
  const stop = closest((type) => busOperator(type)),
    station = closest((type) => type === "subway" || type === "kintetsu");
  if (still && station && station.meters <= STATION_RADIUS) {
    evidence.push({ key: "place", name: station.stop.name, value: Math.round(station.meters) });
    return { scene: "at_station", confidence: station.meters <= 60 ? 0.8 : 0.6, place: station, evidence };
  }
  if (still && stop && stop.meters <= Math.max(STOP_RADIUS, Math.min(accuracy, 60))) {
    evidence.push({ key: "place", name: stop.stop.name, value: Math.round(stop.meters) });
    return { scene: "at_stop", confidence: stop.meters <= 20 ? 0.8 : 0.6, place: stop, evidence };
  }
  if (moving !== null && moving >= WALK_SPEED)
    return { scene: "walking", confidence: 0.6, place: stop ?? station ?? null, evidence };
  return { scene: "nearby", confidence: 0.5, place: nearby[0] ?? null, evidence };
}
