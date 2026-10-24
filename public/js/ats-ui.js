// ATS on screen: the situation card at the top of Now, and the ATS sheet
// (levels, operating mode, home). "Beta" is shown wherever ATS is named.
import { ui } from "./locale.js";
import { esc, state, nearest, haptic, toast } from "./vnext-state.js";
import { icon } from "./icons.js";
import { lineBadge } from "./line-badge.js";
import { openContextSheet } from "./context-sheet.js";
import { readSearchPairs } from "./search-history.js";
import { fetchRealtime, isFresh } from "./realtime.js";
import { trajectory } from "./riding.js";
import { RUN_MODES, runMode, setRunMode } from "./run-mode.js";
import {
  ATS_LEVELS,
  ATS_SELECTABLE,
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
import { classifyScene } from "./ats-scene.js";

export const MODE_ICONS = Object.freeze({ fullauto: "bolt", auto: "hand", lowpower: "leaf" });
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

export function currentScene(now = Date.now()) {
  const motion = trajectory(state.samples ?? [], now);
  return classifyScene({
    ride: state.ride,
    fix: state.locationStatus === "active" ? state.fix : null,
    speed: Number.isFinite(motion.speed) && motion.span >= 10 ? motion.speed : null,
    nearby: nearest().all ?? [],
    home: readHome(),
    now,
  });
}

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

function liveRowsHTML(data) {
  if (!data) return `<p class="ats-note" role="status">${esc(ui("ats_live_loading"))}</p>`;
  const rows = (data.results ?? []).slice(0, 3);
  if (!rows.length) return `<p class="ats-note">${esc(ui("ats_live_none"))}</p>`;
  const live = data.source === "live" && !data.stale && isFresh(data.asOf);
  return `<ul class="ats-live">${rows
    .map(
      (row) =>
        `<li>${lineBadge({ operator: "citybus", route: row.route }, { size: "small" })}<span>${esc(row.dest ?? "")}</span><b>${esc(
          Number.isInteger(row.stopsAway)
            ? row.stopsAway === 0
              ? ui("radar_at_stop")
              : ui("radar_stops_away", [row.stopsAway])
            : Number.isFinite(row.minutes)
              ? ui("ats_minutes", [row.minutes])
              : "",
        )}</b></li>`,
    )
    .join("")}</ul><p class="ats-note">${esc(ui(live ? "ats_live_source" : "ats_live_estimate"))}</p>`;
}

function homeRoutesHTML() {
  const pairs = readSearchPairs(globalThis.localStorage),
    list = [...pairs.favorites, ...pairs.history]
      .filter((p, i, all) => all.findIndex((q) => q.from === p.from && q.to === p.to) === i)
      .slice(0, 3);
  if (!list.length) return `<p class="ats-note">${esc(ui("ats_home_no_routes"))}</p>`;
  return `<div class="ats-routes">${list
    .map(
      (pair, i) =>
        `<button type="button" class="ats-route" data-ats-route="${i}">${icon("search")}<span>${esc(pair.from)} → ${esc(pair.to)}</span></button>`,
    )
    .join("")}</div>`;
}
export function homeRoute(index) {
  const pairs = readSearchPairs(globalThis.localStorage);
  return [...pairs.favorites, ...pairs.history]
    .filter((p, i, all) => all.findIndex((q) => q.from === p.from && q.to === p.to) === i)
    .slice(0, 3)[index] ?? null;
}

function sceneTitle(result) {
  const name = result.place?.stop?.name ?? "";
  return ui(`ats_scene_${result.scene}`, [name, result.place ? Math.round(result.place.meters) : ""]);
}

// Actions offered for the situation from LV.2.
function sceneActions(result) {
  const button = (attr, glyph, key) =>
    `<button type="button" class="ats-action" ${attr}>${icon(glyph)}<span>${esc(ui(key))}</span></button>`;
  switch (result.scene) {
    case "at_stop":
      return [button(`data-ats-arrivals="${esc(result.place.id)}"`, "bus", "ats_action_arrivals")];
    case "at_station":
      return [button(`data-ats-arrivals="${esc(result.place.id)}"`, "timetable", "ats_action_departures")];
    case "home":
      return [button("data-ats-plan", "search", "ats_action_plan")];
    case "walking":
    case "nearby":
      return result.place
        ? [button(`data-ats-arrivals="${esc(result.place.id)}"`, result.place.stop.type.includes("bus") ? "bus" : "train", "ats_action_nearest")]
        : [];
    default:
      return [];
  }
}

export function atsCardHTML(onUpdate, footer = "") {
  const level = atsLevel();
  const head = `<button type="button" class="ats-head" data-ats-open aria-haspopup="dialog">${icon("ats")}<span class="ats-name">ATS</span>${betaBadge()}<span class="ats-level" data-ats-level="${level}">${esc(levelName(level))}</span><span class="ats-mode-chip" data-mode="${runMode()}">${icon(MODE_ICONS[runMode()])}<span>${esc(ui(`mode_${runMode()}`))}</span></span><span class="chevron" aria-hidden="true">›</span></button>`;
  if (level === 0)
    return `<section class="ats-card" data-ats-scene="off">${head}<p class="ats-note">${esc(ui("ats_off_note"))}</p>${footer}</section>`;
  const result = currentScene();
  const body = [
    `<div class="ats-scene">${icon(SCENE_ICONS[result.scene] ?? "location")}<span><b>${esc(sceneTitle(result))}</b><small>${esc(ui(`ats_scene_${result.scene}_note`))}</small></span></div>`,
  ];
  if (atsSwitchesScreen(level) && result.scene === "at_stop")
    body.push(liveRowsHTML(liveForStop(result.place, onUpdate)));
  if (atsSwitchesScreen(level) && result.scene === "home") body.push(homeRoutesHTML());
  if (result.scene === "home" || (atsSuggests(level) && result.scene !== "unknown")) {
    const actions = atsSuggests(level) ? sceneActions(result) : [];
    if (actions.length) body.push(`<div class="ats-actions">${actions.join("")}</div>`);
  }
  return `<section class="ats-card" data-ats-scene="${esc(result.scene)}" aria-label="${esc(ui("ats_card_label"))}">${head}${body.join("")}${footer}</section>`;
}

function sheetHTML() {
  const chosen = atsChosenLevel(),
    effective = atsLevel(),
    cap = atsModeCap(),
    home = readHome();
  const levels = ATS_LEVELS.map((level) => {
    const locked = level > ATS_SELECTABLE;
    return `<button type="button" class="setting-row ats-level-row" role="radio" aria-checked="${level === chosen}" data-ats-set="${level}"${locked ? " disabled aria-disabled=\"true\"" : ""}><span class="ats-level-badge" data-level="${level}">${esc(levelName(level))}</span><span><b>${esc(ui(`ats_level_${level}`))}${locked ? `<em class="ats-dev">${esc(ui("ats_in_development"))}</em>` : ""}</b><small>${esc(ui(`ats_level_${level}_note`))}</small></span><span class="run-mode-check" aria-hidden="true">${level === chosen ? icon("checkmark") : ""}</span></button>`;
  }).join("");
  const modes = RUN_MODES.map(
    (mode) =>
      `<button type="button" class="ats-mode" role="radio" aria-checked="${mode === runMode()}" data-ats-mode="${mode}">${icon(MODE_ICONS[mode])}<b>${esc(ui(`mode_${mode}`))}</b><small>${esc(ui("ats_mode_cap", [atsModeCap(mode)]))}</small></button>`,
  ).join("");
  return `<section class="ats-sheet"><header class="ats-sheet-head">${icon("ats")}<div><h3>Auto transportation system ${betaBadge()}</h3><p>${esc(ui("ats_sheet_intro"))}</p></div></header>
<p class="ats-status" role="status">${esc(ui("ats_status", [levelName(effective)]))}${chosen > effective ? ` ${esc(ui("ats_capped", [levelName(chosen), ui(`mode_${runMode()}`), levelName(cap)]))}` : ""}</p>
<h4 class="ats-sheet-label">${esc(ui("ats_level_title"))}</h4><div class="settings-card ats-levels" role="radiogroup" aria-label="${esc(ui("ats_level_title"))}">${levels}</div>
<h4 class="ats-sheet-label">${esc(ui("mode_title"))}</h4><div class="ats-modes" role="radiogroup" aria-label="${esc(ui("mode_title"))}">${modes}</div><p class="ats-note">${esc(ui(`mode_${runMode()}_note`))}</p>
<h4 class="ats-sheet-label">${esc(ui("ats_home_title"))}</h4><div class="settings-card"><div class="setting-row ats-home-row">${icon("home")}<span><b>${esc(ui(home ? "ats_home_set" : "ats_home_unset"))}</b><small>${esc(ui("ats_home_note"))}</small></span></div><button type="button" class="setting-row" data-ats-home-save>${esc(ui("ats_home_here"))}</button>${home ? `<button type="button" class="setting-row destructive" data-ats-home-clear>${esc(ui("ats_home_clear"))}</button>` : ""}</div>
<p class="source-caption">${esc(ui("ats_privacy"))}</p></section>`;
}

export function openAtsSheet(onChange = () => {}) {
  const sheet = document.querySelector("#context-sheet");
  sheet.dataset.detent = "large";
  openContextSheet(ui("ats_title"), sheetHTML());
  const section = sheet.querySelector(".ats-sheet");
  const rerender = () => {
    const fresh = sheet.querySelector(".ats-sheet");
    if (fresh) fresh.outerHTML = sheetHTML();
    bind();
    onChange();
  };
  function bind() {
    sheet.querySelector(".ats-sheet")?.addEventListener("click", (event) => {
      const level = event.target.closest("[data-ats-set]:not([disabled])"),
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
  if (section) bind();
}

// The card's buttons. Returns true when the click was an ATS action.
export function handleAtsClick(event, { onOpenStop, onChoose, onCheckIn, onPlan, onRoute, onChange }) {
  const target = event.target.closest(
    "[data-ats-open],[data-ats-arrivals],[data-ats-choose],[data-ats-checkin],[data-ats-plan],[data-ats-route]",
  );
  if (!target) return false;
  if (target.hasAttribute("data-ats-open")) openAtsSheet(onChange);
  else if (target.dataset.atsArrivals) onOpenStop(target.dataset.atsArrivals);
  else if (target.hasAttribute("data-ats-choose")) onChoose();
  else if (target.hasAttribute("data-ats-checkin")) onCheckIn();
  else if (target.hasAttribute("data-ats-plan")) onPlan();
  else if (target.dataset.atsRoute) onRoute(homeRoute(Number(target.dataset.atsRoute)));
  return true;
}
