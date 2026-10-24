// The check-in sheet: the bus stops nearby, a wheel picker of the routes and
// directions at the chosen stop, and three ways to check in — shake the
// phone, double-press volume-down (where the browser reports it) or tap.
import { ui, displayStopName } from "./locale.js";
import { $, esc, state, nearest, tokyoNow, haptic, toast } from "./vnext-state.js";
import { icon } from "./icons.js";
import { lineBadge } from "./line-badge.js";
import { openContextSheet } from "./context-sheet.js";
import { getStaticFeed } from "./fast-data.js";
import {
  checkInStops,
  checkInChoices,
  createShakeDetector,
  createVolumeDoublePress,
} from "./bus-checkin.js";
import {
  motionPermissionState,
  requestMotionPermission,
} from "./motion-permission.js";

const ROW = 44;
let session = null;

const plain = (name) => String(name ?? "").replace(/（.*?）|\(.*?\)/g, "");
function choiceLabel(choice) {
  const ride = choice.ride,
    headsign = plain(ride.destination);
  // A loop route ends where it starts; name it by the next stop instead.
  if (ride.to === ride.from)
    return ui("checkin_choice_loop", [plain(ride.officialStops?.[1]?.name ?? "")]);
  return ride.operator === "kyotobus" && Number.isFinite(ride.depart)
    ? ui("checkin_choice_timed", [headsign, `${String(Math.floor(ride.depart / 60) % 24).padStart(2, "0")}:${String(ride.depart % 60).padStart(2, "0")}`])
    : ui("checkin_choice", [headsign]);
}

// An iOS-style wheel: a scroll-snapped column whose rows tilt away from the
// selection band. The selected index follows the scroll position.
function mountWheel(wheel, count, onChange) {
  const track = wheel.querySelector(".wheel-track"),
    rows = [...track.children];
  let index = -1,
    frame = 0;
  const paint = () => {
    frame = 0;
    const center = track.scrollTop / ROW;
    rows.forEach((row, i) => {
      const offset = Math.max(-2.6, Math.min(2.6, i - center));
      row.style.transform = `rotateX(${(-offset * 22).toFixed(1)}deg) translateZ(0)`;
      row.style.opacity = String(Math.max(0.25, 1 - Math.abs(offset) * 0.3));
    });
    const next = Math.max(0, Math.min(count - 1, Math.round(center)));
    if (next !== index) {
      const first = index < 0;
      index = next;
      rows.forEach((row, i) => row.setAttribute("aria-selected", String(i === index)));
      track.setAttribute("aria-activedescendant", rows[index]?.id ?? "");
      if (!first) haptic();
      onChange(index);
    }
  };
  track.addEventListener("scroll", () => {
    if (!frame) frame = requestAnimationFrame(paint);
  }, { passive: true });
  const select = (i) =>
    track.scrollTo({ top: Math.max(0, Math.min(count - 1, i)) * ROW, behavior: "smooth" });
  track.addEventListener("click", (event) => {
    const row = event.target.closest("[data-wheel-index]");
    if (row) select(Number(row.dataset.wheelIndex));
  });
  track.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") select(index + 1);
    else if (event.key === "ArrowUp") select(index - 1);
    else return;
    event.preventDefault();
  });
  paint();
}

function stopTabsHTML(stops, selected) {
  if (stops.length < 2) return "";
  return `<div class="checkin-stops segmented" role="group" aria-label="${esc(ui("checkin_stop"))}">${stops
    .map(
      (row) =>
        `<button type="button" data-checkin-stop="${esc(row.id)}" aria-pressed="${row.id === selected}">${esc(displayStopName(row.stop))}<small>${esc(ui(row.stop.type === "kyotobus" ? "checkin_kyotobus" : "checkin_citybus"))} · ${Math.round(row.meters)}m</small></button>`,
    )
    .join("")}</div>`;
}

function gestureHTML() {
  const motion = motionPermissionState();
  return `<div class="checkin-gesture" data-motion="${esc(motion)}"><span class="checkin-shake" aria-hidden="true">${icon("shake")}</span><p><b>${esc(ui("checkin_shake"))}</b><small>${esc(ui(motion === "denied" ? "checkin_shake_denied" : "checkin_volume"))}</small></p></div>`;
}

async function renderStop(stopId) {
  const body = $("#context-sheet-body"),
    section = body?.querySelector(".checkin");
  if (!section || !session) return;
  session.stopId = stopId;
  // Nothing can be checked in until this stop's routes are listed.
  session.choices = [];
  section.querySelector("[data-checkin-confirm]").disabled = true;
  const row = session.stops.find((s) => s.id === stopId),
    now = tokyoNow();
  let kyotoFeed = null;
  if (row?.stop.type === "kyotobus") {
    section.querySelector("[data-checkin-wheel]").innerHTML =
      `<p class="source-note" role="status">${esc(ui("checkin_loading"))}</p>`;
    kyotoFeed = await getStaticFeed("kyotobus", now.date).catch(() => null);
    if (!session || session.stopId !== stopId) return;
  }
  session.choices = checkInChoices(row?.stop, {
    network: state.network,
    minute: now.minute,
    kyotoFeed,
  });
  session.index = 0;
  section.querySelectorAll("[data-checkin-stop]").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.checkinStop === stopId)),
  );
  const holder = section.querySelector("[data-checkin-wheel]"),
    confirm = section.querySelector("[data-checkin-confirm]");
  if (!session.choices.length) {
    holder.innerHTML = `<p class="empty-state" role="status">${esc(ui(row?.stop.type === "kyotobus" ? "checkin_empty_kyotobus" : "checkin_empty"))}</p>`;
    confirm.disabled = true;
    return;
  }
  confirm.disabled = false;
  holder.innerHTML = `<div class="wheel-picker"><div class="wheel-track" role="listbox" tabindex="0" aria-label="${esc(ui("checkin_route"))}">${session.choices
    .map(
      (choice, i) =>
        `<div class="wheel-row" role="option" id="checkin-option-${i}" data-wheel-index="${i}" aria-selected="false">${lineBadge(choice.ride, { size: "small" })}<span>${esc(choiceLabel(choice))}</span></div>`,
    )
    .join("")}</div><span class="wheel-band" aria-hidden="true"></span></div>`;
  mountWheel(holder.querySelector(".wheel-picker"), session.choices.length, (i) => {
    session.index = i;
  });
}

function stop() {
  if (!session) return;
  removeEventListener("devicemotion", session.onMotion);
  removeEventListener("keydown", session.onKey, true);
  session = null;
}

function checkIn(via) {
  // Gestures count only while this sheet is the one on screen.
  if (!session?.section?.isConnected || !$("#context-sheet")?.open) return;
  const choice = session.choices?.[session.index];
  if (!choice || !session.onCheckIn(choice.ride)) return;
  haptic();
  const ride = choice.ride;
  stop();
  $("#context-sheet")?.close();
  toast(ui(via === "shake" ? "checkin_done_shake" : "checkin_done", [String(ride.route ?? ""), choiceLabel(choice)]));
}

// Opens the sheet. onCheckIn(ride) starts the ride and returns true on success.
export function openCheckIn(onCheckIn) {
  stop();
  // Asked inside the tap that opened the sheet, as iOS requires.
  if (motionPermissionState() === "prompt") void requestMotionPermission();
  const stops = checkInStops(nearest().all);
  const sheet = $("#context-sheet");
  sheet.dataset.detent = "fit";
  if (!stops.length) {
    openContextSheet(
      ui("checkin_title"),
      `<section class="checkin"><p class="empty-state" role="status">${esc(ui("checkin_no_stop"))}</p></section>`,
    );
    return;
  }
  const shake = createShakeDetector(),
    volume = createVolumeDoublePress();
  session = {
    stops,
    stopId: stops[0].id,
    choices: [],
    index: 0,
    onCheckIn,
    onMotion(event) {
      const a = event.acceleration,
        g = event.accelerationIncludingGravity,
        sample = Number.isFinite(a?.x) ? { x: a.x, y: a.y, z: a.z } : { x: g?.x, y: g?.y, z: g?.z, gravity: true };
      if (shake(sample, event.timeStamp || performance.now())) checkIn("shake");
    },
    onKey(event) {
      if (volume(event.key, event.timeStamp || performance.now())) {
        event.preventDefault();
        checkIn("volume");
      }
    },
  };
  openContextSheet(
    ui("checkin_title"),
    `<section class="checkin">${stopTabsHTML(stops, stops[0].id)}<div class="checkin-wheel" data-checkin-wheel></div>${gestureHTML()}<button type="button" class="primary-action" data-checkin-confirm>${icon("checkin")}<span>${esc(ui("checkin_button"))}</span></button><p class="source-caption">${esc(ui("checkin_note"))}</p></section>`,
  );
  const section = sheet.querySelector(".checkin");
  session.section = section;
  section.addEventListener("click", (event) => {
    const stopButton = event.target.closest("[data-checkin-stop]");
    if (stopButton) void renderStop(stopButton.dataset.checkinStop);
    if (event.target.closest("[data-checkin-confirm]")) checkIn("tap");
  });
  addEventListener("devicemotion", session.onMotion, { passive: true });
  addEventListener("keydown", session.onKey, true);
  sheet.addEventListener("close", stop, { once: true });
  void renderStop(stops[0].id);
}
