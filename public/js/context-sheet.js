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
    `<p class="sheet-intro">列車・バスの終点とは別に、あなたの降車地点を選べます。</p><label class="sheet-field">降車地点<select id="personal-stop">${stops.map((s) => `<option value="${esc(s.id)}" ${s.id === (state.ride?.userDestination?.id ?? state.ride?.to) ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label><button class="primary-action" data-save-destination>ここで降ります</button><label class="setting-row"><span>1つ前の駅・停留所で知らせる</span><input type="checkbox" data-alight-setting ${settings.alightAssist !== false ? "checked" : ""}></label><label class="setting-row"><span>許可済みのシステム通知を使う</span><input type="checkbox" data-notification-setting ${settings.notifications ? "checked" : ""}></label><button class="secondary-action" data-enable-notification>通知を設定</button><p class="source-note">画面内の案内は常に表示します。システム通知は対応端末で許可した場合に利用できます。</p>`,
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
  return `<dl class="context-facts"><div><dt>到着予定</dt><dd>${Number.isFinite(time) ? formatMinute(time) : "時刻未取得"}</dd></div><div><dt>到着見込み（推定）</dt><dd>${Number.isFinite(time) ? formatMinute(Math.round(time + state.rideShift)) : "未確認"}</dd></div><div><dt>接続路線</dt><dd>${esc(n?.lines?.join("・") ?? "未確認")}</dd></div></dl><button class="primary-action" data-choose-destination="${esc(id)}" ${canChoose ? "" : "disabled"}>${canChoose ? "ここで降ります" : "通過した地点です"}</button><button class="secondary-action" data-open-timetable="${esc(id)}">時刻表を見る</button>${!bus ? '<button class="secondary-action" data-context-foldback>この先の折り返しを探す</button>' : ""}`;
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
  document.querySelectorAll(".sheet").forEach((sheet) => {
    if (sheet.dataset.gestureReady) return;
    sheet.dataset.gestureReady = "true";
    const handle = sheet.querySelector(".sheet-drag-handle"),
      body = sheet.querySelector(".sheet-body");
    let drag = null;
    function start(e, fromBody = false) {
      if (e.pointerType === "touch" && fromBody) return;
      if (
        e.button > 0 ||
        (fromBody &&
          (body.scrollTop > 0 || e.target.closest("button,input,select,a")))
      )
        return;
      sheet.getAnimations().forEach((a) => a.cancel());
      drag = {
        y: e.clientY,
        x: e.clientX,
        lastY: e.clientY,
        lastAt: performance.now(),
        dy: 0,
        velocity: 0,
        fromBody,
        started: !fromBody,
      };
      if (!fromBody) e.currentTarget.setPointerCapture(e.pointerId);
    }
    function move(e) {
      if (!drag) return;
      const dy = e.clientY - drag.y,
        dx = e.clientX - drag.x;
      if (!drag.started) {
        if (dy < 0 || Math.abs(dx) > Math.abs(dy)) {
          drag = null;
          return;
        }
        if (dy < 8) return;
        drag.started = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      const now = performance.now();
      drag.velocity = (e.clientY - drag.lastY) / Math.max(1, now - drag.lastAt);
      drag.lastY = e.clientY;
      drag.lastAt = now;
      drag.dy = Math.max(0, dy);
      sheet.style.transform = `translateY(${drag.dy}px)`;
      sheet.style.setProperty(
        "--sheet-backdrop",
        String(0.32 * (1 - Math.min(1, drag.dy / sheet.offsetHeight))),
      );
    }
    function finish(cancel = false) {
      if (!drag) return;
      const value = drag;
      drag = null;
      if (value.started)
        settleSheet(sheet, value.dy, {
          dismiss:
            !cancel &&
            (value.dy > sheet.offsetHeight * 0.3 ||
              (value.dy > 30 && value.velocity > 0.5)),
        });
    }
    for (const target of [handle, body].filter(Boolean)) {
      target.addEventListener("pointerdown", (e) => start(e, target === body));
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", () => finish());
      target.addEventListener("pointercancel", () => finish(true));
    }
    if (body) {
      body.addEventListener(
        "touchstart",
        (e) => {
          if (body.scrollTop > 0 || e.target.closest("button,input,select,a"))
            return;
          const t = e.touches[0];
          drag = {
            y: t.clientY,
            x: t.clientX,
            lastY: t.clientY,
            lastAt: performance.now(),
            dy: 0,
            velocity: 0,
            started: false,
            fromBody: true,
          };
        },
        { passive: true },
      );
      body.addEventListener(
        "touchmove",
        (e) => {
          if (!drag) return;
          const t = e.touches[0],
            dy = t.clientY - drag.y,
            dx = t.clientX - drag.x;
          if (dy < 0 || Math.abs(dx) > Math.abs(dy) || body.scrollTop > 0) {
            drag = null;
            return;
          }
          if (dy < 8 && !drag.started) return;
          if (e.cancelable) e.preventDefault();
          drag.started = true;
          const now = performance.now();
          drag.velocity =
            (t.clientY - drag.lastY) / Math.max(1, now - drag.lastAt);
          drag.lastY = t.clientY;
          drag.lastAt = now;
          drag.dy = dy;
          sheet.style.transform = `translateY(${dy}px)`;
          sheet.style.setProperty(
            "--sheet-backdrop",
            String(0.32 * (1 - Math.min(1, dy / sheet.offsetHeight))),
          );
        },
        { passive: false },
      );
      body.addEventListener("touchend", () => finish());
      body.addEventListener("touchcancel", () => finish(true));
    }
    sheet.addEventListener("close", () => {
      drag = null;
      sheet.style.transform = "";
      sheet.style.removeProperty("--sheet-backdrop");
    });
  });
}
