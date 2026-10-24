// ATS on screen. The Now status (clock, a row of status icons in the manner
// of the iPhone status bar, and the situation in one line), and the ATS
// sheet (sensors, levels, operating mode, home). "Beta" is shown wherever
// ATS is named.
import { ui } from "./locale.js";
import { esc, state, haptic, toast } from "./vnext-state.js";
import { icon } from "./icons.js";
import { openContextSheet } from "./context-sheet.js";
import { readSearchPairs } from "./search-history.js";
import { readSavedPlaces } from "./saved-places.js";
import { fetchRealtime, isFresh } from "./realtime.js";
import { motionPermissionState } from "./motion-permission.js";
import { RUN_MODES, runMode, setRunMode } from "./run-mode.js";
import {
  ATS_LEVELS,
  atsChosenLevel,
  atsLevel,
  atsModeCap,
  atsSuggests,
  atsSwitchesScreen,
  setAtsLevel,
  readHome,
  saveHome,
  clearHome,
} from "./ats.js";
import { assessScene } from "./ats-scene.js";
import { senseNow } from "./ats-sensors.js";
import { pilotSteps } from "./ats-pilot.js";
import { detectionDisplayState } from "./detection-status-b3.js";

export const MODE_ICONS = Object.freeze({ fullauto: "auto", auto: "hand", lowpower: "leaf" });
const SCENE_ICONS = Object.freeze({
  home: "home",
  at_stop: "bus",
  at_station: "train",
  vehicle: "ats",
  walking: "walk",
  nearby: "location",
  unknown: "location",
  checking: "ats",
  riding_bus: "bus",
  riding_train: "train",
});

export const betaBadge = () => `<span class="ats-beta">Beta</span>`;
const levelName = (level) => `LV.${level}`;

// The steadied scene; one assessment per moment, shared by every view.
let memory = {},
  last = null;
export function atsAssessment(now = Date.now()) {
  const key = `${state.locationStatus}|${state.fix?.timestamp ?? ""}|${state.ride ? "ride" : ""}|${state.rideCandidates?.length ?? 0}`;
  if (last && last.key === key && now - last.snapshot.at < 400) return last;
  const snapshot = senseNow(now),
    result = assessScene(snapshot, memory);
  memory = result.memory;
  last = { ...result, snapshot, key };
  return last;
}
export const currentScene = (now) => atsAssessment(now);

// LV.4: the live approach of the stop the rider stands at, fetched by ATS.
let stopLive = { stopId: null, data: null, at: 0, busy: false };
function liveForStop(place, onUpdate) {
  if (!place || place.stop.type !== "citybus") return null;
  const name = place.stop.fullName ?? place.stop.name;
  if (stopLive.stopId === place.id && Date.now() - stopLive.at < 30000) return stopLive.data;
  if (!stopLive.busy) {
    stopLive = { ...stopLive, busy: true };
    void fetchRealtime(`citybus:${name}`, "/api/citybus/arrivals", { stop: name }, { timeout: 8000 })
      .catch(() => null)
      .then((data) => {
        stopLive = { stopId: place.id, data, at: Date.now(), busy: false };
        onUpdate?.();
      });
  }
  return stopLive.stopId === place.id ? stopLive.data : null;
}
// The next buses at the stop, in one line ("205 1停前 · 10 2停前").
function liveLine(data) {
  if (!data) return ui("ats_live_loading");
  const rows = (data.results ?? []).slice(0, 2);
  if (!rows.length) return ui("ats_live_none");
  const live = data.source === "live" && !data.stale && isFresh(data.asOf);
  return `${rows
    .map((row) =>
      `${row.route} ${
        Number.isInteger(row.stopsAway)
          ? row.stopsAway === 0
            ? ui("radar_at_stop")
            : ui("radar_stops_away", [row.stopsAway])
          : Number.isFinite(row.minutes)
            ? ui("ats_minutes", [row.minutes])
            : ""
      }`.trim(),
    )
    .join(" · ")}${live ? "" : ` (${ui("ats_live_estimate_short")})`}`;
}

function homePairs() {
  const pairs = readSearchPairs(globalThis.localStorage);
  return [...pairs.favorites, ...pairs.history].filter(
    (p, i, all) => all.findIndex((q) => q.from === p.from && q.to === p.to) === i,
  );
}
export const homeRoute = (index) => homePairs().slice(0, 2)[index] ?? null;

// ── Status icons ────────────────────────────────────────────────────────
const LOCATION_DOT = { precise: "available", coarse: "low" };
function liveLevel(snapshot) {
  if (!snapshot.network.online) return 0;
  const age = snapshot.network.liveAge;
  return age === null ? 1 : age <= 60000 ? 3 : age <= 180000 ? 2 : 1;
}
function motionState(snapshot) {
  const permission = snapshot.motion.permission;
  if (permission === "denied") return "denied";
  if (permission === "prompt") return "off";
  return snapshot.motion.samples > 0 ? "on" : "idle";
}
export function statusIcons(snapshot, level) {
  const location = snapshot.location.quality,
    motion = motionState(snapshot),
    signal = liveLevel(snapshot),
    scanning = level >= 2 && ["moving", "candidate", "confirming"].includes(snapshot.ride.phase),
    mode = runMode();
  const item = (name, glyph, attrs, label, extra = "") =>
    `<span class="status-icon" data-indicator="${name}" ${attrs} role="img" aria-label="${esc(label)}">${icon(glyph)}${extra}</span>`;
  return [
    item(
      "location",
      "location",
      `data-location-dot data-quality="${LOCATION_DOT[location] ?? "missing"}" data-state="${location}"`,
      ui(`ats_ind_location_${location}`),
    ),
    item("ats", "ats", `data-level="${level}"${scanning ? " data-scanning" : ""}`, ui("ats_ind_ats", [level]), `<b>${level}</b>`),
    item("motion", "motion", `data-state="${motion}"`, ui(`ats_ind_motion_${motion}`)),
    item("live", "signal", `data-level="${signal}"`, ui(signal ? `ats_ind_live_${signal}` : "ats_ind_live_0")),
    item("mode", MODE_ICONS[mode], `data-mode="${mode}"`, ui(`mode_${mode}`)),
  ].join("");
}

// ── The situation in one line ───────────────────────────────────────────
export function sceneCopy(assessment, level, onUpdate) {
  const snapshot = assessment.snapshot,
    quality = snapshot.location.quality;
  // A lost location is said at once, whatever scene is still held.
  const located = ["precise", "coarse"].includes(quality);
  if (assessment.scene === "unknown" || level === 0 || (!located && assessment.scene !== "vehicle" && !state.ride)) {
    const key = quality === "denied" ? "denied" : quality === "loading" ? "loading" : "missing";
    if (level === 0 && located)
      return { title: ui("ats_off_title"), detail: ui("ats_off_note") };
    if (assessment.scene === "vehicle") return { title: ui("ats_scene_vehicle"), detail: ui("ats_scene_vehicle_note") };
    return { title: ui(`audit_location_${key}`), detail: ui(`audit_location_${key}_detail`) };
  }
  const place = assessment.place,
    title = ui(`ats_scene_${assessment.scene}`, [place?.stop?.name ?? "", place ? Math.round(place.meters) : ""]);
  let detail = ui(`ats_scene_${assessment.scene}_note`);
  const dwell = Math.floor((snapshot.at - (assessment.since ?? snapshot.at)) / 60000);
  if (["at_stop", "at_station", "home"].includes(assessment.scene) && dwell >= 1)
    detail += ` · ${ui("ats_dwell", [dwell])}`;
  if (atsSwitchesScreen(level) && assessment.scene === "at_stop")
    detail = liveLine(liveForStop(place, onUpdate));
  if (quality === "coarse")
    detail = `${ui("ats_coarse", [Math.round(snapshot.location.accuracy ?? 0)])} · ${detail}`;
  return { title, detail };
}

// Actions for the situation (LV.2+), at most two, plus the motion sensor
// switch while it is off.
export function sceneActions(assessment, level) {
  const chip = (attr, glyph, key) =>
    `<button type="button" class="ats-action" ${attr}>${icon(glyph)}<span>${esc(ui(key))}</span></button>`;
  const out = [];
  if (level >= 1 && !state.ride) {
    const place = assessment.place;
    switch (assessment.scene) {
      case "at_stop":
        out.push(chip(`data-ats-arrivals="${esc(place.id)}"`, "bus", "ats_action_arrivals"));
        out.push(chip("data-ats-checkin", "checkin", "checkin_entry"));
        break;
      case "at_station":
        out.push(chip(`data-ats-arrivals="${esc(place.id)}"`, "timetable", "ats_action_departures"));
        out.push(chip("data-ats-choose", "train", "choose_ride"));
        break;
      case "vehicle":
        out.push(chip("data-ats-choose", "ats", "ats_action_which"));
        break;
      case "home":
        if (atsSwitchesScreen(level))
          homePairs()
            .slice(0, 2)
            .forEach((pair, i) =>
              out.push(
                `<button type="button" class="ats-action" data-ats-route="${i}">${icon("search")}<span>${esc(pair.to)}</span></button>`,
              ),
            );
        if (!out.length) out.push(chip("data-ats-plan", "search", "ats_action_plan"));
        break;
      case "walking":
      case "nearby":
        if (place)
          out.push(
            chip(`data-ats-arrivals="${esc(place.id)}"`, place.stop.type.includes("bus") ? "bus" : "train", "ats_action_nearest"),
          );
        break;
    }
  }
  if (level >= 2 && motionPermissionState() === "prompt")
    out.push(chip("data-enable-motion", "motion", "ats_action_motion"));
  return out.slice(0, 3).join("");
}

// Everything the Now status shows.
export function atsStatus(onUpdate) {
  const level = atsLevel(),
    assessment = atsAssessment(),
    copy = sceneCopy(assessment, level, onUpdate);
  return {
    level,
    scene: level === 0 ? "off" : assessment.scene,
    icon: SCENE_ICONS[assessment.scene] ?? "location",
    icons: statusIcons(assessment.snapshot, level),
    title: copy.title,
    detail: copy.detail,
    actions: sceneActions(assessment, level),
  };
}

// ── LV.5 pilot ──────────────────────────────────────────────────────────
const pilotDone = new Set();
export function runPilot({ confirmCandidate, onChange } = {}) {
  const level = atsLevel();
  if (level < 5) return [];
  const assessment = atsAssessment();
  const steps = pilotSteps({
    level,
    scene: assessment,
    ride: state.ride,
    candidates: state.rideCandidates ?? [],
    history: { pairs: homePairs(), saved: readSavedPlaces() },
    done: pilotDone,
    now: assessment.snapshot.at,
  });
  for (const step of steps) {
    pilotDone.add(step.key);
    if (step.type === "destination" && state.ride && !state.ride.userDestination) {
      state.ride.userDestination = { id: step.stop.id, name: step.stop.name, predicted: true };
      toast(ui("ats_pilot_destination", [step.stop.name]));
    } else if (step.type === "board") {
      const index = (state.rideCandidates ?? []).indexOf(step.candidate);
      if (index >= 0 && confirmCandidate?.(index)) toast(ui("ats_pilot_board"));
    }
  }
  if (steps.length) onChange?.();
  return steps;
}

// ── The ATS sheet ───────────────────────────────────────────────────────
function sensorRows(snapshot, level) {
  const row = (glyph, name, value, attrs = "") =>
    `<div class="setting-row ats-sensor-row" ${attrs}>${icon(glyph)}<span><b>${esc(name)}</b><small>${esc(value)}</small></span></div>`;
  const location = snapshot.location,
    speed = snapshot.speed.value;
  const assessment = atsAssessment();
  return [
    row("ats", ui("ats_sensor_scene"), level === 0 ? ui("ats_off_title") : `${ui(`ats_scene_${assessment.scene}`, [assessment.place?.stop?.name ?? "", assessment.place ? Math.round(assessment.place.meters) : ""])}${assessment.pending ? ` → ${ui("ats_sensor_pending")}` : ""}`),
    row("location", ui("ats_sensor_location"), `${ui(`ats_ind_location_${location.quality}`)}${location.accuracy !== null ? ` · ${ui("ats_accuracy", [Math.round(location.accuracy)])}` : ""}`),
    row("walk", ui("ats_sensor_speed"), speed === null ? ui("ats_unknown") : `${Math.round(speed * 3.6)} km/h (${ui(`ats_speed_${snapshot.speed.source}`)})`),
    row("motion", ui("ats_sensor_motion"), `${ui(`ats_ind_motion_${motionState(snapshot)}`)} · ${ui(`ats_activity_${snapshot.motion.activity}`)}`),
    row("signal", ui("ats_sensor_live"), ui(liveLevel(snapshot) ? `ats_ind_live_${liveLevel(snapshot)}` : "ats_ind_live_0")),
    row("checkin", ui("ats_sensor_ride"), state.ride ? ui("ats_ride_active") : ui(`b3_status_${detectionDisplayState({ phase: snapshot.ride.phase, locationStatus: state.locationStatus, autoDetect: level >= 2, hidden: document.hidden, candidates: snapshot.ride.candidates, moving: (speed ?? 0) >= 2.8 })}`)),
  ].join("");
}

function sheetHTML() {
  const chosen = atsChosenLevel(),
    effective = atsLevel(),
    cap = atsModeCap(),
    home = readHome(),
    snapshot = atsAssessment().snapshot;
  const levels = ATS_LEVELS.map(
    (level) =>
      `<button type="button" class="setting-row ats-level-row" role="radio" aria-checked="${level === chosen}" data-ats-set="${level}"><span class="ats-level-badge" data-level="${level}">${esc(levelName(level))}</span><span><b>${esc(ui(`ats_level_${level}`))}${level === 5 ? `<em class="ats-dev">${esc(ui("ats_experimental"))}</em>` : ""}</b><small>${esc(ui(`ats_level_${level}_note`))}</small></span><span class="run-mode-check" aria-hidden="true">${level === chosen ? icon("checkmark") : ""}</span></button>`,
  ).join("");
  const modes = RUN_MODES.map(
    (mode) =>
      `<button type="button" class="ats-mode" role="radio" aria-checked="${mode === runMode()}" data-ats-mode="${mode}">${icon(MODE_ICONS[mode])}<b>${esc(ui(`mode_${mode}`))}</b><small>${esc(ui("ats_mode_cap", [atsModeCap(mode)]))}</small></button>`,
  ).join("");
  return `<section class="ats-sheet"><header class="ats-sheet-head">${icon("ats")}<div><h3>Auto transportation system ${betaBadge()}</h3><p>${esc(ui("ats_sheet_intro"))}</p></div></header>
<p class="ats-status" role="status">${esc(ui("ats_status", [levelName(effective)]))}${chosen > effective ? ` ${esc(ui("ats_capped", [levelName(chosen), ui(`mode_${runMode()}`), levelName(cap)]))}` : ""}</p>
<h4 class="ats-sheet-label">${esc(ui("ats_sensor_title"))}</h4><div class="settings-card ats-sensors">${sensorRows(snapshot, effective)}</div>
<h4 class="ats-sheet-label">${esc(ui("mode_title"))}</h4><div class="ats-modes" role="radiogroup" aria-label="${esc(ui("mode_title"))}">${modes}</div><p class="ats-note">${esc(ui(`mode_${runMode()}_note`))}</p>
<h4 class="ats-sheet-label">${esc(ui("ats_level_title"))}</h4><div class="settings-card ats-levels" role="radiogroup" aria-label="${esc(ui("ats_level_title"))}">${levels}</div>
<h4 class="ats-sheet-label">${esc(ui("ats_home_title"))}</h4><div class="settings-card"><div class="setting-row ats-home-row">${icon("home")}<span><b>${esc(ui(home ? "ats_home_set" : "ats_home_unset"))}</b><small>${esc(ui("ats_home_note"))}</small></span></div><button type="button" class="setting-row" data-ats-home-save>${esc(ui("ats_home_here"))}</button>${home ? `<button type="button" class="setting-row destructive" data-ats-home-clear>${esc(ui("ats_home_clear"))}</button>` : ""}</div>
<p class="source-caption">${esc(ui("ats_privacy"))}</p></section>`;
}

export function openAtsSheet(onChange = () => {}) {
  const sheet = document.querySelector("#context-sheet");
  sheet.dataset.detent = "large";
  openContextSheet(ui("ats_title"), sheetHTML());
  const rerender = () => {
    const fresh = sheet.querySelector(".ats-sheet");
    if (fresh) fresh.outerHTML = sheetHTML();
    bind();
    onChange();
  };
  function bind() {
    sheet.querySelector(".ats-sheet")?.addEventListener("click", (event) => {
      const level = event.target.closest("[data-ats-set]"),
        mode = event.target.closest("[data-ats-mode]");
      if (level) {
        haptic();
        const switched = setAtsLevel(Number(level.dataset.atsSet));
        if (switched) toast(ui("ats_mode_switched", [ui(`mode_${switched}`)]));
        rerender();
      } else if (mode) {
        haptic();
        setRunMode(mode.dataset.atsMode);
        rerender();
      } else if (event.target.closest("[data-ats-home-save]")) {
        const fix = state.locationStatus === "active" ? state.fix : null;
        if (!fix || fix.accuracy > 100) toast(ui("ats_home_need_fix"));
        else if (saveHome(fix)) {
          toast(ui("ats_home_saved"));
          rerender();
        }
      } else if (event.target.closest("[data-ats-home-clear]")) {
        clearHome();
        rerender();
      }
    });
  }
  bind();
}
