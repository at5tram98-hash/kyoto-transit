import { openContextSheet } from "./context-sheet.js";
import {
  readSavedPlaces,
  toggleSavedPlace,
  quickPlaceSymbol,
  QUICK_SYMBOLS,
} from "./saved-places.js";
import { readSearchPairs, removeSearchPair } from "./search-history.js";
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
  nearest,
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
function distancePreview() {
  if (
    !state.fix ||
    !["active", "rail", "nearby"].includes(state.locationStatus)
  )
    return "現在地を取得すると、設定範囲内の地下鉄駅数を確認できます。";
  const entries = nearest().all,
    count = entries.filter(
      (s) => s.stop.type === "subway" && s.meters <= settings.railGuideDistance,
    ).length;
  if (!entries.length)
    return "最新の現在地を取得すると、設定範囲内の地下鉄駅数を確認できます。";
  return `現在地から${settings.railGuideDistance}m以内に地下鉄${count}駅。停留所の表示範囲は別に保持します。`;
}
export function renderSettings(
  root = $("#settings-content"),
  category = "home",
) {
  if (category === "home") {
    const row = (id, title) =>
      `<button class="native-row" data-setting-page="${id}"><span>${title}</span><span class="chevron">›</span></button>`;
    root.innerHTML = `<h2 class="native-section-label">保存</h2><div class="native-list"><button class="native-row" data-saved-page="places"><span>保存した場所</span><span class="chevron">›</span></button><button class="native-row" data-saved-page="routes"><span>保存した経路</span><span class="chevron">›</span></button></div><h2 class="native-section-label">交通</h2><div class="native-list">${row("pass", "定期券")}${row("distance", "近くの駅")}${row("notifications", "通知")}${row("auto", "自動乗車判定")}${row("location", "位置情報")}</div><h2 class="native-section-label">アプリ</h2><div class="native-list">${row("display", "表示")}${row("routes", "対応路線")}${row("info", "情報・出典")}${row("privacy", "Privacy・データの取扱い")}${row("terms", "利用条件")}${row("advanced", "詳細設定")}</div><h2 class="native-section-label">状態</h2><div class="native-list">${row("permissions", "位置情報・マイク・通知")}</div>`;
    return;
  }
  if (category === "privacy") {
    root.innerHTML = `<div class="settings-card source-list"><div><b>位置情報</b><small>表示中に取得し、交通機関の判定・次駅・付近の交通に端末上で利用します。GPS履歴をサーバーへ保存しません。接近検索では選んだ停留所名を交通情報APIへ送ります。</small></div><div><b>アナウンス補助</b><small>許可済みのマイクだけを、乗車候補があるときに最長6秒使います。常時録音せず、音声・文字起こしをMyMapのサーバーや保存領域へ保存しません。端末・ブラウザーの音声認識サービスが音声を処理する場合があります。補助をOFFにしても手動乗車・時刻表は使えます。</small></div><div><b>保存する情報</b><small>検索履歴・保存地点・定期券・表示設定はこの端末のLocal Storage、画面状態はSession Storageに保存します。案内中の旅程は再起動復元のため最大4時間保持します。</small></div><div><b>ネットワーク</b><small>公式時刻表・接近・運行をMyMapの交通APIから取得します。背景地図はOpenStreetMapにタイル座標を送って取得します。ブラウザーや各提供者の通信には通常のIP情報が含まれます。</small></div><div><b>オフライン</b><small>保存した時刻表・地点・設定を利用します。更新できない接近を最新の実測として表示しません。</small></div></div>`;
    return;
  }
  if (category === "terms") {
    root.innerHTML =
      '<div class="settings-card source-list"><div><b>対応範囲</b><small>京都の対応路線に特化した案内です。運行・ダイヤ・運賃は交通機関の公式案内と現地表示を優先してください。</small></div><div><b>実測・予測・予定</b><small>取得元と更新状態を区別します。未取得の到着・番線・運賃は確定情報として表示しません。</small></div></div>';
    return;
  }
  if (category === "permissions") {
    root.innerHTML = `<div class="settings-card"><div class="setting-row"><span>位置情報</span><span data-permission="geolocation">${esc(state.locationStatus)}</span></div><div class="setting-row"><span>マイク</span><span data-permission="microphone">確認中</span></div><div class="setting-row"><span>通知</span><span>${typeof Notification === "undefined" ? "未対応" : Notification.permission === "granted" ? "許可済み" : "未許可"}</span></div><label class="setting-row"><span>許可済みマイクのアナウンス補助</span><input type="checkbox" data-setting="audioAssist" ${settings.audioAssist !== false ? "checked" : ""}></label><div class="setting-row"><span>音声認識</span><span>${globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition ? "対応" : "このブラウザーは未対応"}</span></div><div class="setting-row"><span>Version</span><span>${esc(new URL(import.meta.url).searchParams.get("v") ?? "development")}</span></div></div><p class="source-note">権限の変更は端末・ブラウザー設定で行えます。ここから権限を自動要求しません。Privacyで通信・保存の詳細を確認できます。</p>`;
    for (const name of ["geolocation", "microphone"])
      navigator.permissions
        ?.query({ name })
        .then((status) => {
          const el = root.querySelector(`[data-permission="${name}"]`);
          if (el)
            el.textContent =
              { granted: "許可済み", prompt: "未許可", denied: "拒否" }[
                status.state
              ] ?? "未確認";
        })
        .catch(() => {
          const el = root.querySelector(`[data-permission="${name}"]`);
          if (el) el.textContent = "端末設定で確認";
        });
    return;
  }
  if (category === "location") {
    const node = document.querySelector("#location-settings");
    if (node) {
      root.replaceChildren(node);
      node.hidden = false;
    }
    return;
  }
  if (category === "notifications") {
    root.innerHTML = `<div class="settings-card"><label class="setting-row"><span>降車の1つ前でお知らせ</span><input type="checkbox" data-setting="alightAssist" ${settings.alightAssist !== false ? "checked" : ""}></label><label class="setting-row"><span>システム通知</span><input type="checkbox" data-setting="notifications" ${settings.notifications ? "checked" : ""}></label><button class="native-row" data-request-notifications><span>端末の通知を設定</span><span class="chevron">›</span></button></div><p class="source-note">通知を許可した端末で利用できます。画面内の降車案内も表示します。</p>`;
    return;
  }
  if (category === "display") {
    root.innerHTML = `<div class="settings-card"><label class="setting-row"><span>文字サイズ</span><select data-setting-value="fontScale" aria-label="文字サイズ">${[1, 1.5, 2].map((n) => `<option value="${n}" ${Number(settings.fontScale ?? 1) === n ? "selected" : ""}>${n * 100}%</option>`).join("")}</select></label><label class="setting-row"><span>コントラストを上げる</span><input type="checkbox" data-setting="highContrast" ${settings.highContrast ? "checked" : ""}></label><label class="setting-row"><span>動きを減らす</span><input type="checkbox" data-setting="reduceMotion" ${settings.reduceMotion ? "checked" : ""}></label><label class="setting-row"><span>時計</span><select data-setting-value="clockFormat"><option value="24" ${settings.hour12 ? "" : "selected"}>24時間</option><option value="12" ${settings.hour12 ? "selected" : ""}>12時間 / AM・PM</option></select></label><div class="setting-row"><span>Light / Dark</span><span>端末に合わせる</span></div></div><p class="source-note">端末側の文字拡大・コントラスト・視差効果の設定にも対応します。</p>`;
    return;
  }
  root.innerHTML = `<section class="settings-section"><h2>自動案内</h2><div class="settings-card"><label class="setting-row"><span><b>自動乗車判定</b><small>移動に合わせて表示を切り替えます</small></span><input type="checkbox" data-setting="autoDetect" ${settings.autoDetect ? "checked" : ""}></label><label class="setting-row"><span><b>触覚フィードバック</b><small>便を判定したときに短く通知</small></span><input type="checkbox" data-setting="haptics" ${settings.haptics ? "checked" : ""}></label><label class="setting-row"><span><b>判定根拠を表示</b><small>必要なときだけ詳細を表示</small></span><input type="checkbox" data-setting="showConfidence" ${settings.showConfidence ? "checked" : ""}></label></div></section><section class="settings-section"><h2>定期券</h2><div class="settings-card"><label class="setting-row"><span><b>市バス</b><small>対象区間の追加額を0円として計算</small></span><input type="checkbox" data-setting="passCityBus" ${settings.passCityBus ? "checked" : ""}></label><label class="setting-row"><span><b>京都バス</b><small>登録した対象区間だけに適用</small></span><input type="checkbox" data-setting="passKyotoBus" ${settings.passKyotoBus ? "checked" : ""}></label><label class="setting-row"><span><b>地下鉄</b><small>設定区間内の追加額を0円として計算</small></span><input type="checkbox" data-setting="passSubway" ${settings.passSubway ? "checked" : ""}></label><div class="pass-range"><label>区間の開始<select data-setting-value="passSubwayFrom">${subwayOptions()}</select></label><span>〜</span><label>区間の終了<select data-setting-value="passSubwayTo">${subwayOptions()}</select></label></div><label class="pass-expiry">有効期限<input type="date" data-setting-value="passExpires" value="${esc(settings.passExpires ?? "")}"></label><p class="source-caption">未設定では通常運賃＝追加額です。実際の券面区間を優先してください。</p></div></section><section class="settings-section"><h2>近くの駅</h2><div class="settings-card slider-card"><label><span><b>地下鉄を表示する距離</b><small>候補に表示する範囲</small></span><strong>${settings.railGuideDistance}m</strong><input type="range" min="150" max="600" step="50" value="${settings.railGuideDistance}" data-setting-range="railGuideDistance"></label><p class="source-caption" data-distance-preview>${distancePreview()}</p></div></section><section class="settings-section"><h2>対応路線</h2><div class="settings-card source-list"><div><b>地下鉄烏丸線</b><small>全線・近鉄直通</small></div><div><b>近鉄京都線</b><small>全線・烏丸線直通</small></div><div><b>京都バス</b><small>${KYOTO_ROUTES.join("・")}</small></div><div><b>京都市バス</b><small>${CITY_ROUTES.join("・")}・202八条口</small></div></div></section><section class="settings-section info-section"><h2 data-info-title>情報</h2><div class="settings-card source-list"><div><b>出典</b><small>京都市交通局・近畿日本鉄道・京都バス・公共交通オープンデータセンター</small></div><div><b>実測・推定・予定</b><small>実測：取得した車両の接近情報。推定：現在地・遅れ・保存情報からの見込み。予定：時刻表の時刻です。経路の便と一致しない接近は便別実測と呼びません。</small></div><div><b>更新時刻</b><small>各行の情報を取得した時刻です。古い情報は推定・保存表示に切り替わります。予定時刻の改正日は公式出典で確認できます。</small></div><div><b>運賃確認</b><small>公式運賃表を基準にし、未確認区間は確定額を表示しません</small></div><div><b>オープンデータ</b><small>公共交通オープンデータ基本ライセンスに基づき利用しています</small></div><div><b>現在地</b><small>位置情報は端末上で乗車判定に使用します</small></div></div>${logHTML()}</section>`;
  const from = root.querySelector('[data-setting-value="passSubwayFrom"]'),
    to = root.querySelector('[data-setting-value="passSubwayTo"]');
  if (from) from.value = settings.passSubwayFrom ?? "K01";
  if (to) to.value = settings.passSubwayTo ?? "K11";
  const sections = [...root.querySelectorAll(":scope>.settings-section")];
  const categories = {
    auto: [0, "自動乗車判定"],
    advanced: [0, "詳細設定"],
    pass: [1, "定期券"],
    distance: [2, "近くの駅"],
    routes: [3, "対応路線"],
    info: [4, "情報・出典"],
  };
  root.replaceChildren(sections[categories[category]?.[0] ?? 4]);
}
export function setupSettings(onRender, onSavedRoute) {
  const locationHome = document.querySelector('[data-view="settings"]');
  const applyDisplay = () => {
    const scale = Number(settings.fontScale);
    if ([1, 1.5, 2].includes(scale))
      document.documentElement.style.fontSize = `${scale * 100}%`;
    document.documentElement.dataset.highContrast = String(
      Boolean(settings.highContrast),
    );
    document.documentElement.dataset.reduceMotion = String(
      Boolean(settings.reduceMotion),
    );
  };
  applyDisplay();
  function renderSaved(element, kind) {
    const places = readSavedPlaces()
      .map((id) => state.network.stops.get(id))
      .filter(Boolean);
    const pairs = readSearchPairs(localStorage).favorites;
    element.innerHTML =
      kind === "places"
        ? `<div class="native-list">${places.map((stop) => `<div class="saved-row"><button class="native-row" data-saved-place="${esc(stop.id)}"><span><b>${esc(stop.name)}</b><small>${esc(stop.lines?.join("・"))}</small></span><span class="chevron">›</span></button><div class="saved-place-controls"><button type="button" class="plain-action quick-place-symbol" data-quick-symbol-place="${esc(stop.id)}" aria-label="${esc(stop.name)}のQuick Selectアイコンを変更">${icon(quickPlaceSymbol(settings, stop.id, stop.type))}</button><button class="plain-action" data-remove-place="${esc(stop.id)}" aria-label="${esc(stop.name)}の保存を解除">解除</button></div></div>`).join("")}</div>${places.length ? "" : '<p class="empty-state">停留所詳細から場所を保存できます。</p>'}`
        : `<div class="native-list">${pairs.map((pair, i) => `<div class="saved-row"><button class="native-row" data-saved-route="${i}"><span><b>${esc(pair.from)} → ${esc(pair.to)}</b>${pair.via?.length ? `<small>経由 ${esc(pair.via.map((v) => v.name).join("・"))}</small>` : ""}</span><span class="chevron">›</span></button><button class="plain-action" data-remove-route="${i}" aria-label="${esc(pair.to)}への保存経路を削除">削除</button></div>`).join("")}</div>${pairs.length ? "" : '<p class="empty-state">経路詳細から経路を保存できます。</p>'}`;
  }
  navigation.register("saved", {
    title: (r) => (r.params.id === "places" ? "保存した場所" : "保存した経路"),
    create({ element, route }) {
      element.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.quickSymbolPlace) {
          const id = b.dataset.quickSymbolPlace,
            sheet = $("#context-sheet");
          sheet.dataset.detent = "fit";
          openContextSheet(
            "Quick Selectのアイコン",
            `<div class="native-list quick-symbol-options">${Object.entries(
              QUICK_SYMBOLS,
            )
              .map(
                ([key, label]) =>
                  `<button type="button" class="native-row" data-pick-quick-symbol="${key}" aria-pressed="${quickPlaceSymbol(settings, id, state.network.stops.get(id)?.type) === key}">${icon(key)}<span>${label}</span><span class="chevron">›</span></button>`,
              )
              .join("")}</div>`,
          );
          const choose = (event) => {
            const option = event.target.closest("[data-pick-quick-symbol]");
            if (
              !option ||
              !Object.hasOwn(QUICK_SYMBOLS, option.dataset.pickQuickSymbol)
            )
              return;
            const existing =
              settings.quickSymbols &&
              typeof settings.quickSymbols === "object" &&
              !Array.isArray(settings.quickSymbols)
                ? settings.quickSymbols
                : {};
            settings.quickSymbols = Object.fromEntries([
              ...Object.entries(existing).filter(([place]) =>
                readSavedPlaces().includes(place),
              ),
              [id, option.dataset.pickQuickSymbol],
            ]);
            saveSettings();
            sheet.close();
            renderSaved(element, route.params.id);
          };
          sheet.addEventListener("click", choose);
          sheet.addEventListener(
            "close",
            () => sheet.removeEventListener("click", choose),
            { once: true },
          );
        }
        if (b.dataset.savedPlace)
          navigation.push("nearby", { stopId: b.dataset.savedPlace });
        if (b.dataset.removePlace) {
          toggleSavedPlace(b.dataset.removePlace);
          renderSaved(element, route.params.id);
        }
        if (b.dataset.savedRoute !== undefined)
          onSavedRoute?.(
            readSearchPairs(localStorage).favorites[
              Number(b.dataset.savedRoute)
            ],
          );
        if (b.dataset.removeRoute !== undefined) {
          removeSearchPair(
            localStorage,
            readSearchPairs(localStorage).favorites[
              Number(b.dataset.removeRoute)
            ],
          );
          renderSaved(element, route.params.id);
        }
      });
    },
    onShow({ element, route }) {
      renderSaved(element, route.params.id);
    },
  });
  let infoTaps = 0,
    lastTap = 0;
  function bind(root, category = "home") {
    root.addEventListener("change", (e) => {
      if (e.target.dataset.setting) {
        settings[e.target.dataset.setting] = e.target.checked;
        saveSettings();
        applyDisplay();
        document.dispatchEvent(new CustomEvent("mymap-settings-change"));
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
        if (e.target.dataset.settingValue === "clockFormat")
          settings.hour12 = e.target.value === "12";
        saveSettings();
        applyDisplay();
        document.dispatchEvent(new CustomEvent("mymap-settings-change"));
        onRender();
      }
    });
    root.addEventListener("input", (e) => {
      if (e.target.dataset.settingRange) {
        settings[e.target.dataset.settingRange] = Number(e.target.value);
        e.target.closest("label").querySelector("strong").textContent =
          `${settings[e.target.dataset.settingRange]}m`;
        const preview = root.querySelector("[data-distance-preview]");
        if (preview) preview.textContent = distancePreview();
      }
    });
    root.addEventListener("click", (e) => {
      if (e.target.closest("[data-request-notifications]")) {
        const b = e.target.closest("button");
        if (!("Notification" in window)) {
          b.textContent = "この端末では画面内でお知らせします";
          return;
        }
        Notification.requestPermission()
          .then((permission) => {
            settings.notifications = permission === "granted";
            saveSettings();
            renderSettings(root, category);
          })
          .catch(() => {
            b.textContent = "端末の通知設定をご確認ください";
          });
        return;
      }
      const saved = e.target.closest("[data-saved-page]");
      if (saved) {
        navigation.push("saved", { id: saved.dataset.savedPage });
        return;
      }
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
    singleton: true,
    title: (r) =>
      ({
        location: "位置情報",
        auto: "自動乗車判定",
        notifications: "通知",
        display: "表示",
        pass: "定期券",
        distance: "近くの駅",
        routes: "対応路線",
        info: "情報・出典",
        privacy: "Privacy・データの取扱い",
        terms: "利用条件",
        permissions: "権限とVersion",
      })[r.params.id] ?? "詳細設定",
    create({ element, route }) {
      bind(element, route.params.id);
    },
    onShow({ element, route }) {
      renderSettings(element, route.params.id);
    },
    onDispose({ element }) {
      const node = element.querySelector("#location-settings");
      if (node) {
        node.hidden = true;
        locationHome.append(node);
      }
    },
  });
  window.addEventListener("mymap-realtime-log", () => {
    if (state.tab === "settings" && settings.debugLive) renderSettings();
  });
}
