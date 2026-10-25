// When the microphone may listen for on-train announcements. Only when the
// GPS fix is poor ("GPS精度：低", over 50 m), which in Kyoto almost always
// means underground on the Karasuma line or the Kintetsu through section,
// or when the fix has been lost right after a subway station. Anywhere
// else — a good fix, no location at all, at home — the microphone stays off.
// Speech recognition is the only microphone use in the app, and every
// start goes through micAllowed().
import { state, settings } from "./vnext-state.js";
import { locationQuality } from "./ats-sensors.js";
import { transitEvidenceEngine } from "./transit-evidence.js";
import { readHome } from "./ats.js";
import { distance } from "./mobility.js";

export const LOST_GPS_WINDOW_MS = 15 * 60000;
export const HOME_QUIET_METRES = 150;

// Pure: the reading behind the decision.
export function lowAccuracyReason({
  status,
  fix,
  now = Date.now(),
  home = null,
  subwayStationAt = null,
} = {}) {
  const quality = locationQuality({ status, fix, now });
  if (home && fix && [fix.lat, fix.lng].every(Number.isFinite) && distance(fix, home) <= Math.max(HOME_QUIET_METRES, Math.min(fix.accuracy ?? 0, 300)))
    return null;
  if (quality === "coarse") return "coarse";
  // GPS gone just after a subway station: underground.
  if (
    ["stale", "missing"].includes(quality) &&
    Number.isFinite(subwayStationAt) &&
    now - subwayStationAt <= LOST_GPS_WINDOW_MS
  )
    return "underground";
  return null;
}

export function speechCtor() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

// The browser refused to start listening without a tap (or the rider said
// no): stop trying until the rider taps "listen" in the ATS status.
let blocked = false;
export const micBlocked = () => blocked;
export function setMicBlocked(value) {
  blocked = Boolean(value);
}

// The situation calls for listening (whether or not it is possible now).
export function micWanted(now = Date.now()) {
  if (settings.audioAssist === false || settings.autoDetect === false) return false;
  if (globalThis.document?.hidden || !speechCtor()) return false;
  const station = transitEvidenceEngine.stationContext(now, LOST_GPS_WINDOW_MS);
  return Boolean(
    lowAccuracyReason({
      status: state.locationStatus,
      fix: state.fix,
      now,
      home: readHome(),
      subwayStationAt: station?.station?.stop?.type === "subway" ? station.at : null,
    }),
  );
}

export const micAllowed = (now = Date.now()) => !blocked && micWanted(now);

// Who is listening now ("candidate" before a ride, "ride" during one), for
// the status bar's microphone indicator.
const listening = new Set();
export function markListening(owner, on) {
  const before = listening.size;
  if (on) listening.add(owner);
  else listening.delete(owner);
  if (before !== listening.size)
    globalThis.document?.dispatchEvent?.(new CustomEvent("mymap-mic-change"));
}
export const micListening = () => listening.size > 0;
