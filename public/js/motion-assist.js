import { state, serviceName, toast, rideKey } from "./vnext-state.js";

const RETRY_MS = 30000;
let recognitionActive = false,
  lastAttemptAt = 0,
  lastCandidateSignature = "";

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
  const panel = document.querySelector("#vehicle-panel");
  if (!panel) return;
  const observer = new MutationObserver(() => void autoSpeechAssist());
  observer.observe(panel, { childList: true, subtree: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void autoSpeechAssist();
  });
  void autoSpeechAssist();
}
