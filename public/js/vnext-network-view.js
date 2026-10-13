import { navigation } from "./navigation.js";
import { journeyProgress } from "./journey-core.js";
import { subwayIds, kintetsuIds } from "./network.js";
import {
  projectSubwayTrains,
  CITY_ROUTES,
  KYOTO_ROUTES,
} from "./vnext-core.js";
import {
  $,
  esc,
  icon,
  state,
  settings,
  saveSettings,
  tokyoNow,
  rideKey,
  ensureRailFeed,
  ensureSubwayFeed,
} from "./vnext-state.js";
import { realtimeLog, ARRIVAL_INTERVAL, isFresh } from "./realtime.js";
import { updateHTML } from "./view-rendering.js";
const panelVersions = new WeakMap();

const dot = (source) =>
  `<i class="source-dot ${source === "live" ? "live" : "prediction"}" aria-hidden="true"></i>`;
export async function renderNetworkPanel(panel, ride, now) {
  const token = rideKey(ride),
    version = (panelVersions.get(panel) ?? 0) + 1;
  panelVersions.set(panel, version);
  if (panel.dataset.token !== token || !panel.querySelector("#network-live")) {
    panel.dataset.token = token;
    updateHTML(
      panel,
      `<section class="section-block"><div class="section-heading"><div><span class="section-label">走行位置</span><h3>同じ路線の列車</h3></div><button class="round-action" id="network-refresh" aria-label="更新">${icon("refresh")}</button></div><div id="network-live"><p class="loading-line">更新中…</p></div></section>`,
    );
  }
  if (["kintetsu", "through"].includes(ride.operator)) await ensureRailFeed();
  else if (ride.operator === "subway") await ensureSubwayFeed();
  if (
    panel.dataset.token !== token ||
    panelVersions.get(panel) !== version ||
    panel.closest("[hidden]")
  )
    return;
  const container = panel.querySelector("#network-live");
  if (!container) return;
  let trains = [];
  if (["kintetsu", "through"].includes(ride.operator) && state.railFeed) {
    const feed = state.railFeed,
      measured =
        !feed.stale &&
        feed.source !== "prediction" &&
        isFresh(feed.asOf ?? feed.sourceUpdatedAt ?? feed.capturedAt);
    trains = (feed.trains ?? [])
      .filter((t) => ["local", "express", "other"].includes(t.category))
      .slice(0, 30)
      .map((t) => ({ ...t, estimated: !measured || t.predicted }));
  } else if (ride.operator === "subway" && state.subwayFeed?.services?.length)
    trains = projectSubwayTrains({
      feed: state.subwayFeed,
      nowMinute: now.minute,
      network: state.network,
    });

  const rideDirection =
      ride.direction ??
      (() => {
        const ids = ride.operator === "subway" ? subwayIds : kintetsuIds,
          a = ids.indexOf(ride.from),
          b = ids.indexOf(ride.to);
        return b > a ? "south" : "north";
      })(),
    opposite = trains.filter((t) => t.direction !== rideDirection).slice(0, 8),
    same = trains.filter((t) => t.direction === rideDirection).slice(0, 8);
  if (!container.querySelector(".live-track"))
    updateHTML(
      container,
      '<div class="live-track" role="img"><div class="live-track-axis"></div><div class="live-track-opposite"></div><span class="live-track-self">この列車</span><div class="live-track-vehicles"></div></div><p class="source-note live-track-source"></p><details class="live-track-detail"><summary>前方・反対方向の列車</summary><div class="live-track-rows"></div></details>',
    );
  updateTrainTrack(container, ride, trains, now);
  updateHTML(
    container.querySelector(".live-track-rows"),
    `<div class="train-group"><span>進行方向</span>${trainRows(same)}</div><div class="train-group"><span>反対方向</span>${trainRows(opposite)}</div>`,
  );
}
function trainRows(trains) {
  if (!trains.length)
    return '<p class="fine-empty">表示中の列車はありません</p>';
  return `<div class="train-rows">${trains.map((t) => `<div class="train-row"><span class="train-arrow">${t.direction === "north" ? "←" : "→"}</span><div><b>${dot(t.estimated ? "prediction" : "live")}${esc(t.label ?? (t.category === "express" ? "急行" : "普通"))}</b><small>${esc(state.network.stops.get(t.from)?.name ?? t.from)} ${t.atStation ? "停車中" : "〜"} ${esc(state.network.stops.get(t.to)?.name ?? t.to)}</small></div><span class="delay ${t.delay ? "late" : ""}">${t.delay === null ? "—" : t.delay ? `+${t.delay}分` : "定刻"}</span></div>`).join("")}</div>`;
}
function updateTrainTrack(container, ride, trains, now) {
  const through = [...subwayIds, ...kintetsuIds.slice(5)],
    axis =
      ride.operator === "subway"
        ? subwayIds
        : ride.operator === "through"
          ? through
          : kintetsuIds;
  const progress = journeyProgress(ride, {
    minute: now.minute,
    shift: state.rideShift,
    fix: state.fix,
    geo: state.geo,
    trail: state.busTrail,
  });
  const first = axis.indexOf(progress.stops[0]?.id),
    last = axis.indexOf(progress.stops.at(-1)?.id);
  const own = first + (last - first) * progress.fraction,
    reverse = last < first;
  const track = container.querySelector(".live-track"),
    self = container.querySelector(".live-track-self"),
    vehicles = container.querySelector(".live-track-vehicles");
  self.style.left = `${Math.max(3, Math.min(97, (own / Math.max(1, axis.length - 1)) * 100))}%`;
  const activeLine = state.heroModel?.lineId ?? "K";
  track.dataset.line = activeLine;
  const rows = trains
    .map((t, i) => ({
      ...t,
      key: t.key ?? `${t.direction}:${t.from}:${t.to}:${i}`,
      position: (axis.indexOf(t.from) + axis.indexOf(t.to)) / 2,
    }))
    .filter((t) => t.position >= 0);
  const candidates = rows
    .filter(
      (t) =>
        t.direction === (ride.direction ?? (reverse ? "north" : "south")) &&
        (reverse ? t.position < own : t.position > own),
    )
    .sort((a, b) => Math.abs(a.position - own) - Math.abs(b.position - own));
  const ahead = candidates[0]?.key,
    old = new Map([...vehicles.children].map((e) => [e.dataset.key, e]));
  for (const t of rows.slice(0, 16)) {
    let el = old.get(t.key);
    if (!el) {
      el = document.createElement("span");
      el.dataset.key = t.key;
      vehicles.append(el);
    }
    const opposite =
      t.direction !== (ride.direction ?? (reverse ? "north" : "south"));
    el.className = `track-vehicle ${opposite ? "opposite" : ""} ${t.key === ahead ? "ahead" : ""}`;
    el.textContent =
      t.key === ahead ? "前列車" : opposite ? "反対方向" : "列車";
    el.style.left = `${Math.max(3, Math.min(97, (t.position / Math.max(1, axis.length - 1)) * 100))}%`;
    el.setAttribute(
      "aria-label",
      `${opposite ? "反対方向" : t.key === ahead ? "前列車" : "同方向"} ${t.label ?? "普通"} ${t.estimated ? "推定位置" : "取得位置"}`,
    );
    old.delete(t.key);
  }
  old.forEach((e) => e.remove());
  track.setAttribute(
    "aria-label",
    `自列車と前列車・反対方向列車を同じ路線で表示。自列車は${progress.source === "location" ? "GPSを参照" : "時刻表から推定"}。`,
  );
  updateHTML(
    container.querySelector(".live-track-source"),
    `自列車：${progress.source === "location" ? "現在地を参照" : "時刻表から推定"} · ${trains.length ? "前列車・反対方向も下の一覧で確認できます" : "他列車の実測位置は未取得です"}`,
  );
}
export async function refreshNetwork() {
  if (!state.ride) return;
  const panel = $("#network-panel");
  if (["kintetsu", "through"].includes(state.ride.operator))
    await ensureRailFeed(true);
  else if (state.ride.operator === "subway") await ensureSubwayFeed(true);
  renderNetworkPanel(panel, state.ride, tokyoNow());
}

function logHTML() {
  const rows = realtimeLog();
  return `<div class="debug-live" ${settings.debugLive ? "" : "hidden"}><div><b>更新間隔</b><span>${ARRIVAL_INTERVAL / 1000}秒</span></div>${rows.map((r) => `<div><b>${esc(r.key)}</b><span>${esc(r.source ?? "—")} · ${r.freshness ? new Date(r.freshness).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}${r.error ? ` · ${esc(r.error)}` : ""}</span></div>`).join("") || "<div><b>ログ</b><span>まだありません</span></div>"}</div>`;
}
const subwayOptions = () =>
  subwayIds
    .map(
      (id) =>
        `<option value="${id}">${esc(state.network?.stops.get(id)?.name ?? id)}</option>`,
    )
    .join("");
export function renderSettings(
  root = $("#settings-content"),
  category = "home",
) {
  root.innerHTML = `<section class="settings-section"><h2>自動案内</h2><div class="settings-card"><label class="setting-row"><span><b>自動乗車判定</b><small>移動に合わせて表示を切り替えます</small></span><input type="checkbox" data-setting="autoDetect" ${settings.autoDetect ? "checked" : ""}></label><label class="setting-row"><span><b>触覚フィードバック</b><small>便を判定したときに短く通知</small></span><input type="checkbox" data-setting="haptics" ${settings.haptics ? "checked" : ""}></label><label class="setting-row"><span><b>判定根拠を表示</b><small>必要なときだけ詳細を表示</small></span><input type="checkbox" data-setting="showConfidence" ${settings.showConfidence ? "checked" : ""}></label></div></section><section class="settings-section"><h2>定期券</h2><div class="settings-card"><label class="setting-row"><span><b>市バス</b><small>対象区間の追加額を0円として計算</small></span><input type="checkbox" data-setting="passCityBus" ${settings.passCityBus ? "checked" : ""}></label><label class="setting-row"><span><b>京都バス</b><small>登録した対象区間だけに適用</small></span><input type="checkbox" data-setting="passKyotoBus" ${settings.passKyotoBus ? "checked" : ""}></label><label class="setting-row"><span><b>地下鉄</b><small>設定区間内の追加額を0円として計算</small></span><input type="checkbox" data-setting="passSubway" ${settings.passSubway ? "checked" : ""}></label><div class="pass-range"><label>区間の開始<select data-setting-value="passSubwayFrom">${subwayOptions()}</select></label><span>〜</span><label>区間の終了<select data-setting-value="passSubwayTo">${subwayOptions()}</select></label></div><label class="pass-expiry">有効期限<input type="date" data-setting-value="passExpires" value="${esc(settings.passExpires ?? "")}"></label><p class="source-caption">未設定では通常運賃＝追加額です。実際の券面区間を優先してください。</p></div></section><section class="settings-section"><h2>近くの駅</h2><div class="settings-card slider-card"><label><span><b>地下鉄を表示する距離</b><small>候補に表示する範囲</small></span><strong>${settings.railGuideDistance}m</strong><input type="range" min="150" max="600" step="50" value="${settings.railGuideDistance}" data-setting-range="railGuideDistance"></label></div></section><section class="settings-section"><h2>対応路線</h2><div class="settings-card source-list"><div><b>地下鉄烏丸線</b><small>全線・近鉄直通</small></div><div><b>近鉄京都線</b><small>全線・烏丸線直通</small></div><div><b>京都バス</b><small>${KYOTO_ROUTES.join("・")}</small></div><div><b>京都市バス</b><small>${CITY_ROUTES.join("・")}・202八条口</small></div></div></section><section class="settings-section info-section"><h2 data-info-title>情報</h2><div class="settings-card source-list"><div><b>出典</b><small>京都市交通局・近畿日本鉄道・京都バス・公共交通オープンデータセンター</small></div><div><b>運賃確認</b><small>公式運賃表を基準にし、未確認区間は確定額を表示しません</small></div><div><b>オープンデータ</b><small>公共交通オープンデータ基本ライセンスに基づき利用しています</small></div><div><b>現在地</b><small>位置情報は端末上で乗車判定に使用します</small></div></div>${logHTML()}</section>`;
  const from = root.querySelector('[data-setting-value="passSubwayFrom"]'),
    to = root.querySelector('[data-setting-value="passSubwayTo"]');
  if (from) from.value = settings.passSubwayFrom ?? "K01";
  if (to) to.value = settings.passSubwayTo ?? "K11";
  const sections = [...root.querySelectorAll(":scope>.settings-section")];
  const categories = {
    pass: [1, "定期券"],
    distance: [2, "近くの駅"],
    routes: [3, "対応路線"],
    info: [4, "情報・出典"],
  };
  if (category === "home") {
    root.replaceChildren(sections[0]);
    const rows = document.createElement("div");
    rows.className = "native-list";
    rows.innerHTML = Object.entries(categories)
      .map(
        ([id, [, title]]) =>
          `<button class="native-row" data-setting-page="${id}"><span><b>${title}</b></span><span class="chevron">›</span></button>`,
      )
      .join("");
    root.append(rows);
  } else root.replaceChildren(sections[categories[category]?.[0] ?? 4]);
}
export function setupSettings(onRender) {
  let infoTaps = 0,
    lastTap = 0;
  function bind(root, category = "home") {
    root.addEventListener("change", (e) => {
      if (e.target.dataset.setting) {
        settings[e.target.dataset.setting] = e.target.checked;
        saveSettings();
        onRender();
      }
      if (e.target.dataset.settingRange) {
        settings[e.target.dataset.settingRange] = Number(e.target.value);
        saveSettings();
        renderSettings(root, category);
        onRender();
      }
      if (e.target.dataset.settingValue) {
        settings[e.target.dataset.settingValue] = e.target.value;
        saveSettings();
        onRender();
      }
    });
    root.addEventListener("input", (e) => {
      if (e.target.dataset.settingRange) {
        settings[e.target.dataset.settingRange] = Number(e.target.value);
        e.target.closest("label").querySelector("strong").textContent =
          `${settings[e.target.dataset.settingRange]}m`;
      }
    });
    root.addEventListener("click", (e) => {
      const row = e.target.closest("[data-setting-page]");
      if (row) {
        navigation.push("setting", { id: row.dataset.settingPage });
        return;
      }
      if (!e.target.closest("[data-info-title]")) return;
      const now = Date.now();
      infoTaps = now - lastTap < 1200 ? infoTaps + 1 : 1;
      lastTap = now;
      if (infoTaps >= 7) {
        settings.debugLive = !settings.debugLive;
        saveSettings();
        infoTaps = 0;
        renderSettings(root, category);
      }
    });
  }
  bind($("#settings-content"));
  navigation.register("setting", {
    title: (r) =>
      ({
        pass: "定期券",
        distance: "近くの駅",
        routes: "対応路線",
        info: "情報・出典",
      })[r.params.id] ?? "詳細設定",
    create({ element, route }) {
      bind(element, route.params.id);
    },
    onShow({ element, route }) {
      renderSettings(element, route.params.id);
    },
  });
  window.addEventListener("mymap-realtime-log", () => {
    if (state.tab === "settings" && settings.debugLive) renderSettings();
  });
}
