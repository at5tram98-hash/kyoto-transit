const DEG = Math.PI / 180;

function coord(point) {
  if (!point) return null;
  const lat = Number(point.lat ?? point.latitude);
  const lng = Number(point.lng ?? point.lon ?? point.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export function geoDistance(a, b) {
  const p = coord(a),
    q = coord(b);
  if (!p || !q) return Infinity;
  const lat1 = p.lat * DEG,
    lat2 = q.lat * DEG,
    dLat = (q.lat - p.lat) * DEG,
    dLng = (q.lng - p.lng) * DEG,
    h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function bearingBetween(a, b) {
  const p = coord(a),
    q = coord(b);
  if (!p || !q) return null;
  const lat1 = p.lat * DEG,
    lat2 = q.lat * DEG,
    dLng = (q.lng - p.lng) * DEG,
    y = Math.sin(dLng) * Math.cos(lat2),
    x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  if (Math.abs(x) + Math.abs(y) < 1e-10) return null;
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

// Direction is derived from actual GPS movement, never from the phone compass.
export function tenSecondMovement(
  samples = [],
  now = Date.now(),
  {
    windowMs = 12000,
    minSpanMs = 4500,
    minDistanceMeters = 18,
    maxAccuracyMeters = 100,
  } = {},
) {
  const points = samples
    .filter((sample) => {
      const p = coord(sample);
      return (
        p &&
        Number.isFinite(sample.timestamp) &&
        sample.timestamp >= now - windowMs &&
        sample.timestamp <= now + 2000 &&
        Number.isFinite(sample.accuracy) &&
        sample.accuracy >= 0 &&
        sample.accuracy <= maxAccuracyMeters
      );
    })
    .sort((a, b) => a.timestamp - b.timestamp);
  if (points.length < 2)
    return {
      heading: null,
      meters: 0,
      spanMs: 0,
      speed: null,
      confidence: 0,
      first: null,
      last: null,
    };

  const last = points.at(-1);
  let first = points[0];
  for (const point of points) {
    if (last.timestamp - point.timestamp >= 7000) first = point;
    else break;
  }
  const spanMs = last.timestamp - first.timestamp,
    meters = geoDistance(first, last),
    accuracyFloor = Math.max(
      minDistanceMeters,
      ((Number(first.accuracy) || 0) + (Number(last.accuracy) || 0)) * 0.45,
    );
  if (spanMs < minSpanMs || !Number.isFinite(meters) || meters < accuracyFloor)
    return {
      heading: null,
      meters: Number.isFinite(meters) ? meters : 0,
      spanMs,
      speed:
        spanMs > 0 && Number.isFinite(meters) ? meters / (spanMs / 1000) : null,
      confidence: 0,
      first,
      last,
    };
  const heading = bearingBetween(first, last),
    confidence = Math.max(
      0.45,
      Math.min(1, (meters - accuracyFloor + 30) / 90),
    );
  return {
    heading,
    meters,
    spanMs,
    speed: meters / (spanMs / 1000),
    confidence,
    first,
    last,
  };
}

export function movementAgainstStops(movement, nextStop, previousStop = null) {
  if (!movement?.first || !movement?.last || !Number.isFinite(movement.heading))
    return {
      status: "neutral",
      confidence: 0,
      towardNext: 0,
      towardPrevious: 0,
    };
  const next = coord(nextStop),
    previous = coord(previousStop);
  if (!next)
    return {
      status: "neutral",
      confidence: 0,
      towardNext: 0,
      towardPrevious: 0,
    };
  const towardNext =
      geoDistance(movement.first, next) - geoDistance(movement.last, next),
    towardPrevious = previous
      ? geoDistance(movement.first, previous) -
        geoDistance(movement.last, previous)
      : 0,
    threshold = Math.max(18, Math.min(45, movement.meters * 0.3));

  if (towardNext >= threshold)
    return {
      status: "supportive",
      confidence: Math.max(0.55, movement.confidence),
      towardNext,
      towardPrevious,
    };
  if (
    towardNext <= -threshold &&
    (!previous || towardPrevious >= Math.min(12, threshold * 0.45))
  )
    return {
      status: "contradictory",
      confidence: Math.max(0.72, movement.confidence),
      towardNext,
      towardPrevious,
    };
  return { status: "neutral", confidence: 0.35, towardNext, towardPrevious };
}

// Use a short GPS trail as a route-progress rule. This deliberately avoids
// DeviceOrientation/compass data: a valid direction vote requires repeated
// positions to progress toward the candidate's next stop and away from the
// previous stop with enough real displacement to exceed GPS noise.
export function routeTrajectoryEvidence(
  samples = [],
  nextStop,
  previousStop = null,
  now = Date.now(),
  {
    windowMs = 26000,
    maxAccuracyMeters = 80,
    minSpanMs = 7000,
    minDistanceMeters = 28,
  } = {},
) {
  const next = coord(nextStop),
    previous = coord(previousStop),
    points = samples
      .filter(
        (sample) =>
          coord(sample) &&
          Number.isFinite(sample.timestamp) &&
          sample.timestamp >= now - windowMs &&
          sample.timestamp <= now + 2000 &&
          Number.isFinite(sample.accuracy) &&
          sample.accuracy >= 0 &&
          sample.accuracy <= maxAccuracyMeters,
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  if (!next || points.length < 3)
    return {
      status: "neutral",
      confidence: 0,
      consistency: 0,
      meters: 0,
      speed: null,
      last: points.at(-1) ?? null,
    };

  const first = points[0],
    last = points.at(-1),
    spanMs = last.timestamp - first.timestamp,
    meters = geoDistance(first, last),
    accuracyFloor = Math.max(
      minDistanceMeters,
      ((Number(first.accuracy) || 0) + (Number(last.accuracy) || 0)) * 0.5,
    ),
    speed = spanMs > 0 ? meters / (spanMs / 1000) : null;
  if (spanMs < minSpanMs || !Number.isFinite(meters) || meters < accuracyFloor)
    return {
      status: "neutral",
      confidence: 0,
      consistency: 0,
      meters: Number.isFinite(meters) ? meters : 0,
      speed,
      last,
    };

  const distances = points.map((point) => geoDistance(point, next)),
    previousDistances = previous
      ? points.map((point) => geoDistance(point, previous))
      : [],
    tolerance = Math.max(3, Math.min(10, accuracyFloor * 0.12));
  let towardSteps = 0,
    awaySteps = 0,
    usableSteps = 0;
  for (let i = 1; i < distances.length; i++) {
    const delta = distances[i - 1] - distances[i];
    if (Math.abs(delta) < tolerance) continue;
    usableSteps++;
    if (delta > 0) towardSteps++;
    else awaySteps++;
  }
  const consistency = usableSteps ? towardSteps / usableSteps : 0.5,
    reverseConsistency = usableSteps ? awaySteps / usableSteps : 0.5,
    towardNext = distances[0] - distances.at(-1),
    awayFromPrevious = previous
      ? previousDistances.at(-1) - previousDistances[0]
      : 0,
    threshold = Math.max(20, Math.min(60, meters * 0.28)),
    routeProgress = towardNext >= threshold && (!previous || awayFromPrevious >= 4),
    routeReverse =
      towardNext <= -threshold && (!previous || awayFromPrevious <= -4);

  if (routeProgress && consistency >= 0.6)
    return {
      status: "supportive",
      confidence: Math.min(0.96, 0.58 + consistency * 0.3 + Math.min(0.08, meters / 700)),
      consistency,
      meters,
      speed,
      towardNext,
      awayFromPrevious,
      last,
    };
  if (routeReverse && reverseConsistency >= 0.6)
    return {
      status: "contradictory",
      confidence: Math.min(0.96, 0.72 + reverseConsistency * 0.2),
      consistency: reverseConsistency,
      meters,
      speed,
      towardNext,
      awayFromPrevious,
      last,
    };
  return {
    status: "neutral",
    confidence: 0.35,
    consistency,
    meters,
    speed,
    towardNext,
    awayFromPrevious,
    last,
  };
}

const announcementFields = ["line", "route", "destination", "trainType"];
export function mergeAnnouncementWindow(
  current,
  parsed,
  now = Date.now(),
  ttlMs = 70000,
) {
  if (!specificAnnouncement(parsed)) return current ?? null;
  const active =
    current &&
    Number.isFinite(current.firstAt) &&
    now - current.firstAt <= ttlMs &&
    announcementFields.every(
      (key) => !current.parsed?.[key] || !parsed[key] || current.parsed[key] === parsed[key],
    );
  const base = active ? current.parsed : {};
  const merged = { ...base };
  for (const key of ["line", "route", "destination", "nextStop", "trainType"])
    if (parsed[key]) merged[key] = parsed[key];
  for (const key of ["destinationIds", "nextStopIds"]) {
    const values = [...(active ? current.parsed?.[key] ?? [] : []), ...(parsed[key] ?? [])];
    if (values.length) merged[key] = [...new Set(values)];
  }
  return {
    parsed: merged,
    firstAt: active ? current.firstAt : now,
    at: now,
    hits: active ? current.hits + 1 : 1,
  };
}

export function specificAnnouncement(parsed) {
  if (!parsed) return false;
  return Boolean(
    parsed.nextStop ||
      parsed.destination ||
      parsed.route ||
      parsed.line ||
      parsed.trainType,
  );
}

// Contradictions need either independent sources or a repeated, separated
// high-confidence observation. This prevents one GPS jump or one misheard
// announcement from tearing down a correct ride.
export function contradictionDecision(
  rows = [],
  now = Date.now(),
  { ttlMs = 90000 } = {},
) {
  const recent = rows
    .filter(
      (row) =>
        row &&
        Number.isFinite(row.at) &&
        now - row.at <= ttlMs &&
        row.at <= now + 2000 &&
        Number.isFinite(row.confidence) &&
        row.confidence >= 0.7,
    )
    .sort((a, b) => a.at - b.at);
  const family = (source) =>
    ["direction", "pattern", "gps"].includes(source) ? "gps" : source;
  const sources = new Set(recent.map((row) => family(row.source)));
  if (sources.size >= 2)
    return { release: true, reason: "independent-sources" };

  for (const source of sources) {
    const same = recent.filter((row) => family(row.source) === source);
    const signatures = new Set(
      same.map((row) => row.signature).filter(Boolean),
    );
    if (
      same.length >= 2 &&
      same.at(-1).at - same[0].at >= 5000 &&
      signatures.size >= 2
    )
      return { release: true, reason: `repeated-${source}` };
  }
  return { release: false, reason: null };
}