import { transitCandidateKey } from "./transit-evidence.js";

export const RideMode = Object.freeze({
  NONE: "none",
  RAIL: "rail",
  BUS: "bus",
});
export const RideState = Object.freeze({
  IDLE: "idle",
  CANDIDATE: "candidate",
  CONFIRMING: "confirming",
  RIDING: "riding",
  CONTRADICTING: "contradicting",
  RECHECKING: "rechecking",
  ALIGHTING: "alighting",
});
export const ConfidenceStage = Object.freeze({
  SEARCHING: "searching",
  CONFIRMING: "confirming",
  CONFIRMED: "confirmed",
  CONTRADICTING: "contradicting",
  RECHECKING: "rechecking",
});
export const rideMode = (ride) =>
  !ride
    ? RideMode.NONE
    : ["citybus", "kyotobus"].includes(ride.operator)
      ? RideMode.BUS
      : RideMode.RAIL;
const family = (source) =>
  ["direction", "pattern", "gps"].includes(source) ? "gps" : source;
const transitions = {
  idle: ["candidate", "confirming", "riding"],
  candidate: ["idle", "confirming", "riding", "rechecking"],
  confirming: ["idle", "candidate", "riding", "rechecking"],
  riding: ["idle", "contradicting", "rechecking", "alighting"],
  contradicting: ["idle", "riding", "rechecking", "alighting"],
  rechecking: ["idle", "riding", "candidate", "confirming"],
  alighting: ["idle", "riding", "contradicting", "rechecking"],
};

// No coordinates, transcripts, stop/route/trip names or stable identifiers are
// written to diagnostics. Candidate aliases exist only within this session.
export function createRideDetectionSession() {
  let phase = RideState.IDLE,
    mode = RideMode.NONE,
    shell = null,
    expected = null,
    contradictions = [],
    history = [],
    aliases = new Map(),
    lock = null,
    intensifyUntil = 0,
    progress = { phase: "unknown", currentStop: null, nextStop: null },
    lastAudio = new Map(),
    lastMotion = null,
    unboardSince = null,
    unboardLast = null;
  function alias(ride) {
    if (!ride) return null;
    const key = transitCandidateKey(ride);
    if (!aliases.has(key)) aliases.set(key, `candidate-${aliases.size + 1}`);
    if (aliases.size > 40) aliases.delete(aliases.keys().next().value);
    return aliases.get(key);
  }
  function note(type, now, data = {}) {
    history.push({ type, at: Math.floor(now / 1000) * 1000, ...data });
    history = history.slice(-100);
  }
  function transition(next, now = Date.now(), data = {}) {
    if (next === phase) return false;
    if (!transitions[phase]?.includes(next)) return false;
    const from = phase;
    phase = next;
    note("transition", now, { from, to: next, ...data });
    return true;
  }
  function prune(now) {
    contradictions = contradictions.filter(
      (e) => e.at <= now + 2000 && now - e.at <= 90000,
    );
  }
  return {
    transition,
    snapshot(now = Date.now()) {
      prune(now);
      const bySource = new Map();
      for (const e of contradictions)
        bySource.set(
          family(e.source),
          Math.max(bySource.get(family(e.source)) ?? 0, e.score),
        );
      const score = Math.min(
        100,
        [...bySource.values()].reduce((a, b) => a + b, 0),
      );
      return {
        phase,
        mode,
        shell,
        expected,
        progress: { ...progress },
        contradictionScore: score,
        contradictions: contradictions.map((e) => ({ ...e })),
        intensified: now < intensifyUntil,
        lockUntil: lock?.until ?? 0,
        stage:
          phase === "rechecking"
            ? "rechecking"
            : phase === "contradicting"
              ? "contradicting"
              : ["riding", "alighting"].includes(phase)
                ? "confirmed"
                : phase === "confirming"
                  ? "confirming"
                  : "searching",
      };
    },
    candidates(rows, now = Date.now()) {
      if (
        ["riding", "contradicting", "alighting", "rechecking"].includes(phase)
      )
        return;
      const top = rows[0];
      mode = rideMode(top?.ride);
      transition(
        !top ? "idle" : top.score >= 55 ? "confirming" : "candidate",
        now,
      );
    },
    confirm(ride, now = Date.now(), { manual = false } = {}) {
      const previous = shell;
      const corrected =
        phase === "rechecking" &&
        previous &&
        transitCandidateKey(previous) !== transitCandidateKey(ride);
      if (corrected)
        lock = { previous: transitCandidateKey(previous), until: now + 45000 };
      shell = null;
      mode = rideMode(ride);
      contradictions = [];
      lastAudio.clear();
      transition("riding", now, {
        candidate: alias(ride),
        manual,
        corrected: Boolean(corrected),
      });
      return Boolean(corrected);
    },
    canConfirm(ride, sources, score, now = Date.now()) {
      if (
        !lock ||
        now >= lock.until ||
        transitCandidateKey(ride) !== lock.previous
      )
        return true;
      return new Set(sources.map(family)).size >= 3 && score >= 90;
    },
    recheck(ride, now = Date.now()) {
      if (!ride) return false;
      shell = ride;
      mode = rideMode(ride);
      intensifyUntil = now + 30000;
      return transition("rechecking", now, { candidate: alias(ride) });
    },
    expected(ride, observation, minute, shift = 0) {
      const stops = ride?.officialStops ?? [];
      const observed = observation?.progress;
      const idx =
        observed?.nextIndex ??
        stops.findIndex(
          (s) => (s.departure ?? s.time ?? s.arrival) > minute - shift,
        );
      expected = {
        mode: rideMode(ride),
        direction: ride?.directionId ?? ride?.direction ?? null,
        nextStop: stops[Math.max(1, idx)]?.id ?? null,
        followingStop: stops[Math.max(1, idx) + 1]?.id ?? null,
        arrivalMinute:
          stops[Math.max(1, idx)]?.arrival ??
          stops[Math.max(1, idx)]?.time ??
          null,
      };
      return expected;
    },
    observeProgress(
      observation,
      motion,
      now = Date.now(),
      destinationId = null,
    ) {
      const p = observation?.progress;
      const currentStop =
        p?.current?.id ?? p?.stops?.[p.currentIndex]?.id ?? null;
      const motionFresh =
        Number.isFinite(motion?.observedAt) && now - motion.observedAt <= 15000;
      const nextPhase =
        p?.source === "location" && motionFresh && motion.phase === "stopped"
          ? "stopped"
          : motionFresh && motion.phase === "departing"
            ? "departing"
            : p?.source === "location"
              ? "travelling"
              : "unknown";
      progress = {
        phase: nextPhase,
        currentStop,
        nextStop: p?.next?.id ?? expected?.nextStop ?? null,
      };
      if (["riding", "alighting"].includes(phase)) {
        if (nextPhase === "stopped" && currentStop === destinationId)
          transition("alighting", now);
        else if (phase === "alighting" && nextPhase === "departing")
          transition("riding", now);
      }
    },
    motion(evidence, now = Date.now()) {
      if (!evidence || !Number.isFinite(evidence.sensorObservedAt)) return;
      if (evidence.sensorObservedAt === lastMotion?.at) return;
      lastMotion = { at: evidence.sensorObservedAt, phase: evidence.phase };
      note("evidence", now, {
        source: "motion",
        phase: evidence.phase,
        score: evidence.score,
      });
    },
    audio(ride, stopId, at = Date.now()) {
      if (!stopId) return { status: "neutral", confidence: 0 };
      const key = transitCandidateKey(ride),
        stops = ride.officialStops ?? [],
        previous = lastAudio.get(key);
      const circular =
        ride.circular === true ||
        (stops.length > 2 && stops[0].id === stops.at(-1).id);
      const cycle =
        circular && stops[0]?.id === stops.at(-1)?.id
          ? stops.length - 1
          : stops.length;
      const indices = stops.flatMap((s, i) =>
        s.id === stopId && (!circular || i < cycle) ? [i] : [],
      );
      let index = indices[0];
      if (previous && at - previous.at <= 120000) {
        if (previous.stopId === stopId)
          return { status: "neutral", confidence: 0 };
        index = circular
          ? indices
              .map(
                (i) =>
                  previous.index +
                  ((i - (previous.index % cycle) + cycle) % cycle),
              )
              .find(
                (i) =>
                  i > previous.index &&
                  i - previous.index <= Math.min(2, Math.ceil(cycle / 3)),
              )
          : (() => {
              // Rides for the same train may start at different stations
              // (underground they are found from the heard station), so the
              // previous station is located on this ride's own stop list;
              // before its first stop counts as just before index 0.
              const before = stops.findIndex((s) => s.id === previous.stopId),
                base = before >= 0 ? before : previous.ride === key ? previous.index : -1;
              return indices.find((i) => i > base && i - base <= 2);
            })();
        if (index === undefined)
          return { status: "contradictory", confidence: 0.92 };
      }
      if (index === undefined)
        return { status: "contradictory", confidence: 0.9 };
      lastAudio.set(key, { stopId, index, at, ride: key });
      if (lastAudio.size > 20) lastAudio.delete(lastAudio.keys().next().value);
      return {
        status: "supportive",
        confidence: previous ? 0.96 : 0.75,
        currentIndex: circular
          ? (index - 1 + cycle) % cycle
          : Math.max(0, index - 1),
        nextIndex: circular ? index % cycle : index,
      };
    },
    contradiction(source, confidence, signature, now = Date.now()) {
      prune(now);
      if (!Number.isFinite(confidence) || confidence < 0.7) return false;
      // Repeated source/signature is one observation, regardless of poll rate.
      if (
        contradictions.some(
          (e) => e.source === source && e.signature === signature,
        )
      )
        return false;
      const score = Math.round(
        confidence *
          (source === "audio" ? 40 : source === "realtime" ? 35 : 30),
      );
      contradictions.push({ source, confidence, signature, at: now, score });
      contradictions = contradictions.slice(-16);
      intensifyUntil = now + 30000;
      note("evidence", now, { source, score, status: "contradictory" });
      if (phase === "riding") transition("contradicting", now);
      return true;
    },
    clear(source, now = Date.now()) {
      prune(now);
      contradictions = contradictions.filter((e) => e.source !== source);
      if (!contradictions.length && phase === "contradicting")
        transition("riding", now);
    },
    observeNotRiding(
      {
        walking = false,
        offRoute = false,
        independentConflict = false,
        observedAt,
      } = {},
      now = Date.now(),
    ) {
      if (
        phase !== "rechecking" ||
        !walking ||
        !offRoute ||
        !independentConflict ||
        !Number.isFinite(observedAt) ||
        now - observedAt > 15000 ||
        observedAt > now + 1000
      ) {
        unboardSince = null;
        unboardLast = null;
        return false;
      }
      if (observedAt === unboardLast) return false;
      if (unboardLast && observedAt - unboardLast > 20000) unboardSince = null;
      unboardSince ??= observedAt;
      unboardLast = observedAt;
      if (observedAt - unboardSince < 45000) return false;
      note("evidence", now, {
        source: "motion",
        status: "not-riding",
        score: 90,
      });
      return true;
    },
    diagnostics() {
      return history.map((e) => ({ ...e }));
    },
    reset(now = Date.now()) {
      transition("idle", now);
      mode = "none";
      shell = null;
      expected = null;
      contradictions = [];
      lastAudio.clear();
      unboardSince = null;
      unboardLast = null;
      lock = null;
      intensifyUntil = 0;
      progress = { phase: "unknown", currentStop: null, nextStop: null };
    },
  };
}
export const rideDetectionSession = createRideDetectionSession();
