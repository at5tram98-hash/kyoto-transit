// Three operating modes.
//   fullauto – automatic ride detection and service identification, plus
//              approach and riding displays in Picture in Picture.
//   auto     – approach information on screen and in Picture in Picture;
//              no automatic ride detection (boarding is chosen by hand).
//   lowpower – coarse, infrequent location and no automatic detection or
//              Picture in Picture.
// The legacy autoDetect flag follows the mode so existing checks hold.
import { settings, saveSettings } from "./vnext-state.js";

export const RUN_MODES = Object.freeze(["fullauto", "auto", "lowpower"]);

export function runMode(source = settings) {
  if (RUN_MODES.includes(source.runMode)) return source.runMode;
  return source.autoDetect === false ? "auto" : "fullauto";
}

export function setRunMode(mode) {
  if (!RUN_MODES.includes(mode) || runMode() === mode) return false;
  settings.runMode = mode;
  settings.autoDetect = mode === "fullauto";
  saveSettings();
  globalThis.document?.dispatchEvent?.(
    new CustomEvent("mymap-run-mode", { detail: { mode } }),
  );
  return true;
}

export const modeAllowsDetection = (mode = runMode()) => mode === "fullauto";
export const modeAllowsPip = (mode = runMode()) => mode !== "lowpower";

export function positionOptions(mode = runMode()) {
  return mode === "lowpower"
    ? { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 }
    : { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 };
}
