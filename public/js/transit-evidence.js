// Evidence stays in memory and expires. Repeated fixes are one GPS source,
// not independent votes. A timetable or selected journey cannot prove boarding.
const TTL = {
  gps: 45000,
  motion: 15000,
  audio: 75000,
  realtime: 90000,
  timetable: 60000,
  journey: 60000,
  pattern: 60000,
};
const observations = new Set(["gps", "motion", "audio", "realtime"]);
export function transitCandidateKey(ride) {
  return JSON.stringify([
    ride.operator,
    String(ride.route ?? ""),
    ride.servicePatternId ?? ride.serviceId ?? "",
    ride.directionId ?? ride.direction ?? "",
    ride.destination ?? ride.headsign ?? "",
    ride.tripId ?? "",
    ride.serviceDate ?? "",
    ride.tripId ? "" : ride.depart,
  ]);
}
export function orderedStopEvidence(
  pattern,
  trail,
  { circular = false, maxSkip = 6 } = {},
) {
  const ids = pattern.map((s) => (typeof s === "string" ? s : s.id));
  if (circular && ids.length > 1 && ids[0] === ids.at(-1)) ids.pop();
  const recent = trail
    .map((s) => (typeof s === "string" ? s : s.id))
    .filter((id, i, all) => i === 0 || id !== all[i - 1]);
  if (recent.length < 2 || ids.length < 2)
    return { matched: false, rejected: false, steps: [] };
  const limit = Math.max(
    1,
    Math.min(maxSkip, circular ? Math.ceil(ids.length / 3) : maxSkip),
  );
  let paths = ids.flatMap((id, i) => (id === recent[0] ? [[i]] : []));
  for (const id of recent.slice(1)) {
    paths = paths
      .flatMap((path) => {
        const previous = path.at(-1);
        const next = [];
        for (let step = 1; step <= limit; step++) {
          const index = previous + step;
          if (!circular && index >= ids.length) break;
          if (ids[index % ids.length] === id) next.push([...path, index]);
        }
        return next;
      })
      .slice(0, 16);
  }
  return {
    matched: paths.length > 0,
    rejected: !paths.length && recent.every((id) => ids.includes(id)),
    steps: paths[0] ?? [],
  };
}
export function createTransitEvidenceEngine({ minMargin = 8 } = {}) {
  const events = new Map();
  let lastStation = null,
    locked = null,
    pending = null;
  function prune(now) {
    for (const [key, event] of events)
      if (
        now - event.observedAt > TTL[event.type] ||
        event.observedAt > now + 5000
      )
        events.delete(key);
  }
  function ingest(event) {
    if (
      !TTL[event?.type] ||
      !event.candidate ||
      !Number.isFinite(event.observedAt) ||
      !Number.isFinite(event.confidence)
    )
      return false;
    const candidate =
      typeof event.candidate === "string"
        ? event.candidate
        : transitCandidateKey(event.candidate);
    const key = `${candidate}:${event.type}`;
    if ((events.get(key)?.observedAt ?? -Infinity) > event.observedAt)
      return false;
    events.set(key, {
      ...event,
      candidate,
      confidence: Math.max(0, Math.min(1, event.confidence)),
      metadata: { ...event.metadata },
    });
    if (events.size > 80) events.delete(events.keys().next().value);
    return true;
  }
  return {
    ingest,
    observeStation(station, fix, now = Date.now()) {
      if (
        station &&
        fix &&
        now - fix.timestamp <= 45000 &&
        fix.timestamp <= now + 5000 &&
        fix.accuracy <= 80 &&
        station.meters <= Math.min(150, Math.max(90, fix.accuracy * 1.5))
      )
        lastStation = { station, fix: { ...fix }, at: fix.timestamp };
    },
    stationContext(now = Date.now()) {
      return lastStation && now - lastStation.at <= 240000 ? lastStation : null;
    },
    lock(ride) {
      locked = transitCandidateKey(ride);
    },
    unlock() {
      locked = null;
      pending = null;
    },
    reset() {
      events.clear();
      locked = null;
      lastStation = null;
      pending = null;
    },
    support(ride, now = Date.now()) {
      prune(now);
      const key = transitCandidateKey(ride);
      const rows = [...events.values()].filter(
        (e) =>
          e.candidate === key &&
          observations.has(e.type) &&
          !e.metadata?.rejected,
      );
      const quality = rows.map(
        (e) =>
          e.confidence * Math.max(0, 1 - (now - e.observedAt) / TTL[e.type]),
      );
      return {
        sources: rows.map((e) => e.type),
        // A scheduled trip or route pattern exists for this candidate.
        contextual: [...events.values()].some(
          (e) =>
            e.candidate === key &&
            ["timetable", "pattern"].includes(e.type) &&
            !e.metadata?.rejected,
        ),
        walkingLikely: rows.some(
          (e) => e.type === "gps" && e.metadata?.walkingLikely === true,
        ),
        vehicleMoving: rows.some(
          (e) =>
            (e.type === "gps" || e.type === "motion") &&
            e.metadata?.vehicleMoving === true,
        ),
        audioSequence: rows.some(
          (e) =>
            e.type === "audio" &&
            e.metadata?.sequenceValidated === true &&
            e.metadata?.directionVerified === true,
        ),
        routeProgress: rows.some(
          (e) =>
            e.type === "gps" &&
            e.confidence >= 0.45 &&
            !e.metadata?.walkingLikely &&
            e.metadata?.vehicleMoving === true &&
            e.metadata?.directionVerified === true &&
            (e.metadata?.routeTrajectory === true ||
              Number(e.metadata?.orderedStops ?? 0) >= 2),
        ),
        confidence: Math.min(1, quality.reduce((a, b) => a + b, 0) / 2),
      };
    },
    evaluate(candidates, now = Date.now()) {
      prune(now);
      const rows = candidates
        .filter((c) => c?.ride && Number.isFinite(c.score))
        .map((c) => ({
          ...c,
          evidenceScore: c.evidenceScore ?? c.confirmationScore ?? c.score,
          score:
            (c.evidenceScore ?? c.confirmationScore ?? c.score) -
            (c.directionRejected ? 60 : 0) +
            [...events.values()]
              .filter((e) => e.candidate === transitCandidateKey(c.ride))
              .reduce(
                (total, e) =>
                  total +
                  (e.metadata?.rejected
                    ? -60 * e.confidence
                    : e.type === "audio"
                      ? 28 * e.confidence
                      : e.type === "realtime"
                        ? 12 * e.confidence
                        : 0),
                0,
              ),
        }))
        .sort((a, b) => b.score - a.score);
      const top = rows[0];
      if (!top)
        return {
          confirmed: null,
          candidates: [],
          sources: [],
          count: 0,
          ambiguous: false,
        };
      const key = transitCandidateKey(top.ride),
        margin = top.score - (rows[1]?.score ?? 0);
      const matching = [...events.values()].filter(
        (e) => e.candidate === key && e.confidence >= 0.45,
      );
      const sources = [
        ...new Set(
          matching.filter((e) => observations.has(e.type)).map((e) => e.type),
        ),
      ];
      const routeProgressGps = matching.some(
          (e) =>
            e.type === "gps" &&
            e.metadata?.rejected !== true &&
            e.metadata?.walkingLikely !== true &&
            e.metadata?.vehicleMoving === true &&
            e.metadata?.directionVerified === true &&
            (e.metadata?.routeTrajectory === true ||
              Number(e.metadata?.orderedStops ?? 0) >= 2),
        ),
        audioDirection = matching.some(
          (e) => e.type === "audio" && e.metadata?.directionVerified === true,
        ),
        realtimeDirection = matching.some(
          (e) =>
            e.type === "realtime" && e.metadata?.directionVerified === true,
        ),
        directionVerified =
          routeProgressGps || audioDirection || realtimeDirection;
      const rejected =
        matching.some((e) => e.metadata?.rejected === true) ||
        top.directionRejected;
      const contextual = matching.some((e) =>
        ["timetable", "journey", "pattern"].includes(e.type),
      );
      const ambiguous = margin < minMargin || !directionVerified;
      if (pending?.key !== key) pending = { key, since: now };
      const stable =
        sources.includes("audio") ||
        sources.includes("realtime") ||
        now - pending.since >= 12000;
      const walkingOnly =
        matching.some((e) => e.type === "gps" && e.metadata?.walkingLikely) &&
        !sources.some((type) => ["audio", "realtime"].includes(type));
      const movingMotion = matching.some(
          (e) => e.type === "motion" && e.metadata?.vehicleMoving === true,
        ),
        orderedRoute = matching.some(
          (e) =>
            e.type === "gps" &&
            e.metadata?.vehicleMoving === true &&
            e.metadata?.directionVerified === true &&
            Number(e.metadata?.orderedStops ?? 0) >= 3,
        ),
        verifiedAudioSequence = matching.some(
          (e) =>
            e.type === "audio" &&
            e.metadata?.directionVerified === true &&
            e.metadata?.sequenceValidated === true,
        ),
        hasAudio = sources.includes("audio"),
        hasRealtime = sources.includes("realtime"),
        transportSpecific = hasAudio || hasRealtime || orderedRoute,
        multimodalIdentity =
          (routeProgressGps && (hasAudio || hasRealtime)) ||
          (orderedRoute && movingMotion) ||
          (verifiedAudioSequence && hasRealtime && movingMotion);
      const confirmed =
        transportSpecific &&
        multimodalIdentity &&
        stable &&
        !locked &&
        !rejected &&
        !walkingOnly &&
        !ambiguous &&
        contextual &&
        top.evidenceScore >= 55 &&
        sources.length >= 2;
      return {
        confirmed: confirmed ? top.ride : null,
        candidates: rows.slice(0, 3).map((candidate) => ({
          ...candidate,
          score: Math.max(0, Math.min(100, candidate.score)),
        })),
        sources,
        count: sources.length,
        ambiguous,
        margin,
      };
    },
  };
}

export const transitEvidenceEngine = createTransitEvidenceEngine();
// Nearby vehicles and timetable proximity alone are not an invitation to board.
// This controls unsolicited confirmation UI, not manual boarding or consensus.
export function shouldOfferRideConfirmation(candidate, support = {}) {
  if (!candidate || candidate.directionRejected) return false;
  return Boolean(
    support.routeProgress ||
      (support.vehicleMoving &&
        support.audioSequence &&
        support.sources?.includes("realtime")) ||
      // Moving at vehicle speed with a scheduled or official live trip for
      // this candidate. This only offers the question; boarding still needs
      // the rider's explicit confirmation.
      (support.vehicleMoving &&
        !support.walkingLikely &&
        (support.contextual || support.sources?.includes("realtime"))),
  );
}
