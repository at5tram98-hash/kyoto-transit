// ATS (Auto transportation system), Beta. How much of the guidance the app
// takes on by itself, in levels:
//   LV.0 – off: the location is not read for the situation; manual only.
//   LV.1 – awareness: the current situation (home, at a stop or station,
//          on the move) is shown, nothing changes by itself.
//   LV.2 – suggestions: actions for the situation, and the services you may
//          be on are offered; boarding is confirmed with one tap.
//   LV.3 – automatic boarding: a ride starts once independent evidence
//          (position, motion, timetable, live data) agrees.
//   LV.4 – automatic screen: the Now screen switches to the situation by
//          itself, e.g. the live approach of the stop you are standing at.
//   LV.5 – experimental guidance with no operation (ats-pilot.js): the
//          stop to get off at is predicted, and a single well-supported
//          service is boarded without the tap. Auto mode only.
// The operating mode caps the level: a lighter mode never runs more than
// it allows (battery and data), whatever level was chosen.
import { settings, saveSettings } from "./vnext-state.js";
import { runMode, setRunMode } from "./run-mode.js";

export const ATS_LEVELS = Object.freeze([0, 1, 2, 3, 4, 5]);
export const ATS_SELECTABLE = 5;
const MODE_CAP = Object.freeze({ fullauto: 5, auto: 2, lowpower: 1 });

export function atsChosenLevel(source = settings) {
  const level = Number(source.atsLevel);
  if (Number.isInteger(level) && level >= 0 && level <= ATS_SELECTABLE) return level;
  // Carried over from the operating mode chosen before ATS.
  return runMode(source) === "fullauto" ? 3 : 1;
}
export const atsModeCap = (mode = runMode()) => MODE_CAP[mode] ?? 1;
export const atsLevel = (source = settings) =>
  Math.min(atsChosenLevel(source), atsModeCap(runMode(source)));

export const atsReadsSituation = (level = atsLevel()) => level >= 1;
export const atsSuggests = (level = atsLevel()) => level >= 2;
export const atsBoardsAutomatically = (level = atsLevel()) => level >= 3;
export const atsSwitchesScreen = (level = atsLevel()) => level >= 4;
export const atsPilots = (level = atsLevel()) => level >= 5;

// Ride detection runs from LV.2 (to offer candidates); the legacy flag
// that the detection code reads follows it.
export function syncAtsDetection(source = settings) {
  source.autoDetect = atsLevel(source) >= 2;
  return source.autoDetect;
}

// Choosing a level the current mode cannot run moves to the mode that can.
// Returns the mode switched to, or null.
export function setAtsLevel(level) {
  if (!Number.isInteger(level) || level < 0 || level > ATS_SELECTABLE) return null;
  settings.atsLevel = level;
  let switched = null;
  if (level > atsModeCap()) {
    switched = level >= 3 ? "fullauto" : "auto";
    if (!setRunMode(switched)) switched = null;
  }
  syncAtsDetection();
  saveSettings();
  globalThis.document?.dispatchEvent?.(
    new CustomEvent("mymap-ats-level", { detail: { level: atsLevel() } }),
  );
  return switched;
}

// Home: a point the rider set on this device. Kept only in this browser,
// rounded to about 10 m, and never sent anywhere.
const HOME_KEY = "mymap-ats-home-v1";
export function readHome(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(HOME_KEY) ?? "null");
    return value && [value.lat, value.lng].every(Number.isFinite) &&
      Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180
      ? { lat: value.lat, lng: value.lng }
      : null;
  } catch {
    return null;
  }
}
export function saveHome(fix, storage = globalThis.localStorage) {
  if (!fix || ![fix.lat, fix.lng].every(Number.isFinite)) return false;
  const round = (v) => Math.round(v * 10000) / 10000;
  try {
    storage.setItem(HOME_KEY, JSON.stringify({ lat: round(fix.lat), lng: round(fix.lng) }));
  } catch {
    return false;
  }
  globalThis.document?.dispatchEvent?.(new CustomEvent("mymap-ats-home"));
  return true;
}
export function clearHome(storage = globalThis.localStorage) {
  try {
    storage.removeItem(HOME_KEY);
  } catch {}
  globalThis.document?.dispatchEvent?.(new CustomEvent("mymap-ats-home"));
}
