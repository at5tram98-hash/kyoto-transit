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
export function stationSheet(id) {
  const stop = (
    state.ride?.fullOfficialStops ?? state.ride?.officialStops
  )?.find((s) => s.id === id);
  if (!stop) return;
  const bus = ["citybus", "kyotobus"].includes(state.ride.operator),
    time = stopTime(stop),
    n = state.network.stops.get(id);
  const activeIndex = state.ride.officialStops.findIndex((s) => s.id === id);
  const canChoose = activeIndex >= (state.heroModel?.index ?? 0);
  openContextSheet(
    stop.name,
    `<dl class="context-facts"><div><dt>到着予定</dt><dd>${Number.isFinite(time) ? formatMinute(time) : "時刻未取得"}</dd></div><div><dt>到着見込み（推定）</dt><dd>${Number.isFinite(time) ? formatMinute(Math.round(time + state.rideShift)) : "未確認"}</dd></div><div><dt>接続路線</dt><dd>${esc(n?.lines?.join("・") ?? "未確認")}</dd></div></dl><button class="primary-action" data-choose-destination="${esc(id)}" ${canChoose ? "" : "disabled"}>${canChoose ? "ここで降ります" : "通過した地点です"}</button><button class="secondary-action" data-open-timetable="${esc(id)}">時刻表を見る</button>${!bus ? '<button class="secondary-action" data-context-foldback>この先の折り返しを探す</button>' : ""}`,
  );
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
  // Only the handle captures a drag; scrolling sheet contents stays native.
  document.querySelectorAll(".sheet").forEach((sheet) => {
    const handle = sheet.querySelector(".sheet-drag-handle");
    if (!handle) return;
    let start = null,
      offset = 0;
    handle.addEventListener("pointerdown", (e) => {
      start = e.clientY;
      offset = 0;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (start === null) return;
      offset = Math.max(0, e.clientY - start);
      sheet.style.translate = `0 ${offset}px`;
    });
    const finish = () => {
      if (start === null) return;
      start = null;
      sheet.style.translate = "";
      if (offset > 90) sheet.close();
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", () => {
      start = null;
      sheet.style.translate = "";
    });
  });
}
