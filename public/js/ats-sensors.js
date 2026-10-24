// ATS sensor hub. Every input ATS judges from is gathered here once per
// look, each with how far it can be trusted, so the scene engine never reads
// app state directly and never mistakes a missing sensor for "still".
//
//   location – the GPS fix: precise (≤ 50 m), coarse, stale (> 45 s),
//              missing, loading or denied
//   speed    – the fix's own speed when the device reports it, else the
//              median speed along the recent track; null when unknown
//   motion   – the accelerometer: still, walking (step cadence), vehicle
//              (sustained vibration at speed) or unknown, and whether the
//              rider has allowed it
//   network  – online, and how old the latest official live data is
//   context  – day type, hour, home, nearby stops and stations
//   ride     – the ride in progress and the detection session's phase
import { state, nearest, tokyoNow } from "./vnext-state.js";
import { trajectory } from "./riding.js";
import { currentMotionEvidence } from "./motion-assist.js";
import { motionPermissionState } from "./motion-permission.js";
import { rideDetectionSession } from "./ride-detection-session.js";
import { readHome } from "./ats.js";

export const FIX_MAX_AGE = 45000;
export const PRECISE_ACCURACY = 50;

export function locationQuality({ status, fix, now }) {
  if (status === "denied") return "denied";
  if (!fix || ![fix.lat, fix.lng].every(Number.isFinite))
    return status === "loading" ? "loading" : "missing";
  if (now - fix.timestamp > FIX_MAX_AGE) return "stale";
  return Number.isFinite(fix.accuracy) && fix.accuracy <= PRECISE_ACCURACY ? "precise" : "coarse";
}

// Accelerometer activity from the motion summary.
export function motionActivity(summary = {}, permission = "prompt") {
  if (permission === "denied") return "unknown";
  if (!summary || (summary.sensorSamples ?? 0) < 6) return "unknown";
  if (summary.walkingLikely) return "walking";
  if (summary.rms < 0.06 && summary.activeRatio < 0.15) return "still";
  if (summary.activeRatio >= 0.35 && summary.rms >= 0.12 && summary.speed >= 2.8) return "vehicle";
  return summary.activeRatio >= 0.35 ? "moving" : "still";
}

// Pure: builds the snapshot from raw inputs (tests pass these directly).
export function fuseSnapshot({
  now = Date.now(),
  locationStatus = "missing",
  fix = null,
  track = null,
  motion = null,
  permission = "prompt",
  online = true,
  liveAt = null,
  dayType = null,
  hour = null,
  home = null,
  nearby = [],
  ride = null,
  phase = "idle",
  candidates = 0,
} = {}) {
  const quality = locationQuality({ status: locationStatus, fix, now });
  const usable = quality === "precise" || quality === "coarse";
  const reported = usable && Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed : null,
    tracked = usable && track && Number.isFinite(track.speed) && track.span >= 10 ? track.speed : null;
  return {
    at: now,
    location: {
      quality,
      fix: usable ? fix : null,
      accuracy: usable && Number.isFinite(fix.accuracy) ? fix.accuracy : null,
      age: fix && Number.isFinite(fix.timestamp) ? Math.max(0, now - fix.timestamp) : null,
    },
    speed: {
      value: reported ?? tracked,
      source: reported !== null ? "gps" : tracked !== null ? "track" : null,
    },
    motion: {
      permission,
      activity: motionActivity(motion, permission),
      samples: motion?.sensorSamples ?? 0,
    },
    network: {
      online: online !== false,
      liveAge: Number.isFinite(liveAt) ? Math.max(0, now - liveAt) : null,
    },
    context: { dayType, hour, home, nearby: usable ? nearby.slice(0, 12) : [] },
    ride: { active: ride, phase, candidates },
  };
}

// Reads the app's sensors now.
export function senseNow(now = Date.now()) {
  const clock = tokyoNow();
  let motion = null;
  try {
    motion = currentMotionEvidence(state.samples ?? [], now);
  } catch {}
  const session = rideDetectionSession.snapshot?.(now) ?? {};
  return fuseSnapshot({
    now,
    locationStatus: state.locationStatus,
    fix: state.fix,
    track: trajectory(state.samples ?? [], now),
    motion,
    permission: motionPermissionState(),
    online: globalThis.navigator?.onLine,
    liveAt: Number.isFinite(state.busLiveAt) ? state.busLiveAt : null,
    dayType: clock.dayType ?? null,
    hour: Math.floor((clock.minute ?? 0) / 60),
    home: readHome(),
    nearby: nearest().all ?? [],
    ride: state.ride,
    phase: session.phase ?? "idle",
    candidates: state.rideCandidates?.length ?? 0,
  });
}
