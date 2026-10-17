const EARTH_METERS = 6371000;
const DEG = Math.PI / 180;

function coord(point) {
  if (!point) return null;
  const lat = Number(point.lat ?? point.latitude);
  const lng = Number(point.lng ?? point.lon ?? point.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function localXY(point, origin) {
  const p = coord(point);
  const o = coord(origin);
  if (!p || !o) return null;
  const cos = Math.cos(o.lat * DEG);
  return {
    x: (p.lng - o.lng) * DEG * EARTH_METERS * cos,
    y: (p.lat - o.lat) * DEG * EARTH_METERS,
  };
}

function routeGeometry(route = []) {
  const points = route.map(coord).filter(Boolean);
  if (points.length < 2) return null;
  const origin = points[0];
  const xy = points.map((point) => localXY(point, origin));
  const cumulative = [0];
  const lengths = [];
  for (let i = 1; i < xy.length; i++) {
    const length = Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y);
    lengths.push(length);
    cumulative.push(cumulative.at(-1) + length);
  }
  return { points, origin, xy, cumulative, lengths, total: cumulative.at(-1) };
}

export function projectToRoute(point, route = []) {
  const geometry = routeGeometry(route);
  if (!geometry) return null;
  const p = localXY(point, geometry.origin);
  if (!p) return null;
  let best = null;
  for (let i = 0; i < geometry.xy.length - 1; i++) {
    const a = geometry.xy[i],
      b = geometry.xy[i + 1],
      vx = b.x - a.x,
      vy = b.y - a.y,
      len2 = vx * vx + vy * vy;
    if (len2 <= 0) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)),
      qx = a.x + vx * t,
      qy = a.y + vy * t,
      offRouteMeters = Math.hypot(p.x - qx, p.y - qy),
      progressMeters = geometry.cumulative[i] + geometry.lengths[i] * t;
    if (!best || offRouteMeters < best.offRouteMeters)
      best = { segmentIndex: i, t, offRouteMeters, progressMeters };
  }
  return best;
}

function planarDistance(a, b, origin) {
  const p = localXY(a, origin),
    q = localXY(b, origin);
  return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : Infinity;
}

export function summarizeRouteTrajectory(
  samples = [],
  route = [],
  now = Date.now(),
  { windowMs = 35000, maxAccuracyMeters = 100 } = {},
) {
  const geometry = routeGeometry(route);
  if (!geometry)
    return {
      usable: false,
      direction: "neutral",
      routeRatio: 0,
      progressDelta: 0,
      speed: null,
    };

  const recent = samples
    .filter((sample) => {
      const p = coord(sample);
      return (
        p &&
        Number.isFinite(sample.timestamp) &&
        sample.timestamp >= now - windowMs &&
        sample.timestamp <= now + 3000 &&
        Number.isFinite(sample.accuracy) &&
        sample.accuracy >= 0 &&
        sample.accuracy <= maxAccuracyMeters
      );
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  if (recent.length < 2)
    return {
      usable: false,
      direction: "neutral",
      routeRatio: 0,
      progressDelta: 0,
      speed: null,
      samples: recent.length,
    };

  const projected = recent
    .map((sample) => {
      const projection = projectToRoute(sample, route);
      if (!projection) return null;
      const corridorLimit = Math.min(140, Math.max(55, sample.accuracy * 1.8));
      return { sample, ...projection, corridorLimit };
    })
    .filter(Boolean);

  if (projected.length < 2)
    return {
      usable: false,
      direction: "neutral",
      routeRatio: 0,
      progressDelta: 0,
      speed: null,
      samples: projected.length,
    };

  const spanMs = projected.at(-1).sample.timestamp - projected[0].sample.timestamp,
    avgAccuracy =
      projected.reduce((sum, row) => sum + row.sample.accuracy, 0) / projected.length,
    aligned = projected.filter((row) => row.offRouteMeters <= row.corridorLimit),
    routeRatio = aligned.length / projected.length,
    progressDelta = projected.at(-1).progressMeters - projected[0].progressMeters,
    progressThreshold = Math.max(35, avgAccuracy * 1.2),
    jitterTolerance = Math.max(8, avgAccuracy * 0.35);

  let forwardMoves = 0,
    reverseMoves = 0;
  for (let i = 1; i < projected.length; i++) {
    const delta = projected[i].progressMeters - projected[i - 1].progressMeters;
    if (delta > jitterTolerance) forwardMoves++;
    else if (delta < -jitterTolerance) reverseMoves++;
  }
  const directionalMoves = forwardMoves + reverseMoves,
    forwardRatio = directionalMoves ? forwardMoves / directionalMoves : 0,
    reverseRatio = directionalMoves ? reverseMoves / directionalMoves : 0;

  let direction = "neutral";
  if (
    spanMs >= 7000 &&
    routeRatio >= 0.7 &&
    progressDelta >= progressThreshold &&
    forwardRatio >= 0.7
  )
    direction = "forward";
  else if (
    spanMs >= 7000 &&
    routeRatio >= 0.7 &&
    progressDelta <= -progressThreshold &&
    reverseRatio >= 0.7
  )
    direction = "reverse";

  const first = projected[0],
    last = projected.at(-1),
    startedNearOrigin =
      planarDistance(first.sample, geometry.points[0], geometry.origin) <=
      Math.min(220, Math.max(130, first.sample.accuracy * 2.2)),
    speed = spanMs > 0 ? Math.abs(progressDelta) / (spanMs / 1000) : null;

  return {
    usable: spanMs >= 4500 && routeRatio >= 0.5,
    samples: projected.length,
    spanMs,
    routeRatio,
    direction,
    progressDelta,
    forwardRatio,
    reverseRatio,
    speed,
    avgAccuracy,
    startedNearOrigin,
    currentOffRouteMeters: last.offRouteMeters,
    currentCorridorLimit: last.corridorLimit,
    currentProgressMeters: last.progressMeters,
    firstProgressMeters: first.progressMeters,
    currentSegmentIndex: last.segmentIndex,
  };
}

export function fuseBoardingSignals(trajectory, motion = {}, operator = "") {
  const speedValues = [trajectory?.speed, motion?.speed].filter(Number.isFinite),
    speed = speedValues.length ? Math.max(...speedValues) : null,
    sensorBacked =
      Number(motion?.sensorSamples ?? 0) >= 6 &&
      Number(motion?.activeRatio ?? 0) >= 0.3 &&
      Number(motion?.rms ?? 0) >= 0.1,
    walkingLikely = Boolean(motion?.walkingLikely),
    routeAligned =
      Boolean(trajectory?.usable) &&
      trajectory.routeRatio >= 0.65 &&
      trajectory.currentOffRouteMeters <= trajectory.currentCorridorLimit,
    movingVehicle = Number.isFinite(speed) && speed >= 2.8 && !walkingLikely,
    accelerationSignal =
      Math.abs(Number(motion?.acceleration ?? 0)) >= 0.08 ||
      Number(motion?.peakAcceleration ?? 0) >= 0.25 ||
      ["stop-acceleration", "deceleration-stop"].includes(motion?.pattern),
    directionVerified = trajectory?.direction === "forward",
    rejected = trajectory?.direction === "reverse" && trajectory.routeRatio >= 0.75,
    rail = ["subway", "kintetsu", "through"].includes(operator);

  let gpsConfidence = 0.45;
  if (routeAligned) gpsConfidence += Math.min(0.22, trajectory.routeRatio * 0.22);
  if (directionVerified) gpsConfidence += 0.18;
  if (Math.abs(Number(trajectory?.progressDelta ?? 0)) >= 100) gpsConfidence += 0.08;
  if (rejected) gpsConfidence = Math.max(gpsConfidence, 0.78);
  gpsConfidence = Math.max(0, Math.min(0.96, gpsConfidence));

  let motionConfidence = 0.5;
  if (sensorBacked) motionConfidence += 0.14;
  if (movingVehicle) motionConfidence += 0.12;
  if (accelerationSignal) motionConfidence += 0.1;
  if (routeAligned) motionConfidence += 0.06;
  motionConfidence = Math.max(0, Math.min(0.92, motionConfidence));

  const transportSpecific = Boolean(
    rail &&
      sensorBacked &&
      movingVehicle &&
      accelerationSignal &&
      directionVerified &&
      trajectory.routeRatio >= 0.82 &&
      trajectory.startedNearOrigin &&
      trajectory.spanMs >= 12000 &&
      trajectory.progressDelta >= 120 &&
      trajectory.currentOffRouteMeters <= Math.min(90, trajectory.currentCorridorLimit),
  );

  return {
    speed,
    sensorBacked,
    walkingLikely,
    routeAligned,
    movingVehicle,
    accelerationSignal,
    directionVerified,
    rejected,
    transportSpecific,
    shouldIngestGps: routeAligned || rejected,
    shouldIngestMotion: sensorBacked && movingVehicle && routeAligned,
    gpsConfidence,
    motionConfidence,
  };
}

export function boostedAudioConfidence(base, repeatCount = 1, sequenceStatus = "supportive") {
  const initial = Number.isFinite(base) ? base : 0.65,
    repeatBoost = Math.min(0.12, Math.max(0, repeatCount - 1) * 0.04),
    sequenceBoost = sequenceStatus === "confirmed" ? 0.04 : 0;
  return Math.max(0, Math.min(0.99, initial + repeatBoost + sequenceBoost));
}
