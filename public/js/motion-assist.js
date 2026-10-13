import { distance } from "./mobility.js";
import { freshFix } from "./riding.js";
import { state, serviceName, toast, rideKey } from "./vnext-state.js";

const RETRY_MS = 30000,
  MOTION_WINDOW_MS = 15000,
  SENSOR_LIMIT = 180;
let recognitionActive = false,
  lastAttemptAt = 0,
  lastCandidateSignature = "",
  motionInstalled = false;
const motionSamples = [];

function normalized(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s・ーｰ\-]/g, "")
    .replace(/京都市バス|京都バス|地下鉄|近鉄|烏丸線|京都線|系統/g, "");
}

function speechCtor() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

function candidateTokens(candidate) {
  const ride = candidate?.ride;
  if (!ride) return [];
  return [
    ride.route,
    ride.destination,
    ride.label,
    serviceName(ride),
    ...(ride.officialStops ?? []).map((stop) => stop.name),
  ]
    .map(normalized)
    .filter((value) => value.length >= 2);
}

function bestCandidate(transcript) {
  const text = normalized(transcript);
  const ranked = (state.rideCandidates ?? []).map((candidate, index) => ({
    index,
    score: candidateTokens(candidate).reduce(
      (score, token) => score + (text.includes(token) ? Math.min(8, token.length) : 0),
      0,
    ),
  }));
  ranked.sort((a, b) => b.score - a.score);
  if (!ranked[0] || ranked[0].score < 3) return null;
  if (ranked[1] && ranked[0].score === ranked[1].score) return null;
  return ranked[0].index;
}

function uncertainCandidates() {
  const candidates = state.rideCandidates ?? [];
  if (!candidates.length) return false;
  const top = candidates[0]?.score ?? 0,
    second = candidates[1]?.score ?? 0;
  return top < 72 || (candidates.length > 1 && top - second < 14);
}

function candidateSignature() {
  return (state.rideCandidates ?? [])
    .map((candidate) => `${rideKey(candidate?.ride)}:${Math.round(candidate?.score ?? 0)}`)
    .join("|");
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
  const magnitude = motionMagnitude(event);
  if (!Number.isFinite(magnitude) || magnitude < 0 || magnitude > 25) return;
  const now = Date.now();
  motionSamples.push({ at: now, magnitude });
  const cutoff = now - MOTION_WINDOW_MS * 2;
  while (motionSamples.length && motionSamples[0].at < cutoff) motionSamples.shift();
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
    if (Number.isFinite(value)) rows.push({ at: point.timestamp, speed: value });
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
  return {
    observedAt: now,
    score: Math.min(6, score),
    reason: reasons.join("＋"),
    sensorSamples: sensor.length,
    rms,
    activeRatio,
    jerk,
    speed: currentSpeed,
    peakAcceleration,
  };
}

export function currentMotionEvidence(gpsSamples = state.samples, now = Date.now()) {
  return summarizeVehicleMotion(motionSamples, gpsSamples, now);
}

function installDeviceMotion() {
  if (motionInstalled || typeof globalThis.addEventListener !== "function") return;
  motionInstalled = true;
  // Do not call DeviceMotionEvent.requestPermission(). On browsers that already
  // allow motion events we consume them; on iOS/WebKit where a user gesture is
  // required, GPS-derived acceleration remains the fallback and no permission
  // prompt or extra control is introduced.
  globalThis.addEventListener("devicemotion", recordDeviceMotion, { passive: true });
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

  // Safari/WebKit may not expose microphone through Permissions API. Device
  // labels are only populated after microphone permission has already been
  // granted, so this fallback does not trigger a permission prompt.
  try {
    if (navigator.mediaDevices?.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(
        (device) => device.kind === "audioinput" && Boolean(device.label?.trim()),
      );
    }
  } catch {}
  return false;
}

function confirmFromTranscript(event) {
  const alternatives = [...event.results]
    .flatMap((result) => [...result])
    .map((item) => item.transcript);
  const match = alternatives
    .map(bestCandidate)
    .find((index) => Number.isInteger(index));
  if (!Number.isInteger(match)) return false;
  const choice = document.querySelector(`[data-ride-candidate="${match}"]`);
  if (!choice) return false;
  toast("アナウンスと候補が一致しました");
  choice.click();
  return true;
}

async function autoSpeechAssist() {
  if (
    recognitionActive ||
    document.hidden ||
    state.ride ||
    !uncertainCandidates() ||
    !speechCtor()
  )
    return;

  const signature = candidateSignature(),
    now = Date.now();
  if (!signature) return;
  if (signature === lastCandidateSignature && now - lastAttemptAt < RETRY_MS) return;
  if (!(await microphoneAlreadyGranted())) return;
  if (document.hidden || state.ride || !uncertainCandidates()) return;

  const Recognition = speechCtor();
  if (!Recognition) return;
  const recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 3;
  recognitionActive = true;
  lastAttemptAt = Date.now();
  lastCandidateSignature = signature;

  recognition.onresult = (event) => confirmFromTranscript(event);
  recognition.onerror = (event) => {
    // Automatic assist must never open a permission flow or add UI. If the
    // browser revokes/blocks access, quietly fall back to GPS/timetable/live
    // evidence and wait for a later permission-granted state.
    if (["not-allowed", "service-not-allowed"].includes(event.error))
      lastCandidateSignature = "";
  };
  recognition.onend = () => {
    recognitionActive = false;
  };

  try {
    recognition.start();
  } catch {
    recognitionActive = false;
  }
}

export function installMotionAssist() {
  installDeviceMotion();
  const panel = document.querySelector("#vehicle-panel");
  if (!panel) return;
  const observer = new MutationObserver(() => void autoSpeechAssist());
  observer.observe(panel, { childList: true, subtree: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void autoSpeechAssist();
  });
  void autoSpeechAssist();
}
