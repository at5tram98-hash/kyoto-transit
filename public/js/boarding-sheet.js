// Boarding confirmation sheet. When movement evidence offers a service, a
// floating (non-modal) sheet rises with the best candidate and alternatives.
// Swiping the sheet up starts guidance; swiping down or "Later" snoozes it.
// Nothing is confirmed without the rider's swipe or explicit button.
import { esc, icon, haptic } from "./vnext-state.js";
import { ui } from "./locale.js";

const CONFIRM_DISTANCE = 96,
  DISMISS_DISTANCE = 80,
  FLING_VELOCITY = 0.6; // px per ms

// Pure gesture decision, shared with tests.
export function swipeOutcome(dy, velocity = 0) {
  if (dy <= -CONFIRM_DISTANCE || (dy < -24 && velocity <= -FLING_VELOCITY))
    return "confirm";
  if (dy >= DISMISS_DISTANCE || (dy > 24 && velocity >= FLING_VELOCITY))
    return "dismiss";
  return "settle";
}

const snoozed = new Map();
export function snoozeBoarding(key, minutes, now = Date.now()) {
  snoozed.set(key, now + minutes * 60000);
}
export function boardingSnoozed(key, now = Date.now()) {
  const until = snoozed.get(key);
  if (!until) return false;
  if (now >= until) {
    snoozed.delete(key);
    return false;
  }
  return true;
}

const reduced = () =>
  document.documentElement.dataset.reduceMotion === "true" ||
  matchMedia("(prefers-reduced-motion: reduce)").matches;

let sheet = null,
  current = null;

function element() {
  if (sheet?.isConnected) return sheet;
  sheet = document.createElement("dialog");
  sheet.id = "boarding-sheet";
  sheet.className = "boarding-sheet";
  sheet.setAttribute("aria-labelledby", "boarding-sheet-title");
  document.body.append(sheet);
  sheet.addEventListener("click", onClick);
  sheet.addEventListener("pointerdown", onPointerDown);
  sheet.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss("later");
  });
  return sheet;
}

function candidateCard(entry, describe) {
  const d = describe(entry.candidate);
  return `<div class="boarding-primary" data-operator="${esc(d.operator)}"${d.line ? ` data-line="${esc(d.line)}"` : ""}><span class="boarding-mode">${icon(d.bus ? "bus" : "train")}</span><div><b>${esc(d.service)}</b><strong>${esc(d.destination)}</strong>${d.departure ? `<small>${esc(d.departure)}</small>` : ""}</div></div>${d.evidence.length ? `<ul class="boarding-evidence">${d.evidence.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
}

function render() {
  const { entries, selected, describe } = current,
    primary = entries[selected],
    others = entries
      .map((entry, i) => ({ entry, i }))
      .filter(({ i }) => i !== selected)
      .slice(0, 2);
  element().innerHTML = `<div class="boarding-grabber" aria-hidden="true"></div>
  <p class="boarding-eyebrow"><span class="boarding-pulse" aria-hidden="true"></span>${esc(ui("boarding_detected"))}</p>
  <h2 id="boarding-sheet-title">${esc(ui("boarding_question"))}</h2>
  ${candidateCard(primary, describe)}
  ${others.length ? `<div class="boarding-alternatives" role="group" aria-label="${esc(ui("boarding_alternatives"))}">${others.map(({ entry, i }) => { const d = describe(entry.candidate); return `<button type="button" data-boarding-pick="${i}"><span>${esc(d.service)}</span><small>${esc(d.destination)}${d.departure ? ` · ${esc(d.departure)}` : ""}</small></button>`; }).join("")}</div>` : ""}
  <div class="boarding-swipe" aria-hidden="true"><span class="boarding-chevron">${icon("chevron-up")}</span><span>${esc(ui("boarding_swipe"))}</span></div>
  <div class="boarding-actions"><button type="button" class="boarding-confirm" data-boarding-confirm>${esc(ui("boarding_start"))}</button><button type="button" class="boarding-secondary" data-boarding-not-riding>${esc(ui("smartlive_not_riding"))}</button><button type="button" class="boarding-secondary" data-boarding-later>${esc(ui("boarding_later"))}</button></div>`;
}

// candidates: [{ candidate, index }] in display order (best first).
export function presentBoarding({ entries, key, describe, onConfirm, onNotRiding }) {
  if (!entries.length || boardingSnoozed(key)) return closeBoarding();
  const same = current?.key === key && sheet?.open;
  current = {
    entries,
    key,
    describe,
    onConfirm,
    onNotRiding,
    selected: same ? Math.min(current.selected, entries.length - 1) : 0,
  };
  render();
  if (!sheet.open) {
    sheet.show();
    sheet.dataset.state = "presenting";
    haptic();
    // Focus for assistive technology without painting a keyboard focus ring.
    sheet
      .querySelector("[data-boarding-confirm]")
      ?.focus({ preventScroll: true, focusVisible: false });
  }
}

export function closeBoarding() {
  if (!sheet?.open) return;
  sheet.dataset.state = "closing";
  const done = () => {
    sheet.close();
    sheet.style.transform = "";
    delete sheet.dataset.state;
  };
  if (reduced()) done();
  else setTimeout(done, 240);
  current = null;
}

function confirm() {
  if (!current) return;
  const { entries, selected, onConfirm } = current,
    index = entries[selected].index;
  if (sheet) sheet.dataset.state = "confirming";
  haptic();
  current = null;
  const done = () => {
    sheet.close();
    sheet.style.transform = "";
    delete sheet.dataset.state;
  };
  // Start guidance immediately; the sheet lifts away on its own.
  onConfirm(index);
  if (reduced()) done();
  else setTimeout(done, 320);
}

function dismiss(reason) {
  if (!current) return;
  const { key, onNotRiding } = current;
  snoozeBoarding(key, reason === "not-riding" ? 10 : 3);
  if (reason === "not-riding") onNotRiding?.();
  closeBoarding();
}

function onClick(event) {
  const b = event.target.closest("button");
  if (!b || !current) return;
  if (b.hasAttribute("data-boarding-confirm")) confirm();
  else if (b.hasAttribute("data-boarding-later")) dismiss("later");
  else if (b.hasAttribute("data-boarding-not-riding")) dismiss("not-riding");
  else if (b.dataset.boardingPick !== undefined) {
    current.selected = Number(b.dataset.boardingPick);
    render();
    if (!reduced())
      sheet
        .querySelector(".boarding-primary")
        ?.animate(
          [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 220, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" },
        );
  }
}

// The sheet follows the finger 1:1 upward and with resistance downward.
function onPointerDown(event) {
  if (!current || event.button > 0 || event.target.closest("button")) return;
  const startY = event.clientY,
    samples = [{ y: startY, t: event.timeStamp }];
  sheet.setPointerCapture(event.pointerId);
  sheet.dataset.dragging = "true";
  const move = (e) => {
    const dy = e.clientY - startY;
    samples.push({ y: e.clientY, t: e.timeStamp });
    if (samples.length > 5) samples.shift();
    sheet.style.transform = `translateY(${dy < 0 ? dy : dy * 0.6}px)`;
    sheet.style.setProperty("--swipe-progress", String(Math.min(1, Math.max(0, -dy / CONFIRM_DISTANCE))));
  };
  const up = (e) => {
    sheet.removeEventListener("pointermove", move);
    sheet.removeEventListener("pointerup", up);
    sheet.removeEventListener("pointercancel", up);
    delete sheet.dataset.dragging;
    const first = samples[0],
      last = samples.at(-1),
      velocity = (last.y - first.y) / Math.max(1, last.t - first.t),
      outcome = swipeOutcome(e.clientY - startY, velocity);
    sheet.style.removeProperty("--swipe-progress");
    if (outcome === "confirm") confirm();
    else if (outcome === "dismiss") dismiss("later");
    else sheet.style.transform = "";
  };
  sheet.addEventListener("pointermove", move);
  sheet.addEventListener("pointerup", up);
  sheet.addEventListener("pointercancel", up);
}
