import { currentMotionEvidence } from "./motion-assist.js";
import { clearFalseRide } from "./vnext-detect.js";
import { segmentDistance } from "./mobility.js";
import { observeAudioSequence } from "./audio-sequence.js";
import { acquireAudioWindow, releaseAudioWindow } from "./audio-window.js";
import { micAllowed, setMicBlocked, speechCtor, markListening } from "./mic-policy.js";
import { realtimeRideEvidence } from "./realtime-evidence.js";
import { getKyotoBusRT, getBusAll } from "./live.js";
import { ensureRailFeed } from "./vnext-state.js";
import { rideDetectionSession } from "./ride-detection-session.js";
import { recordRideContradiction as recordContradiction } from "./ride-rechecking.js";
import { parseAnnouncement, announcementMatch } from "./announcement-parser.js";
import {
  transitEvidenceEngine,
  transitCandidateKey,
  orderedStopEvidence,
} from "./transit-evidence.js";
import { freshFix } from "./riding.js";
import { assessBoardingMovement } from "./auto-boarding-evidence.js";
import { boardingAvailable } from "./journey-session.js";
import { state, settings, tokyoNow } from "./vnext-state.js";
import {
  tenSecondMovement,
  movementAgainstStops,
  routeTrajectoryEvidence,
  mergeAnnouncementWindow,
  specificAnnouncement,
} from "./smartlive-evidence.js";

const AUDIO_TTL_MS = 70000,
  AUDIO_SESSION_MS = 60000,
  // While the fix stays poor, listening resumes almost at once.
  AUDIO_COOLDOWN_MS = 2000,
  AUDIO_RESTART_DELAY_MS = 250,
  VERIFY_INTERVAL_MS = 4000;

let pendingAnnouncement = null,
  preRecognition = null,
  preRecognitionTimer = null,
  preRecognitionRestartTimer = null,
  preRecognitionDeadline = 0,
  preRecognitionActive = false,
  lastPreRecognitionAt = 0,
  lastDirectionEvidenceAt = 0,
  interval = null;

// Listening before a ride is known: only while the GPS fix is poor
// (mic-policy.js), where the announcement is the main evidence.
function preRecognitionCanContinue() {
  return Boolean(
    preRecognitionActive &&
      Date.now() < preRecognitionDeadline &&
      !state.ride &&
      state.network &&
      micAllowed(),
  );
}

function stopPreRecognition() {
  markListening("candidate", false);
  const wasActive = preRecognitionActive,
    active = preRecognition;
  releaseAudioWindow("candidate");
  clearTimeout(preRecognitionTimer);
  clearTimeout(preRecognitionRestartTimer);
  preRecognition = null;
  preRecognitionActive = false;
  preRecognitionDeadline = 0;
  if (wasActive) lastPreRecognitionAt = Date.now();
  try {
    active?.abort();
  } catch {}
}

function specificity(parsed) {
  if (!parsed) return 0;
  return (
    Number(Boolean(parsed.nextStop)) * 5 +
    Number(Boolean(parsed.destination)) * 4 +
    Number(Boolean(parsed.route)) * 3 +
    Number(Boolean(parsed.line)) * 2 +
    Number(Boolean(parsed.trainType))
  );
}

function rememberAnnouncement(parsed) {
  if (!specificAnnouncement(parsed)) return false;
  const now = Date.now(),
    merged = mergeAnnouncementWindow(
      pendingAnnouncement,
      parsed,
      now,
      AUDIO_TTL_MS,
    );
  if (!merged) return false;
  pendingAnnouncement = {
    ...merged,
    applied: new Set(),
  };
  state.smartLiveAnnouncement = {
    parsed: { ...merged.parsed },
    at: merged.at,
  };
  return true;
}

function ingestAnnouncementForCandidate(candidate, minute, now = Date.now()) {
  if (!pendingAnnouncement || now - pendingAnnouncement.at > AUDIO_TTL_MS)
    return false;
  const ride = candidate?.ride ?? candidate;
  if (!ride) return false;
  const match = announcementMatch(pendingAnnouncement.parsed, ride, minute);
  if (!match) return false;
  const sequence = observeAudioSequence(ride, match, pendingAnnouncement.at);
  if (sequence.status === "contradictory") return false;
  const key = transitCandidateKey(ride);
  if (pendingAnnouncement.applied.has(key)) return false;
  pendingAnnouncement.applied.add(key);
  const repetitionBoost = Math.min(0.08, Math.max(0, pendingAnnouncement.hits - 1) * 0.02);
  transitEvidenceEngine.ingest({
    type: "audio",
    candidate: ride,
    direction: ride.directionId ?? ride.direction,
    confidence: Math.min(0.98, match.confidence + repetitionBoost),
    observedAt: pendingAnnouncement.at,
    metadata: {
      directionVerified: true,
      // Two stations heard in order on this train: it is being ridden.
      sequenceValidated: sequence.status === "supportive" && sequence.confidence >= 0.9,
      nextStop: pendingAnnouncement.parsed.nextStop,
      destination: pendingAnnouncement.parsed.destination,
      route: pendingAnnouncement.parsed.route,
      line: pendingAnnouncement.parsed.line,
      audioHits: pendingAnnouncement.hits,
      audioWindowMs: pendingAnnouncement.at - pendingAnnouncement.firstAt,
    },
  });
  return true;
}

function applyPendingAnnouncement() {
  if (!pendingAnnouncement) return false;
  const now = Date.now();
  if (now - pendingAnnouncement.at > AUDIO_TTL_MS) {
    pendingAnnouncement = null;
    return false;
  }
  const minute =
    tokyoNow().minute -
    (state.ride && state.rideShiftKnown ? state.rideShift : 0);
  let changed = false;

  if (state.ride)
    changed = ingestAnnouncementForCandidate(state.ride, minute, now);
  for (const candidate of state.rideCandidates ?? [])
    changed = ingestAnnouncementForCandidate(candidate, minute, now) || changed;

  if (
    !state.ride &&
    !(state.rideCandidates ?? []).length &&
    state.armedJourney?.ride
  ) {
    const ride = state.armedJourney.ride,
      match = announcementMatch(pendingAnnouncement.parsed, ride, minute);
    if (match && boardingAvailable(ride, tokyoNow())) {
      state.rideCandidates = [
        {
          ride,
          score: 62,
          source: "選択した経路＋車内アナウンス",
          armedMatch: true,
        },
      ];
      changed =
        ingestAnnouncementForCandidate(state.rideCandidates[0], minute, now) ||
        changed;
    }
  }
  if (changed)
    queueMicrotask(() =>
      document.dispatchEvent(new CustomEvent("mymap-transit-evidence")),
    );
  return changed;
}

function transcriptResult(event) {
  if (!state.network) return false;
  const stops = [...state.network.stops.values()],
    parsed = [...event.results]
      .flatMap((result) => [...result])
      .map((alternative) => parseAnnouncement(alternative.transcript, stops))
      .filter((row) => specificAnnouncement(row))
      .sort((a, b) => specificity(b) - specificity(a))[0];
  if (!parsed || !rememberAnnouncement(parsed)) return false;
  applyPendingAnnouncement();
  document.dispatchEvent(new CustomEvent("mymap-transit-evidence"));
  return true;
}

let quickEnds = 0;
function startPreRecognitionPass() {
  if (!preRecognitionCanContinue()) {
    stopPreRecognition();
    return;
  }
  const Recognition = speechCtor(),
    recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.continuous = true;
  recognition.maxAlternatives = 5;
  preRecognition = recognition;
  recognition.onresult = (event) => {
    if (preRecognition === recognition && preRecognitionCanContinue())
      transcriptResult(event);
  };
  recognition.onerror = (event) => {
    if (preRecognition !== recognition) return;
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event?.error)) {
      setMicBlocked(true);
      stopPreRecognition();
      document.dispatchEvent(new CustomEvent("mymap-transit-evidence"));
    }
  };
  const startedAt = Date.now();
  recognition.onend = () => {
    if (preRecognition !== recognition) return;
    // A recognizer that keeps ending at once (no device, a service error)
    // is not restarted in a tight loop.
    quickEnds = Date.now() - startedAt < 1000 ? quickEnds + 1 : 0;
    if (quickEnds >= 3) {
      quickEnds = 0;
      stopPreRecognition();
      return;
    }
    preRecognition = null;
    if (!preRecognitionCanContinue()) {
      stopPreRecognition();
      return;
    }
    clearTimeout(preRecognitionRestartTimer);
    preRecognitionRestartTimer = setTimeout(
      startPreRecognitionPass,
      AUDIO_RESTART_DELAY_MS,
    );
  };
  try {
    recognition.start();
  } catch {
    stopPreRecognition();
  }
}

export function maybeStartPreCandidateAudio(now = Date.now(), { force = false } = {}) {
  // Candidates on screen do not stop it: an announcement tells them apart.
  if (
    state.ride ||
    preRecognitionActive ||
    !state.network ||
    !micAllowed(now)
  )
    return false;
  if (!force && now - lastPreRecognitionAt < AUDIO_COOLDOWN_MS) return false;
  if (!acquireAudioWindow("candidate")) return false;
  preRecognitionActive = true;
  markListening("candidate", true);
  preRecognitionDeadline = now + AUDIO_SESSION_MS;
  lastPreRecognitionAt = now;
  clearTimeout(preRecognitionTimer);
  preRecognitionTimer = setTimeout(stopPreRecognition, AUDIO_SESSION_MS + 250);
  startPreRecognitionPass();
  return true;
}

function geoStop(id) {
  return id ? (state.geo?.stops?.find((stop) => stop.id === id) ?? null) : null;
}

function nextStopIndex(ride) {
  const stops = ride?.officialStops ?? [];
  if (stops.length < 2) return -1;
  const observedNext = state.rideObservation?.progress?.next?.id;
  if (observedNext) {
    const index = stops.findIndex((stop) => stop.id === observedNext);
    if (index > 0) return index;
  }
  const minute =
      tokyoNow().minute - (state.rideShiftKnown ? state.rideShift : 0),
    index = stops.findIndex((stop) => {
      const time = stop.departure ?? stop.time ?? stop.arrival;
      return Number.isFinite(time) && time > minute;
    });
  return index > 0 ? index : Math.min(1, stops.length - 1);
}

function candidateDirectionEvidence() {
  const candidates = state.rideCandidates ?? [];
  if (!candidates.length || !state.geo) return false;
  const movement = tenSecondMovement(state.samples),
    newest = state.samples
      ?.filter((sample) => Number.isFinite(sample?.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp)
      .at(-1);
  if (!newest || newest.timestamp <= lastDirectionEvidenceAt) return false;
  lastDirectionEvidenceAt = newest.timestamp;
  let changed = false;
  for (const candidate of candidates) {
    const ride = candidate.ride,
      stops = ride?.officialStops ?? [];
    if (stops.length < 2) continue;
    const previous = geoStop(stops[0].id),
      next = geoStop(stops[1].id),
      trajectory = routeTrajectoryEvidence(state.samples, next, previous),
      simple = movementAgainstStops(movement, next, previous),
      result = trajectory.status !== "neutral" ? trajectory : simple,
      boarding = assessBoardingMovement(state.samples, candidate.evidence ?? [], Date.now());
    // Direction inferred from GPS drift or walking must never identify a ride.
    if (result.status === "neutral" || !boarding.moving) continue;
    changed =
      transitEvidenceEngine.ingest({
        type: "gps",
        candidate: ride,
        direction: ride.directionId ?? ride.direction,
        confidence: result.confidence,
        observedAt: trajectory.last?.timestamp ?? movement.last?.timestamp ?? newest.timestamp,
        metadata: {
          directionVerified: result.status === "supportive",
          rejected: result.status === "contradictory",
          routeTrajectory: trajectory.status === "supportive",
          vehicleMoving: boarding.moving,
          trajectoryConsistency: trajectory.consistency,
          tenSecondDirection: simple.status !== "neutral",
          meters: result.meters ?? movement.meters,
          speed: result.speed ?? movement.speed,
          walkingLikely:
            Number.isFinite(result.speed ?? movement.speed) &&
            (result.speed ?? movement.speed) < 2.5,
        },
      }) || changed;
  }
  if (changed)
    queueMicrotask(() =>
      document.dispatchEvent(new CustomEvent("mymap-transit-evidence")),
    );
  return changed;
}

function verifyCurrentRideDirection() {
  const ride = state.ride;
  if (!ride || !state.geo) return;
  const movement = tenSecondMovement(state.samples),
    stops = ride.officialStops ?? [],
    index = nextStopIndex(ride),
    newest = state.samples
      ?.filter((sample) => Number.isFinite(sample?.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp)
      .at(-1);
  if (!newest || newest.timestamp <= lastDirectionEvidenceAt || index <= 0 || index >= stops.length)
    return;
  lastDirectionEvidenceAt = newest.timestamp;
  const next = geoStop(stops[index].id),
    previous = geoStop(stops[index - 1].id),
    trajectory = routeTrajectoryEvidence(state.samples, next, previous),
    simple = movementAgainstStops(movement, next, previous),
    result = trajectory.status !== "neutral" ? trajectory : simple,
    signature = `${stops[index - 1].id}>${stops[index].id}:${result.status}:${Math.round(result.meters ?? movement.meters ?? 0)}`;
  if (result.status === "supportive") {
    rideDetectionSession.clear("direction");
    transitEvidenceEngine.ingest({
      type: "gps",
      candidate: ride,
      confidence: result.confidence,
      observedAt: trajectory.last?.timestamp ?? movement.last?.timestamp ?? newest.timestamp,
      metadata: {
        directionVerified: true,
        routeTrajectory: trajectory.status === "supportive",
        trajectoryConsistency: trajectory.consistency,
        tenSecondDirection: simple.status === "supportive",
      },
    });
  } else if (result.status === "contradictory")
    recordContradiction("direction", result.confidence, signature);
}

function verifyCurrentBusPattern() {
  const ride = state.ride;
  if (!ride || !["citybus", "kyotobus"].includes(ride.operator)) return;
  const trail = (state.busTrail ?? []).filter(
    (row) => Date.now() - row.at <= 8 * 60 * 1000,
  );
  if (trail.length < 2) return;
  const service = state.network?.services?.find(
      (row) =>
        row.id === (ride.servicePatternId ?? ride.serviceId) ||
        row.id === ride.serviceId,
    ),
    pattern = service?.stops ?? ride.officialStops ?? [],
    circular =
      pattern.length > 1 &&
      (typeof pattern[0] === "string" ? pattern[0] : pattern[0]?.id) ===
        (typeof pattern.at(-1) === "string"
          ? pattern.at(-1)
          : pattern.at(-1)?.id),
    ordered = orderedStopEvidence(pattern, trail, { circular }),
    signature = trail.map((row) => row.id).join(">");
  if (ordered.matched) rideDetectionSession.clear("pattern");
  else if (ordered.rejected) recordContradiction("pattern", 0.96, signature);
}

let lastRealtimeRequest = 0,
  realtimeBusy = false;
function verifyRealtime(feed, provider) {
  const ride = state.ride;
  if (!ride) return;
  const evidence = realtimeRideEvidence(ride, feed, {
    provider,
    online: navigator.onLine !== false,
  });
  if (evidence.status === "supportive") {
    rideDetectionSession.clear("realtime");
    transitEvidenceEngine.ingest({
      type: "realtime",
      candidate: ride,
      confidence: evidence.confidence,
      observedAt: evidence.observedAt,
      metadata: { directionVerified: evidence.directionVerified },
    });
  } else if (evidence.status === "contradictory")
    recordContradiction("realtime", evidence.confidence, evidence.signature);
}
async function refreshRideRealtime() {
  if (
    !state.ride ||
    realtimeBusy ||
    document.hidden ||
    navigator.onLine === false
  )
    return;
  const interval = rideDetectionSession.snapshot().intensified ? 8000 : 20000;
  if (Date.now() - lastRealtimeRequest < interval) return;
  lastRealtimeRequest = Date.now();
  realtimeBusy = true;
  const ride = state.ride;
  try {
    let feed;
    if (["kintetsu", "through"].includes(ride.operator))
      feed = await ensureRailFeed(rideDetectionSession.snapshot().intensified);
    else if (ride.operator === "kyotobus")
      feed = await getKyotoBusRT(AbortSignal.timeout(4000));
    else if (ride.operator === "citybus") {
      const next =
        rideDetectionSession.snapshot().expected?.nextStop ?? ride.from;
      const stop = state.network.stops.get(next);
      if (stop)
        feed = await getBusAll(
          stop.fullName ?? stop.name,
          AbortSignal.timeout(4000),
        );
    }
    if (!document.hidden && state.ride === ride && feed)
      verifyRealtime(feed, ride.operator);
  } catch {
    /* Provider errors are unavailable evidence. */
  } finally {
    realtimeBusy = false;
  }
}

function verifyNotRiding() {
  const session = rideDetectionSession.snapshot();
  if (session.phase !== "rechecking" || !freshFix(state.fix)) return;
  const motion = currentMotionEvidence(state.samples);
  const pool = [
    session.shell,
    ...(state.rideCandidates ?? []).map((c) => c.ride),
  ].filter(Boolean);
  const offRoute =
    pool.length &&
    pool.every((ride) => {
      const points = (ride.officialStops ?? [])
        .map((s) => geoStop(s.id))
        .filter(Boolean);
      return (
        points.length >= 2 &&
        points
          .slice(1)
          .every(
            (p, i) =>
              segmentDistance(state.fix, points[i], p) >
              Math.max(180, state.fix.accuracy * 3),
          )
      );
    });
  const families = new Set(
    session.contradictions.map((e) =>
      ["direction", "pattern", "gps"].includes(e.source) ? "gps" : e.source,
    ),
  );
  if (
    rideDetectionSession.observeNotRiding({
      walking: motion.walkingLikely,
      offRoute: Boolean(offRoute),
      independentConflict: families.size >= 2,
      observedAt: motion.sensorObservedAt,
    })
  ) {
    clearFalseRide();
    document.dispatchEvent(new CustomEvent("mymap-transit-evidence"));
  }
}

function cycle() {
  if (document.hidden || settings.autoDetect === false || !state.network)
    return;
  applyPendingAnnouncement();
  if (state.ride || !micAllowed()) stopPreRecognition();
  if (state.ride) {
    void refreshRideRealtime();
    verifyCurrentRideDirection();
    verifyCurrentBusPattern();
  } else {
    verifyNotRiding();
    candidateDirectionEvidence();
    if (rideDetectionSession.snapshot().intensified)
      document.dispatchEvent(new CustomEvent("mymap-transit-evidence"));
    maybeStartPreCandidateAudio();
  }
}

export function installSmartLiveSupervisor() {
  if (interval) return;
  interval = setInterval(cycle, VERIFY_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPreRecognition();
    else cycle();
  });
  document.addEventListener("mymap-settings-change", () => {
    if (settings.autoDetect === false || settings.audioAssist === false)
      stopPreRecognition();
    else cycle();
  });
  document.addEventListener("mymap-arrivals-updated", () => {
    const ride = state.ride;
    if (ride)
      verifyRealtime(
        ride.operator === "citybus" ? state.busLive : state.railFeed,
        ride.operator,
      );
  });
  document.addEventListener("mymap-transit-evidence", () => {
    setTimeout(applyPendingAnnouncement, 80);
  });
  window.addEventListener("pagehide", stopPreRecognition);
  cycle();
}