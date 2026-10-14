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
  openContextSheet(
    bus ? "降車停留所と通知" : "降車駅と通知",
    `<p class="sheet-intro">列車・バスの終点とは別に、あなたの降車地点を選べます。</p><label class="sheet-field">降車地点<select id="personal-stop">${stops.map((s) => `<option value="${esc(s.id)}" ${s.id === (state.ride?.userDestination?.id ?? state.ride?.to) ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label><div class="screen-action-group"><button class="primary-action" data-save-destination>ここで降ります</button></div><label class="setting-row"><span>1つ前の駅・停留所で知らせる</span><input type="checkbox" data-alight-setting ${settings.alightAssist !== false ? "checked" : ""}></label><label class="setting-row"><span>許可済みのシステム通知を使う</span><input type="checkbox" data-notification-setting ${settings.notifications ? "checked" : ""}></label><div class="screen-action-group"><button class="secondary-action" data-enable-notification>通知を設定</button></div><p class="source-note">画面内の案内は常に表示します。システム通知は対応端末で許可した場合に利用できます。</p>`,
  );
}
export function stationDetailHTML(id) {
  const stop = (
    state.ride?.fullOfficialStops ?? state.ride?.officialStops
  )?.find((s) => s.id === id);
  if (!stop) return '<p class="empty-state">この乗車案内は終了しました。</p>';
  const bus = ["citybus", "kyotobus"].includes(state.ride.operator),
    time = stopTime(stop),
    n = state.network.stops.get(id);
  const activeIndex = state.ride.officialStops.findIndex((s) => s.id === id);
  const canChoose = activeIndex >= (state.heroModel?.index ?? 0);
  return `${bus ? '<section class="bus-stop-preview" data-bus-stop-preview></section>' : ""}<dl class="context-facts"><div><dt>到着予定</dt><dd>${Number.isFinite(time) ? formatMinute(time) : "時刻未取得"}</dd></div><div><dt>到着見込み（推定）</dt><dd>${Number.isFinite(time) ? formatMinute(Math.round(time + state.rideShift)) : "未確認"}</dd></div><div><dt>接続路線</dt><dd>${esc(n?.lines?.join("・") ?? "未確認")}</dd></div></dl><div class="screen-action-group"><button class="primary-action" data-choose-destination="${esc(id)}" ${canChoose ? "" : "disabled"}>${canChoose ? "ここで降ります" : "通過した地点です"}</button><button class="secondary-action" data-open-timetable="${esc(id)}">時刻表を見る</button>${!bus ? '<button class="secondary-action" data-context-foldback>この先の折り返しを探す</button>' : ""}</div>`;
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
        b.textContent = "この端末では画面内でお知らせします";
        return;
      }
      try {
        const permission = await Notification.requestPermission();
        settings.notifications = permission === "granted";
        saveSettings();
        b.textContent = settings.notifications
          ? "通知を有効にしました"
          : "画面内でお知らせします";
      } catch {
        b.textContent = "画面内でお知らせします";
      }
    } else if (b.dataset.openTimetable) dialog.close();
  });
  dialog.addEventListener("change", (e) => {
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
      if (sheet.dataset.detent) {
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
      if (detent && !cancel && !dismiss) {
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
      if (sheet.dataset.detent)
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
