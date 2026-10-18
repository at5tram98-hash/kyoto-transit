import { ui } from "./locale.js";
import { settleSheet } from "./navigation-motion.js";
import {
  $,
  esc,
  state,
  settings,
  saveSettings,
  persistJourney,
} from "./vnext-state.js";
import { formatMinute } from "./vnext-core.js";
import { stopTime } from "./journey-core.js";
import { selectedAlightingStop } from "./ride-destination.js";

let opener = null;
export function openContextSheet(title, body) {
  const dialog = $("#context-sheet");
  if (!dialog.open) opener = document.activeElement;
  $("#context-sheet-title").textContent = title;
  $("#context-sheet-body").innerHTML = body;
  dialog.classList.toggle(
    "map-full-screen",
    Boolean(dialog.querySelector(".route-map.expanded")),
  );
  if (!dialog.open) dialog.showModal();
  $("#context-sheet-body").scrollTop = 0;
}
export function destinationSheet(bus = false) {
  const stops = state.ride?.officialStops ?? [];
  const selected = selectedAlightingStop(state.ride, stops)?.id ?? "";
  openContextSheet(
    bus ? ui("context_sheet_001") : ui("context_sheet_002"),
    ui("context_sheet_003", [
      `<option value="" disabled ${selected ? "" : "selected"}>${ui("alighting_choose")}</option>` +
        stops
          .map(
            (s) =>
              `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`,
          )
          .join(""),
      settings.alightAssist !== false ? "checked" : "",
      settings.notifications ? "checked" : "",
    ]),
  );
  const save = $("#context-sheet [data-save-destination]");
  if (save) save.disabled = !selected;
}
export function stationDetailHTML(id) {
  const stop = (
    state.ride?.fullOfficialStops ?? state.ride?.officialStops
  )?.find((s) => s.id === id);
  if (!stop) return ui("context_sheet_004");
  const bus = ["citybus", "kyotobus"].includes(state.ride.operator),
    time = stopTime(stop),
    n = state.network.stops.get(id);
  const activeIndex = state.ride.officialStops.findIndex((s) => s.id === id);
  const canChoose = activeIndex >= (state.heroModel?.index ?? 0);
  return ui("context_sheet_015", [
    bus
      ? '<section class="bus-stop-preview" data-bus-stop-preview></section>'
      : "",
    Number.isFinite(time) ? formatMinute(time) : ui("context_sheet_005"),
    Number.isFinite(time)
      ? formatMinute(Math.round(time + state.rideShift))
      : ui("context_sheet_006"),
    esc(n?.lines?.join("・") ?? ui("context_sheet_007")),
    esc(id),
    canChoose ? "" : "disabled",
    canChoose ? ui("context_sheet_008") : ui("context_sheet_009"),
    esc(id),
    !bus ? ui("context_sheet_010") : "",
  ]);
}
export function setupContextSheet(onChange, onFoldback) {
  const dialog = $("#context-sheet");
  dialog.addEventListener("close", () => {
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  dialog.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-context-close")) dialog.close();
    else if (b.hasAttribute("data-context-foldback")) {
      dialog.close();
      onFoldback();
    } else if (
      b.hasAttribute("data-save-destination") ||
      b.dataset.chooseDestination
    ) {
      const id = b.dataset.chooseDestination ?? $("#personal-stop")?.value,
        s = state.ride?.officialStops?.find((s) => s.id === id);
      if (s) {
        state.ride.userDestination = { id: s.id, name: s.name };
        persistJourney(true);
        dialog.close();
        onChange();
      }
    } else if (b.hasAttribute("data-enable-notification")) {
      if (!("Notification" in window)) {
        b.textContent = ui("context_sheet_011");
        return;
      }
      try {
        const permission = await Notification.requestPermission();
        settings.notifications = permission === "granted";
        saveSettings();
        b.textContent = settings.notifications
          ? ui("context_sheet_012")
          : ui("context_sheet_013");
      } catch {
        b.textContent = ui("context_sheet_014");
      }
    } else if (b.dataset.openTimetable) dialog.close();
  });
  dialog.addEventListener("change", (e) => {
    if (e.target.id === "personal-stop") {
      const save = dialog.querySelector("[data-save-destination]");
      if (save) save.disabled = !e.target.value;
    }
    if (e.target.hasAttribute("data-alight-setting")) {
      settings.alightAssist = e.target.checked;
      saveSettings();
    }
    if (e.target.hasAttribute("data-notification-setting")) {
      settings.notifications = e.target.checked;
      saveSettings();
    }
  });
  setupSheetGestures();
}
export function setupSheetGestures() {
  document.querySelectorAll(".sheet,.place-sheet").forEach((sheet) => {
    if (sheet.dataset.gestureReady) return;
    sheet.dataset.gestureReady = "true";
    const handle = sheet.querySelector(".sheet-drag-handle"),
      body = sheet.querySelector(".sheet-body");
    if (!handle || !body) return;
    let drag = null,
      suppressClick = false;
    const heights = () => {
      const height = globalThis.visualViewport?.height ?? innerHeight;
      return {
        medium: Math.min(height * 0.58, 560),
        large: Math.min(height * 0.9, 900),
      };
    };
    function start(point, fromBody) {
      if (
        fromBody &&
        (body.scrollTop > 0 || point.target?.closest("button,input,select,a"))
      )
        return;
      drag = {
        x: point.clientX,
        y: point.clientY,
        lastY: point.clientY,
        lastAt: performance.now(),
        dy: 0,
        velocity: 0,
        fromBody,
        started: !fromBody,
        height: sheet.getBoundingClientRect().height,
      };
    }
    function move(point, event) {
      if (!drag) return;
      const dy = point.clientY - drag.y,
        dx = point.clientX - drag.x;
      if (!drag.started) {
        if (dy < 0 || Math.abs(dx) > Math.abs(dy) || body.scrollTop > 0) {
          drag = null;
          return;
        }
        if (dy < 8) return;
        drag.started = true;
      }
      if (event?.cancelable) event.preventDefault();
      const now = performance.now();
      drag.velocity =
        (point.clientY - drag.lastY) / Math.max(1, now - drag.lastAt);
      drag.lastY = point.clientY;
      drag.lastAt = now;
      drag.dy = dy;
      let translate = Math.max(0, dy);
      if (sheet.dataset.detent && sheet.dataset.detent !== "fit") {
        const h = heights(),
          size = Math.min(h.large, Math.max(h.medium, drag.height - dy));
        sheet.style.height = `${size}px`;
        translate = Math.max(0, dy - Math.max(0, drag.height - h.medium));
      }
      sheet.style.transform = `translateY(${translate}px)`;
      sheet.style.setProperty(
        "--sheet-backdrop",
        String(0.32 * (1 - Math.min(1, translate / sheet.offsetHeight))),
      );
    }
    function finish(cancel = false) {
      if (!drag) return;
      const value = drag;
      drag = null;
      suppressClick = Math.abs(value.dy) > 8;
      if (!value.started) return;
      const translation = Number(
        sheet.style.transform.match(/translateY\(([-.0-9]+)px\)/)?.[1] ?? 0,
      );
      let detent = sheet.dataset.detent;
      const dismiss =
        !cancel &&
        (translation > sheet.offsetHeight * 0.3 ||
          (translation > 30 && value.velocity > 0.5));
      if (detent && detent !== "fit" && !cancel && !dismiss) {
        const mid = (heights().large + heights().medium) / 2;
        detent =
          value.velocity < -0.45 || value.dy < -55
            ? "large"
            : value.velocity > 0.45 || value.dy > 55
              ? "medium"
              : sheet.offsetHeight > mid
                ? "large"
                : "medium";
      }
      void settleSheet(sheet, translation, { dismiss, detent });
    }
    handle.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      start(e, false);
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => move(e, e));
    handle.addEventListener("pointerup", () => finish());
    handle.addEventListener("pointercancel", () => finish(true));
    handle.addEventListener("click", () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (sheet.dataset.detent && sheet.dataset.detent !== "fit")
        void settleSheet(sheet, 0, {
          detent: sheet.dataset.detent === "medium" ? "large" : "medium",
        });
    });
    body.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" && e.button === 0) start(e, true);
    });
    body.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "touch") move(e, e);
    });
    body.addEventListener("pointerup", () => finish());
    body.addEventListener("pointercancel", () => finish(true));
    body.addEventListener(
      "touchstart",
      (e) =>
        start(
          {
            ...e.touches[0],
            clientX: e.touches[0].clientX,
            clientY: e.touches[0].clientY,
            target: e.target,
          },
          true,
        ),
      { passive: true },
    );
    body.addEventListener("touchmove", (e) => move(e.touches[0], e), {
      passive: false,
    });
    body.addEventListener("touchend", () => finish());
    body.addEventListener("touchcancel", () => finish(true));
    sheet.addEventListener("close", () => {
      sheet.getAnimations().forEach((animation) => animation.cancel());
      drag = null;
      sheet.style.transform = "";
      sheet.style.height = "";
      sheet.style.removeProperty("--sheet-backdrop");
    });
  });
}
