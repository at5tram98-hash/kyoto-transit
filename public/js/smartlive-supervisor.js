import { parseAnnouncement, announcementMatch } from "./announcement-parser.js";
import {
  transitEvidenceEngine,
  transitCandidateKey,
  orderedStopEvidence,
} from "./transit-evidence.js";
import { freshFix } from "./riding.js";
import { boardingAvailable } from "./journey-session.js";
import {
  state,
  settings,
  tokyoNow,
  nearest,
  persistJourney,
  toast,
} from "./vnext-state.js";
import {
  tenSecondMovement,
  movementAgainstStops,
  specificAnnouncement,
  contradictionDecision,
} from "./smartlive-evidence.js";

const AUDIO_TTL_MS = 45000,
  AUDIO_COOLDOWN_MS = 11000,
  VERIFY_INTERVAL_MS = 4000,
  CONTRADICTION_TTL_MS = 90000;

let pendingAnnouncement = null,
  preRecognition = null,
  preRecognitionTimer = null,
  preRecognitionActive = false,
  lastPreRecognitionAt = 0,
  lastDirectionEvidenceAt = 0,
  interval = null,
  contradictions = [];

function speechCtor() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

async function microphoneAlreadyGranted() {
  if (!globalThis.navigator) return false;
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: "microphone" });
      if (status.state === "granted") return true;
      if (status.state === "denied" || status.state === "prompt") return false;
    }
  } catch {}
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.();
    return Boolean(
      devices?.some(
        (device) => device.kind === "audioinput" && device.label?.trim(),
      ),
    );
  } catch {
    return false;
  }
}

function stopPreRecognition() {
  clearTimeout(preRecognitionTimer);
  const active = preRecognition;
  preRecognition = null;
  preRecognitionActive = false;
  try {
    active?.abort();
  } catch {}
}

function nearbyBoardingContext(now = Date.now()) {
  if (state.armedJourney?.ride && boardingAvailable(state.armedJourney.ride, tokyoNow()))
    return true;
  if (transitEvidenceEngine.stationContext(now)) return true;
  if ((state.busTrail ?? []).some((row) => now - row.at <= 120000)) return true;
  if (!freshFix(state.fix, now) || !state.network || !state.geo) return false;
  try {
    const near = nearest();
    return Boolean(
      (near.rail && near.rail.meters <= Math.max(220, state.fix.accuracy * 2.3)) ||
        (near.bus && near.bus.meters <= Math.max(140, state.fix.accuracy * 2)) ||
        (near.kyotoBus &&
          near.kyotoBus.meters <= Math.max(170, state.fix.accuracy * 2.2)),
    );
  } catch {
    return false;
  }
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

function rememberAnnouncement(parsed, transcript) {
  if (!specificAnnouncement(parsed)) return false;
  pendingAnnouncement = {
    parsed,
    transcript,
    at: Date.now(),
    applied: new Set(),
  };
  state.smartLiveAnnouncement = {
    parsed: { ...parsed },
    at: pendingAnnouncement.at,
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
  const key = transitCandidateKey(ride);
  if (pendingAnnouncement.applied.has(key)) return false;
  pendingAnnouncement.applied.add(key);
  transitEvidenceEngine.ingest({
    type: "audio",
    candidate: ride,
    direction: ride.directionId ?? ride.direction,
    confidence: match.confidence,
    observedAt: pendingAnnouncement.at,
    metadata: {
      directionVerified: true,
      nextStop: pendingAnnouncement.parsed.nextStop,
      destination: pendingAnnouncement.parsed.destination,
      route: pendingAnnouncement.parsed.route,
      line: pendingAnnouncement.parsed.line,
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
    tokyoNow().minute - (state.ride && state.rideShiftKnown ? state.rideShift : 0);
  let changed = false;

  if (state.ride) changed = ingestAnnouncementForCandidate(state.ride, minute, now);
  for (const candidate of state.rideCandidates ?? [])
    changed = ingestAnnouncementForCandidate(candidate, minute, now) || changed;

  // A selected journey is a safe seed only after the announcement itself
  // matches that exact planned ride. It is not treated as proof by itself.
  if (!state.ride && !(state.rideCandidates ?? []).length && state.armedJourney?.ride) {
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
      changed = ingestAnnouncementForCandidate(state.rideCandidates[0], minute, now) || changed;
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
      .map((alternative) => ({
        transcript: alternative.transcript,
        parsed: parseAnnouncement(alternative.transcript, stops),
      }))
      .filter((row) => specificAnnouncement(row.parsed))
      .sort((a, b) => specificity(b.parsed) - specificity(a.parsed))[0];
  if (!parsed || !rememberAnnouncement(parsed.parsed, parsed.transcript)) return false;
  applyPendingAnnouncement();
  document.dispatchEvent(new CustomEvent("mymap-transit-evidence"));
  return true;
}

async function maybeStartPreCandidateAudio() {
  if (
    settings.autoDetect === false ||
    settings.audioAssist === false ||
    document.hidden ||
    state.ride ||
    (state.rideCandidates ?? []).length ||
    preRecognitionActive ||
    !state.network ||
    !speechCtor() ||
    !nearbyBoardingContext()
  )
    return;
  const now = Date.now();
  if (now - lastPreRecognitionAt < AUDIO_COOLDOWN_MS) return;
  if (!(await microphoneAlreadyGranted())) return;
  if (
    document.hidden ||
    state.ride ||
    (state.rideCandidates ?? []).length ||
    !nearbyBoardingContext()
  )
    return;

  const Recognition = speechCtor(),
    recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 4;
  preRecognition = recognition;
  preRecognitionActive = true;
  lastPreRecognitionAt = now;
  preRecognitionTimer = setTimeout(stopPreRecognition, 6000);
  recognition.onresult = transcriptResult;
  recognition.onerror = stopPreRecognition;
  recognition.onend = () => {
    if (preRecognition !== recognition) return;
    clearTimeout(preRecognitionTimer);
    preRecognition = null;
    preRecognitionActive = false;
  };
  try {
    recognition.start();
  } catch {
    stopPreRecognition();
  }
}

function geoStop(id) {
  return id ? state.geo?.stops?.find((stop) => stop.id === id) ?? null : null;
}

function nextStopIndex(ride) {
  const stops = ride?.officialStops ?? [];
  if (stops.length < 2) return -1;
  const observedNext = state.rideObservation?.progress?.next?.id;
  if (observedNext) {
    const index = stops.findIndex((stop) => stop.id === observedNext);
    if (index > 0) return index;
  }
  const minute = tokyoNow().minute - (state.rideShiftKnown ? state.rideShift : 0),
    index = stops.findIndex((stop) => {
      const time = stop.departure ?? stop.time ?? stop.arrival;
      return Number.isFinite(time) && time > minute;
    });
  return index > 0 ? index : Math.min(1, stops.length - 1);
}

function clearContradiction(source) {
  const now = Date.now();
  contradictions = contradictions.filter(
    (row) => now - row.at <= CONTRADICTION_TTL_MS && row.source !== source,
  );
  state.smartLiveContradictions = contradictions.map((row) => ({ ...row }));
}

function releaseForRecheck(reason) {
  const ride = state.ride;
  if (!ride) return false;
  const now = Date.now();
  // Keep a negative evidence lock for the suspect candidate so the immediate
  // recheck cannot bounce straight back to the same ride from schedule alone.
  transitEvidenceEngine.ingest({
    type: "pattern",
    candidate: ride,
    confidence: 1,
    observedAt: now,
    metadata: { rejected: true, supervisor: true, reason },
  });
  transitEvidenceEngine.unlock();
  state.smartLivePreviousRide = { ride, at: now, reason };
  state.ride = null;
  state.rideShift = 0;
  state.rideShiftKnown = false;
  state.rideObservation = null;
  state.heroObservation = null;
  state.rideSource = "乗車中の便を再確認中";
  state.rideConfidence = 0;
  state.rideConsensusCount = 0;
  state.foldbackPlan = null;
  state.rideCandidates = [];
  state.rideContradictions = [];
  contradictions = [];
  state.smartLiveContradictions = [];
  persistJourney(true);
  toast("乗車中の便を再確認しています");
  queueMicrotask(() =>
    document.dispatchEvent(new CustomEvent("mymap-transit-evidence")),
  );
  return true;
}

function recordContradiction(source, confidence, signature) {
  if (!state.ride) return false;
  const now = Date.now(),
    last = contradictions.at(-1);
  contradictions = contradictions.filter((row) => now - row.at <= CONTRADICTION_TTL_MS);
  if (
    last?.source === source &&
    last?.signature === signature &&
    now - last.at < 3500
  )
    return false;
  contradictions.push({ source, confidence, signature, at: now });
  contradictions = contradictions.slice(-10);
  state.smartLiveContradictions = contradictions.map((row) => ({ ...row }));
  const combined = [
      ...(state.rideContradictions ?? []),
      ...contradictions,
    ].filter((row) => now - row.at <= CONTRADICTION_TTL_MS),
    decision = contradictionDecision(combined, now);
  return decision.release ? releaseForRecheck(decision.reason) : false;
}

function candidateDirectionEvidence() {
  const candidates = state.rideCandidates ?? [];
  if (!candidates.length || !state.geo) return false;
  const movement = tenSecondMovement(state.samples);
  if (
    !Number.isFinite(movement.heading) ||
    !movement.last ||
    movement.last.timestamp <= lastDirectionEvidenceAt
  )
    return false;
  lastDirectionEvidenceAt = movement.last.timestamp;
  let changed = false;
  for (const candidate of candidates) {
    const ride = candidate.ride,
      stops = ride?.officialStops ?? [];
    if (stops.length < 2) continue;
    const previous = geoStop(stops[0].id),
      next = geoStop(stops[1].id),
      result = movementAgainstStops(movement, next, previous);
    if (result.status === "neutral") continue;
    changed =
      transitEvidenceEngine.ingest({
        type: "gps",
        candidate: ride,
        direction: ride.directionId ?? ride.direction,
        confidence: result.confidence,
        observedAt: movement.last.timestamp,
        metadata: {
          directionVerified: result.status === "supportive",
          rejected: result.status === "contradictory",
          tenSecondDirection: true,
          heading: movement.heading,
          meters: movement.meters,
          walkingLikely: Number.isFinite(movement.speed) && movement.speed < 2.5,
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
    index = nextStopIndex(ride);
  if (
    !Number.isFinite(movement.heading) ||
    !movement.last ||
    movement.last.timestamp <= lastDirectionEvidenceAt ||
    index <= 0 ||
    index >= stops.length
  )
    return;
  lastDirectionEvidenceAt = movement.last.timestamp;
  const next = geoStop(stops[index].id),
    previous = geoStop(stops[index - 1].id),
    result = movementAgainstStops(movement, next, previous),
    signature = `${stops[index - 1].id}>${stops[index].id}:${Math.round(movement.heading / 15) * 15}`;
  if (result.status === "supportive") {
    clearContradiction("direction");
    transitEvidenceEngine.ingest({
      type: "gps",
      candidate: ride,
      confidence: result.confidence,
      observedAt: movement.last.timestamp,
      metadata: { directionVerified: true, tenSecondDirection: true },
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
  if (ordered.matched) clearContradiction("pattern");
  else if (ordered.rejected) recordContradiction("pattern", 0.96, signature);
}

function cycle() {
  if (document.hidden || settings.autoDetect === false || !state.network) return;
  applyPendingAnnouncement();
  if (state.ride || (state.rideCandidates ?? []).length) stopPreRecognition();
  if (state.ride) {
    verifyCurrentRideDirection();
    verifyCurrentBusPattern();
  } else {
    candidateDirectionEvidence();
    void maybeStartPreCandidateAudio();
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
  document.addEventListener("mymap-transit-evidence", () => {
    setTimeout(applyPendingAnnouncement, 80);
  });
  window.addEventListener("pagehide", stopPreRecognition);
  cycle();
}
