import { observeAudioSequence } from "./audio-sequence.js";
import {
  acquireAudioWindow,
  releaseAudioWindow,
  microphoneAlreadyGranted,
} from "./audio-window.js";
import { rideDetectionSession } from "./ride-detection-session.js";
import { recordRideContradiction as recordContradiction } from "./ride-rechecking.js";
import { contradictionDecision } from "./smartlive-evidence.js";
import { parseAnnouncement, announcementMatch } from "./announcement-parser.js";
import {
  transitEvidenceEngine,
  orderedStopEvidence,
} from "./transit-evidence.js";
import { distance } from "./mobility.js";
import { freshFix } from "./riding.js";
import { state, settings, tokyoNow } from "./vnext-state.js";

const RETRY_MS = 16000,
  MOTION_WINDOW_MS = 15000,
  SENSOR_LIMIT = 180,
  VERIFY_INTERVAL_MS = 8000,
  SPEECH_SESSION_MS = 60000,
  SPEECH_RESTART_DELAY_MS = 250;
let recognitionActive = false,
  lastAttemptAt = 0,
  motionInstalled = false,
  activeRecognition = null,
  recognitionTimer = null,
  recognitionRestartTimer = null,
  recognitionDeadline = 0,
  assistInterval = null;
const motionSamples = [];

function speechCtor() {
  return (
    globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null
  );
}
function uncertainCandidates() {
  const candidates = state.rideCandidates ?? [];
  if (!candidates.length) return false;
  const top = candidates[0]?.score ?? 0,
    second = candidates[1]?.score ?? 0;
  return top < 72 || (candidates.length > 1 && top - second < 14);
}
function speechNeeded() {
  return Boolean(state.ride) || uncertainCandidates();
}

function finiteNumber(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function motionMagnitude(event) {
  const direct = event?.acceleration,
    gravity = event?.accelerationIncludingGravity;
  if (direct) {
    const axes = [direct.x, direct.y, direct.z].map(finiteNumber);
    if (axes.some((axis) => axis !== null))
      return Math.hypot(...axes.map((axis) => axis ?? 0));
  }
  if (gravity) {
    const axes = [gravity.x, gravity.y, gravity.z].map(finiteNumber);
    if (axes.some((axis) => axis !== null))
      return Math.abs(Math.hypot(...axes.map((axis) => axis ?? 0)) - 9.80665);
  }
  return null;
}

function recordDeviceMotion(event) {
  if (
    globalThis.document?.hidden ||
    Date.now() - (motionSamples.at(-1)?.at ?? 0) < 80
  )
    return;
  const magnitude = motionMagnitude(event);
  if (!Number.isFinite(magnitude) || magnitude < 0 || magnitude > 25) return;
  const now = Date.now();
  motionSamples.push({ at: now, magnitude });
  const cutoff = now - MOTION_WINDOW_MS * 2;
  while (motionSamples.length && motionSamples[0].at < cutoff)
    motionSamples.shift();
  if (motionSamples.length > SENSOR_LIMIT)
    motionSamples.splice(0, motionSamples.length - SENSOR_LIMIT);
}

function gpsSpeeds(samples, now) {
  const points = (samples ?? [])
    .filter(
      (sample) =>
        sample &&
        freshFix(sample, now) &&
        sample.timestamp >= now - MOTION_WINDOW_MS &&
        sample.timestamp <= now + 5000 &&
        Number.isFinite(sample.lat) &&
        Number.isFinite(sample.lng) &&
        sample.accuracy <= 100,
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  const rows = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    let value =
      Number.isFinite(point.speed) && point.speed >= 0 ? point.speed : null;
    if (value === null && index) {
      const previous = points[index - 1],
        dt = (point.timestamp - previous.timestamp) / 1000;
      if (dt >= 1.5 && dt <= 20) value = distance(previous, point) / dt;
    }
    if (Number.isFinite(value))
      rows.push({ at: point.timestamp, speed: value });
  }
  return rows;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function summarizeVehicleMotion(
  sensorSamples = [],
  gpsSamples = [],
  now = Date.now(),
) {
  const sensor = sensorSamples.filter(
      (sample) =>
        sample &&
        Number.isFinite(sample.at) &&
        sample.at >= now - MOTION_WINDOW_MS &&
        sample.at <= now + 1000 &&
        Number.isFinite(sample.magnitude),
    ),
    magnitudes = sensor.map((sample) => Math.abs(sample.magnitude)),
    rms = magnitudes.length
      ? Math.sqrt(
          magnitudes.reduce((total, value) => total + value * value, 0) /
            magnitudes.length,
        )
      : 0,
    activeRatio = magnitudes.length
      ? magnitudes.filter((value) => value >= 0.15).length / magnitudes.length
      : 0,
    jerks = sensor.slice(1).flatMap((sample, index) => {
      const previous = sensor[index],
        dt = (sample.at - previous.at) / 1000;
      return dt > 0 && dt <= 2
        ? [Math.abs(sample.magnitude - previous.magnitude) / dt]
        : [];
    }),
    jerk = median(jerks) ?? 0,
    speeds = gpsSpeeds(gpsSamples, now),
    currentSpeed = median(speeds.slice(-3).map((row) => row.speed)),
    accelerations = speeds.slice(1).flatMap((row, index) => {
      const previous = speeds[index],
        dt = (row.at - previous.at) / 1000;
      return dt >= 0.5 && dt <= 10
        ? [Math.abs(row.speed - previous.speed) / dt]
        : [];
    }),
    peakAcceleration = accelerations.length ? Math.max(...accelerations) : 0,
    moving = Number.isFinite(currentSpeed) && currentSpeed >= 2.8;

  let score = 0;
  const reasons = [];
  if (moving && sensor.length >= 4 && (rms >= 0.12 || activeRatio >= 0.35)) {
    score += 2;
    reasons.push("端末の加速度変化");
  }
  if (moving && peakAcceleration >= 0.25) {
    score += 3;
    reasons.push("GPS速度の加減速");
  }
  if (moving && sensor.length >= 6 && jerk >= 0.2) {
    score += 1;
    reasons.push("加速度の連続変化");
  }
  const peaks = sensor.filter(
    (sample, i) =>
      i > 0 &&
      i < sensor.length - 1 &&
      sample.magnitude >= 0.45 &&
      sample.magnitude > sensor[i - 1].magnitude &&
      sample.magnitude >= sensor[i + 1].magnitude,
  );
  const span = sensor.length > 1 ? (sensor.at(-1).at - sensor[0].at) / 1000 : 0;
  const cadence = span >= 5 ? peaks.length / span : 0;
  return {
    walkingLikely:
      sensor.length >= 12 &&
      currentSpeed >= 0.6 &&
      currentSpeed <= 2.3 &&
      cadence >= 1.2 &&
      cadence <= 2.7,
    observedAt: now,
    score: Math.min(6, score),
    reason: reasons.join("＋"),
    sensorSamples: sensor.length,
    sensorObservedAt: sensor.at(-1)?.at ?? null,
    acceleration:
      speeds.length > 1
        ? (speeds.at(-1).speed - speeds[0].speed) /
          Math.max(1, (speeds.at(-1).at - speeds[0].at) / 1000)
        : null,
    pattern:
      speeds.length > 1 && speeds.at(-1).speed < 0.8 && speeds[0].speed > 2.8
        ? "deceleration-stop"
        : speeds.length > 1 &&
            speeds[0].speed < 0.8 &&
            speeds.at(-1).speed > 2.8
          ? "stop-acceleration"
          : "unresolved",
    phase: !Number.isFinite(currentSpeed)
      ? sensor.length >= 6 && activeRatio >= 0.35
        ? "moving"
        : "unknown"
      : currentSpeed < 0.8
        ? "stopped"
        : speeds.length > 1 && speeds.at(-1).speed - speeds[0].speed > 1
          ? "departing"
          : speeds.length > 1 && speeds.at(-1).speed - speeds[0].speed < -1
            ? "slowing"
            : "cruising",
    rms,
    activeRatio,
    jerk,
    speed: currentSpeed,
    peakAcceleration,
  };
}

export function currentMotionEvidence(
  gpsSamples = state.samples,
  now = Date.now(),
) {
  return summarizeVehicleMotion(motionSamples, gpsSamples, now);
}

function installDeviceMotion() {
  if (motionInstalled || typeof globalThis.addEventListener !== "function")
    return;
  motionInstalled = true;
  // Do not call DeviceMotionEvent.requestPermission(). On browsers that already
  // allow motion events we consume them; on iOS/WebKit where a user gesture is
  // required, GPS-derived acceleration remains the fallback and no permission
  // prompt or extra control is introduced.
  globalThis.addEventListener("devicemotion", recordDeviceMotion, {
    passive: true,
  });
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

export function announcementContradictsRide(parsed, ride, minute) {
  if (!ride || !parsed) return false;
  const specific = Boolean(
    parsed.nextStop || parsed.destination || parsed.route || parsed.line,
  );
  if (!specific) return false;
  return !announcementMatch(parsed, ride, minute);
}

export function shouldReleaseRideContradictions(rows = [], now = Date.now()) {
  return contradictionDecision(rows, now).release;
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
  else if (ordered.rejected) recordContradiction("pattern", 0.95, signature);
}

function confirmFromTranscript(event) {
  const transcripts = [...event.results]
    .flatMap((result) => [...result])
    .map((item) => item.transcript);
  const stops = [...state.network.stops.values()],
    minute =
      tokyoNow().minute -
      (state.ride && state.rideShiftKnown ? state.rideShift : 0);
  for (const transcript of transcripts) {
    const parsed = parseAnnouncement(transcript, stops);
    if (state.ride) {
      const current = announcementMatch(parsed, state.ride, minute);
      if (current) {
        const sequence = observeAudioSequence(state.ride, current);
        if (sequence.status === "contradictory") {
          recordContradiction(
            "audio",
            sequence.confidence,
            `sequence:${current.nextStop}`,
          );
          document.dispatchEvent(new CustomEvent("mymap-transit-evidence"));
          return false;
        }
        transitEvidenceEngine.ingest({
          type: "audio",
          candidate: state.ride,
          confidence: current.confidence,
          observedAt: Date.now(),
          metadata: { directionVerified: true },
        });
        rideDetectionSession.clear("audio");
        document.dispatchEvent(new CustomEvent("mymap-transit-evidence"));
        return true;
      }
      const alternatives = (state.rideCandidates ?? [])
        .map((candidate) => ({
          candidate,
          match: announcementMatch(parsed, candidate.ride, minute),
        }))
        .filter((row) => row.match);
      if (alternatives.length === 1)
        transitEvidenceEngine.ingest({
          type: "audio",
          candidate: alternatives[0].candidate.ride,
          confidence: alternatives[0].match.confidence,
          observedAt: Date.now(),
          metadata: { directionVerified: true },
        });
      if (announcementContradictsRide(parsed, state.ride, minute)) {
        recordContradiction("audio", 0.9, announcementSignature(parsed));
        document.dispatchEvent(new CustomEvent("mymap-transit-evidence"));
        return alternatives.length === 1;
      }
      continue;
    }
    const matches = state.rideCandidates
      .map((candidate) => ({
        candidate,
        match: announcementMatch(parsed, candidate.ride, minute),
      }))
      .filter((row) => row.match);
    if (matches.length !== 1) continue;
    const sequence = observeAudioSequence(
      matches[0].candidate.ride,
      matches[0].match,
    );
    if (sequence.status === "contradictory") continue;
    transitEvidenceEngine.ingest({
      type: "audio",
      candidate: matches[0].candidate.ride,
      confidence: matches[0].match.confidence,
      observedAt: Date.now(),
      metadata: {
        directionVerified: true,
        sequenceValidated: sequence.confidence >= 0.9,
      },
    });
    document.dispatchEvent(new CustomEvent("mymap-transit-evidence"));
    return true;
  }
  return false;
}

function recognitionCanContinue() {
  return Boolean(
    recognitionActive &&
      Date.now() < recognitionDeadline &&
      settings.autoDetect !== false &&
      settings.audioAssist !== false &&
      !document.hidden &&
      state.network &&
      speechNeeded() &&
      speechCtor(),
  );
}

function stopRecognition() {
  const wasActive = recognitionActive,
    current = activeRecognition;
  releaseAudioWindow("ride");
  clearTimeout(recognitionTimer);
  clearTimeout(recognitionRestartTimer);
  activeRecognition = null;
  recognitionActive = false;
  recognitionDeadline = 0;
  if (wasActive) lastAttemptAt = Date.now();
  try {
    current?.abort();
  } catch {}
}

function startRecognitionPass() {
  if (!recognitionCanContinue()) {
    stopRecognition();
    return;
  }
  const Recognition = speechCtor(),
    recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.continuous = true;
  recognition.maxAlternatives = 5;
  activeRecognition = recognition;
  recognition.onresult = (event) => {
    if (activeRecognition === recognition && recognitionCanContinue())
      confirmFromTranscript(event);
  };
  recognition.onerror = (event) => {
    if (activeRecognition !== recognition) return;
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event?.error))
      stopRecognition();
  };
  recognition.onend = () => {
    if (activeRecognition !== recognition) return;
    activeRecognition = null;
    if (!recognitionCanContinue()) {
      stopRecognition();
      return;
    }
    clearTimeout(recognitionRestartTimer);
    recognitionRestartTimer = setTimeout(
      startRecognitionPass,
      SPEECH_RESTART_DELAY_MS,
    );
  };
  try {
    recognition.start();
  } catch {
    stopRecognition();
  }
}

async function autoSpeechAssist() {
  if (
    settings.autoDetect === false ||
    settings.audioAssist === false ||
    recognitionActive ||
    document.hidden ||
    !state.network ||
    !speechNeeded() ||
    !speechCtor()
  )
    return;

  const now = Date.now();
  if (
    now - lastAttemptAt <
    (rideDetectionSession.snapshot().intensified ? RETRY_MS : 45000)
  )
    return;
  if (!(await microphoneAlreadyGranted())) return;
  if (
    recognitionActive ||
    settings.autoDetect === false ||
    settings.audioAssist === false ||
    document.hidden ||
    !speechNeeded()
  )
    return;

  if (!acquireAudioWindow("ride")) return;
  recognitionActive = true;
  recognitionDeadline = now + SPEECH_SESSION_MS;
  lastAttemptAt = now;
  clearTimeout(recognitionTimer);
  recognitionTimer = setTimeout(stopRecognition, SPEECH_SESSION_MS + 250);
  startRecognitionPass();
}

function runVerificationCycle() {
  if (document.hidden || settings.autoDetect === false) return;
  verifyCurrentBusPattern();
  void autoSpeechAssist();
}

export function installMotionAssist() {
  installDeviceMotion();
  const panel = document.querySelector("#vehicle-panel");
  if (!panel) return;
  const observer = new MutationObserver(() => void autoSpeechAssist());
  observer.observe(panel, { childList: true, subtree: true });
  if (!assistInterval)
    assistInterval = setInterval(runVerificationCycle, VERIFY_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopRecognition();
    else runVerificationCycle();
  });
  document.addEventListener("mymap-settings-change", () => {
    if (settings.autoDetect === false || settings.audioAssist === false)
      stopRecognition();
    else runVerificationCycle();
  });
  window.addEventListener("pagehide", stopRecognition);
  document.addEventListener("mymap-navigation-change", () => {
    if (settings.audioAssist === false || !speechNeeded()) stopRecognition();
    else void autoSpeechAssist();
  });
  runVerificationCycle();
}