import { distance } from "./mobility.js";
import { freshFix } from "./riding.js";

// Physical movement is shared by all candidate services. Route-specific
// direction and track evidence are then assessed separately for each service.
// Sensor shaking, a nearby stopped train, and repeated identical GPS fixes
// never count as confirmed boarding movement.
export function assessBoardingMovement(
  samples = [],
  evidence = [],
  now = Date.now(),
) {
  const fixes = samples
    .filter(
      (p) =>
        freshFix(p, now) &&
        p.accuracy <= 60 &&
        p.timestamp >= now - 45000,
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((p, i, rows) => i === 0 || p.timestamp !== rows[i - 1].timestamp);
  const first = fixes[0];
  const last = fixes.at(-1);
  const span = first && last ? (last.timestamp - first.timestamp) / 1000 : 0;
  const travel = first && last ? distance(first, last) : 0;
  const speeds = fixes
    .slice(-3)
    .map((p) => p.speed)
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 50)
    .sort((a, b) => a - b);
  const speed = speeds.length
    ? speeds[Math.floor(speeds.length / 2)]
    : span > 0
      ? travel / span
      : null;
  const moving =
    fixes.length >= 3 &&
    span >= 15 &&
    span <= 45 &&
    travel >= Math.max(60, first.accuracy + last.accuracy) &&
    Number.isFinite(speed) &&
    speed >= 2.8 &&
    speed <= 45;
  const positive = (needle) =>
    evidence.some((item) => item.points > 0 && item.reason === needle);
  const reversed = evidence.some(
    (item) =>
      item.points < 0 &&
      /進行方向が逆|GPSの方位が逆/.test(item.reason ?? ""),
  );
  const routeTrajectory =
    moving &&
    !reversed &&
    positive("20秒以上、路線に沿う軌跡") &&
    (positive("次の停車地点へ進行") ||
      positive("GPSの方位が路線方向と一致"));
  return { moving, routeTrajectory, reversed, fixes: fixes.length, span, travel, speed };
}
