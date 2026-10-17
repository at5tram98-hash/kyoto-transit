import {
  acquireAudioWindow,
  releaseAudioWindow,
  microphoneAlreadyGranted,
} from "./audio-window.js";
import { observeAudioSequence } from "./audio-sequence.js";
import { parseAnnouncement, announcementMatch } from "./announcement-parser.js";
import {
  currentMotionEvidence,
  announcementContradictsRide,
} from "./motion-assist.js";
import { recordRideContradiction } from "./ride-rechecking.js";
import { rideDetectionSession } from "./ride-detection-session.js";
import { boardingAvailable } from "./journey-session.js";
import { freshFix } from "./riding.js";
import {
  transitCandidateKey,
  transitEvidenceEngine,
} from "./transit-evidence.js";
import { state, settings, tokyoNow, nearest } from "./vnext-state.js";
import {
  boostedAudioConfidence,
  fuseBoardingSignals,
  summarizeRouteTrajectory,
} from "./boarding-fusion-core.js";

const AUDIO_OWNER = "boarding-fusion",
  AUDIO_WINDOW_MS = 60000,
  AUDIO_COOLDOWN_MS = 45000,
  AUDIO_HISTORY_MS = 65000,
  FUSION_INTERVAL_MS = 4000;

let interval = null,
  audioSession = null,
  lastAudioEndedAt = 0,
  announcementId = 0;
let recentAnnouncements = [];
const appliedAudio = new Set(),
  audioHits = new Map();

function speechCtor() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
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

function rideMinute() {
  return (
    tokyoNow().minute -
    (state.ride && state.rideShiftKnown ? Number(state.rideShift || 0) : 0)
  );
}

function ridesInPlay() {
  const rows = [
    state.ride,
    ...(state.rideCandidates ?? []).map((candidate) => candidate?.ride),
    state.armedJourney?.ride,
  ].filter(Boolean);
  const map = new Map();
  for (const ride of rows) map.set(transitCandidateKey(ride), ride);
  return [...map.values()];
}

function routePoints(ride) {
  const geoStops = state.geo?.stops ?? [];
  const byId = new Map(geoStops.map((stop) => [stop.id, stop]));
  return (ride?.officialStops ?? [])
    .map((stop) => byId.get(stop.id))
    .filter(
      (stop) =>
        stop && Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng)),
    )
    .map((stop) => ({ id: stop.id, lat: Number(stop.lat), lng: Number(stop.lng) }));
}

function nearbyBoardingContext() {
  if (!state.network || !state.geo) return false;
  if (
    state.armedJourney?.ride &&
    boardingAvailable(state.armedJourney.ride, tokyoNow())
  )
    return true;
  if ((state.rideCandidates ?? []).length) return true;
  if (state.ride && Date.now() - Number(state.rideStartedAt ?? 0) <= 90000)
    return true;
  if (rideDetectionSession.snapshot().phase === "rechecking") return true;
  if (!freshFix(state.fix)) return false;
  try {
    const near = nearest();
    return Boolean(
      (near.rail && near.rail.meters <= Math.min(180, Math.max(95, state.fix.accuracy * 1.8))) ||
        (near.bus && near.bus.meters <= Math.min(170, Math.max(90, state.fix.accuracy * 1.9))) ||
        (near.kyotoBus && near.kyotoBus.meters <= Math.min(190, Math.max(100, state.fix.accuracy * 2))),
    );
  } catch {
    return false;
  }
}

function audioWanted() {
  return Boolean(
    settings.autoDetect !== false &&
      settings.audioAssist !== false &&
      !document.hidden &&
      state.network &&
      speechCtor() &&
      nearbyBoardingContext(),
  );
}

function pruneAudio(now = Date.now()) {
  recentAnnouncements = recentAnnouncements.filter(
    (row) => now - row.at <= AUDIO_HISTORY_MS,
  );
  for (const [key, rows] of audioHits) {
    const recent = rows.filter((at) => now - at <= AUDIO_HISTORY_MS);
    if (recent.length) audioHits.set(key, recent);
    else audioHits.delete(key);
  }
  if (appliedAudio.size > 200) appliedAudio.clear();
}

function announcementSignature(parsed) {
  return [
    parsed.line ?? "",
    parsed.route ?? "",
    parsed.destination ?? "",
    parsed.nextStop ?? "",
    parsed.trainType ?? "",
  ].join("|");
}

function rememberParsedAnnouncement(parsed, at = Date.now()) {
  if (!parsed || specificity(parsed) <= 0) return false;
  const row = { id: ++announcementId, parsed: { ...parsed }, at };
  recentAnnouncements.push(row);
  recentAnnouncements = recentAnnouncements.slice(-12);
  state.smartLiveAnnouncement = { parsed: { ...parsed }, at };
  return true;
}

function applyAudioEvidence(now = Date.now()) {
  pruneAudio(now);
  const rides = ridesInPlay();
  if (!rides.length || !recentAnnouncements.length) return false;
  const minute = rideMinute();
  let changed = false;

  for (const announcement of recentAnnouncements) {
    for (const ride of rides) {
      const candidateKey = transitCandidateKey(ride),
        applicationKey = `${announcement.id}:${candidateKey}`;
      if (appliedAudio.has(applicationKey)) continue;
      const match = announcementMatch(announcement.parsed, ride, minute);
      if (!match) {
        if (
          state.ride &&
          transitCandidateKey(state.ride) === candidateKey &&
          announcementContradictsRide(announcement.parsed, ride, minute)
        ) {
          recordRideContradiction(
            "audio",
            0.88,
            announcementSignature(announcement.parsed),
          );
          appliedAudio.add(applicationKey);
        }
        continue;
      }

      const sequence = observeAudioSequence(ride, match, announcement.at);
      if (sequence.status === "contradictory") {
        if (state.ride && transitCandidateKey(state.ride) === candidateKey)
          recordRideContradiction(
            "audio",
            Math.max(0.8, Number(sequence.confidence ?? 0.8)),
            `sequence:${match.nextStop ?? announcementSignature(announcement.parsed)}`,
          );
        appliedAudio.add(applicationKey);
        continue;
      }

      const hits = [...(audioHits.get(candidateKey) ?? []), announcement.at].filter(
        (at) => now - at <= AUDIO_HISTORY_MS,
      );
      audioHits.set(candidateKey, hits);
      const confidence = boostedAudioConfidence(
        match.confidence,
        hits.length,
        sequence.status,
      );
      changed =
        transitEvidenceEngine.ingest({
          type: "audio",
          candidate: ride,
          direction: ride.directionId ?? ride.direction,
          confidence,
          observedAt: announcement.at,
          metadata: {
            directionVerified: true,
            nextStop: match.nextStop ?? announcement.parsed.nextStop ?? null,
            destination: announcement.parsed.destination ?? null,
            route: announcement.parsed.route ?? null,
            line: announcement.parsed.line ?? null,
            repeatCount: hits.length,
            audioWindowMs: AUDIO_WINDOW_MS,
          },
        }) || changed;
      if (state.ride && transitCandidateKey(state.ride) === candidateKey)
        rideDetectionSession.clear("audio");
      appliedAudio.add(applicationKey);
    }
  }
  return changed;
}

function processRecognitionResult(event) {
  if (!state.network) return;
  const stops = [...state.network.stops.values()],
    start = Number.isInteger(event.resultIndex) ? event.resultIndex : 0;
  let remembered = false;
  for (let index = start; index < event.results.length; index++) {
    const result = event.results[index];
    if (result?.isFinal === false) continue;
    const best = [...result]
      .map((alternative) => parseAnnouncement(alternative.transcript, stops))
      .filter((parsed) => specificity(parsed) > 0)
      .sort((a, b) => specificity(b) - specificity(a))[0];
    if (best) remembered = rememberParsedAnnouncement(best) || remembered;
  }
  if (!remembered) return;
  const changed = applyAudioEvidence();
  document.dispatchEvent(
    new CustomEvent("mymap-transit-evidence", {
      detail: { source: changed ? "audio-fusion" : "audio-context" },
    }),
  );
}

function endAudioSession() {
  const session = audioSession;
  if (!session) return;
  audioSession = null;
  clearTimeout(session.timer);
  try {
    session.recognition?.abort();
  } catch {}
  releaseAudioWindow(AUDIO_OWNER);
  lastAudioEndedAt = Date.now();
}

function startRecognitionChunk(session) {
  if (audioSession !== session || Date.now() >= session.deadline || !audioWanted()) {
    endAudioSession();
    return;
  }
  const Recognition = speechCtor();
  if (!Recognition) {
    endAudioSession();
    return;
  }
  const recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.continuous = true;
  recognition.maxAlternatives = 5;
  session.recognition = recognition;
  recognition.onresult = (event) => {
    if (audioSession === session && !document.hidden) processRecognitionResult(event);
  };
  recognition.onerror = (event) => {
    if (audioSession !== session) return;
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error))
      endAudioSession();
  };
  recognition.onend = () => {
    if (audioSession !== session) return;
    session.recognition = null;
    if (Date.now() >= session.deadline || !audioWanted()) endAudioSession();
    else setTimeout(() => startRecognitionChunk(session), 120);
  };
  try {
    recognition.start();
  } catch {
    if (audioSession === session) setTimeout(() => startRecognitionChunk(session), 250);
  }
}

async function maybeStartAudioSession() {
  if (
    audioSession ||
    !audioWanted() ||
    Date.now() - lastAudioEndedAt < AUDIO_COOLDOWN_MS
  )
    return;
  if (!acquireAudioWindow(AUDIO_OWNER)) return;
  if (!(await microphoneAlreadyGranted())) {
    releaseAudioWindow(AUDIO_OWNER);
    return;
  }
  if (!audioWanted()) {
    releaseAudioWindow(AUDIO_OWNER);
    return;
  }
  const session = {
    deadline: Date.now() + AUDIO_WINDOW_MS,
    recognition: null,
    timer: null,
  };
  session.timer = setTimeout(endAudioSession, AUDIO_WINDOW_MS);
  audioSession = session;
  startRecognitionChunk(session);
}

function ingestMobilityEvidence(now = Date.now()) {
  const rides = ridesInPlay();
  if (!rides.length || !state.geo || !state.samples?.length) return false;
  const motion = currentMotionEvidence(state.samples, now),
    latestSample = [...state.samples]
      .filter((sample) => Number.isFinite(sample?.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp)
      .at(-1);
  if (!latestSample || now - latestSample.timestamp > 45000) return false;
  let changed = false;

  for (const ride of rides) {
    const route = routePoints(ride);
    if (route.length < 2) continue;
    const trajectory = summarizeRouteTrajectory(state.samples, route, now),
      fusion = fuseBoardingSignals(trajectory, motion, ride.operator);
    if (fusion.shouldIngestGps)
      changed =
        transitEvidenceEngine.ingest({
          type: "gps",
          candidate: ride,
          direction: ride.directionId ?? ride.direction,
          confidence: fusion.gpsConfidence,
          observedAt: latestSample.timestamp,
          metadata: {
            directionVerified: fusion.directionVerified,
            rejected: fusion.rejected,
            walkingLikely: fusion.walkingLikely,
            trajectoryAligned: fusion.routeAligned,
            trajectoryDirection: trajectory.direction,
            routeRatio: trajectory.routeRatio,
            progressMeters: trajectory.progressDelta,
            offRouteMeters: trajectory.currentOffRouteMeters,
            speed: fusion.speed,
            transportSpecific: fusion.transportSpecific,
          },
        }) || changed;

    if (fusion.shouldIngestMotion && Number.isFinite(motion.sensorObservedAt))
      changed =
        transitEvidenceEngine.ingest({
          type: "motion",
          candidate: ride,
          direction: ride.directionId ?? ride.direction,
          confidence: fusion.motionConfidence,
          observedAt: motion.sensorObservedAt,
          metadata: {
            sensorBacked: fusion.sensorBacked,
            vehicleLike: fusion.movingVehicle,
            accelerationSignal: fusion.accelerationSignal,
            phase: motion.phase,
            pattern: motion.pattern,
            acceleration: motion.acceleration,
            peakAcceleration: motion.peakAcceleration,
            trajectoryAligned: fusion.routeAligned,
          },
        }) || changed;
  }
  return changed;
}

function cycle() {
  if (document.hidden || settings.autoDetect === false || !state.network) return;
  const audioChanged = applyAudioEvidence(),
    mobilityChanged = ingestMobilityEvidence();
  if (audioChanged || mobilityChanged)
    document.dispatchEvent(
      new CustomEvent("mymap-transit-evidence", {
        detail: { source: "boarding-fusion" },
      }),
    );
  void maybeStartAudioSession();
}

export function installBoardingFusion() {
  if (interval) return;
  interval = setInterval(cycle, FUSION_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) endAudioSession();
    else cycle();
  });
  document.addEventListener("mymap-settings-change", () => {
    if (settings.autoDetect === false || settings.audioAssist === false)
      endAudioSession();
    else cycle();
  });
  document.addEventListener("mymap-navigation-change", cycle);
  document.addEventListener("mymap-arrivals-updated", cycle);
  window.addEventListener("pagehide", endAudioSession);
  cycle();
}
