import { state, tokyoNow, icon, toast } from "./vnext-state.js";
import { mountStopAutocomplete } from "./stop-autocomplete.js";
import { readSearchPairs } from "./search-history.js";
import { loadNorth3Snapshot, north3Board, north3Day } from "./north3-feed.js";
import { formatMinute } from "./vnext-core.js";
import { getKintetsuFeed } from "./fast-data.js";

const KINTETSU_NAMES = new Set([
  "京都",
  "東寺",
  "十条",
  "上鳥羽口",
  "竹田",
  "伏見",
  "近鉄丹波橋",
  "桃山御陵前",
  "向島",
  "小倉",
  "伊勢田",
  "大久保",
  "久津川",
  "寺田",
  "富野荘",
  "新田辺",
  "興戸",
  "三山木",
  "近鉄宮津",
  "狛田",
  "新祝園",
  "木津川台",
  "山田川",
  "高の原",
  "平城",
  "大和西大寺",
  "新大宮",
  "近鉄奈良",
]);

let quickDraft = {
  destination: "",
  destinationId: "",
  mode: "departure",
  date: "",
  time: "",
  trainType: "all",
  expanded: false,
};
let loadingTimer = null;

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

function usesKintetsu(...values) {
  return values.some((value) => {
    const text = String(value ?? "").trim();
    return KINTETSU_NAMES.has(text) || /近鉄|京都線|奈良線/.test(text);
  });
}

function syncTopbar() {
  const subtitle = document.querySelector("#view-subtitle"),
    active = document.querySelector(".tab-button.active")?.dataset.tab,
    menu = document.querySelector(".topbar .round-action");
  if (subtitle) {
    const label = active === "now" ? "LIVE" : "My Map";
    if (subtitle.textContent !== label) subtitle.textContent = label;
  }
  if (menu) {
    menu.removeAttribute("data-open-settings");
    menu.dataset.openAppMenu = "";
    menu.setAttribute("aria-label", "My Mapメニューを開く");
  }
}

function ensureMenu() {
  if (document.querySelector("#app-menu-sheet")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "app-menu-sheet";
  dialog.className = "sheet app-menu-sheet";
  dialog.setAttribute("aria-labelledby", "app-menu-title");
  dialog.innerHTML = `
    <button type="button" class="sheet-drag-handle" data-app-menu-close aria-label="閉じる"><span></span></button>
    <div class="sheet-header">
      <div><span class="source-caption">MY MAP</span><h2 id="app-menu-title">メニュー</h2></div>
      <button type="button" class="sheet-close" data-app-menu-close aria-label="閉じる">×</button>
    </div>
    <div class="sheet-body app-menu-actions">
      <button type="button" class="native-row" data-app-menu-action="search"><span class="system-symbol">${icon("train")}</span><span><b>経路を検索</b><small>目的地・時刻・列車種別から検索</small></span><span class="chevron">›</span></button>
      <button type="button" class="native-row" data-app-menu-action="timetable"><span class="system-symbol">${icon("timetable")}</span><span><b>時刻表</b><small>駅・停留所から確認</small></span><span class="chevron">›</span></button>
      <button type="button" class="native-row" data-app-menu-action="operations"><span class="system-symbol menu-operation-symbol"><span>!</span></span><span><b>運行情報</b><small>遅延・運休を確認</small></span><span class="chevron">›</span></button>
      <button type="button" class="native-row" data-app-menu-action="location"><span class="system-symbol">${icon("location")}</span><span><b>現在地を再確認</b><small>乗車判定の位置情報を更新</small></span><span class="chevron">›</span></button>
      <button type="button" class="native-row" data-app-menu-action="settings"><span class="system-symbol">${icon("settings")}</span><span><b>設定</b><small>位置情報・通知・表示設定</small></span><span class="chevron">›</span></button>
    </div>`;
  document.body.append(dialog);

  dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-app-menu-close]")) return dialog.close();
    const action = event.target.closest("[data-app-menu-action]")?.dataset
      .appMenuAction;
    if (!action) return;
    dialog.close();
    if (["timetable", "operations", "settings"].includes(action))
      document.querySelector(`[data-tab="${action}"]`)?.click();
    if (action === "location")
      document.querySelector("#location-indicator")?.click();
    if (action === "search") {
      document.querySelector('[data-tab="timetable"]')?.click();
      setTimeout(
        () =>
          document
            .querySelector('[data-view="timetable"] [data-open-search]')
            ?.click(),
        0,
      );
    }
  });
}

function quickRecentHTML() {
  let pairs = { favorites: [], history: [] };
  try {
    pairs = readSearchPairs(localStorage);
  } catch {}
  const rows = [...pairs.favorites, ...pairs.history]
    .filter(
      (pair, index, all) => all.findIndex((x) => x.to === pair.to) === index,
    )
    .slice(0, 3);
  if (!rows.length) return "";
  return `<div class="quick-recent-list">${rows
    .map(
      (pair) =>
        `<button type="button" class="quick-recent" data-quick-destination="${esc(pair.to)}" data-quick-stop-id="${esc(pair.toId ?? "")}"><span>${esc(pair.to)}</span><small>${esc(pair.from)}から</small></button>`,
    )
    .join("")}</div>`;
}

function renderQuickSearch() {
  const root = document.querySelector("#now-search");
  if (!root || root.hidden || root.querySelector(".quick-journey")) return;
  const now = tokyoNow();
  if (!quickDraft.date) quickDraft.date = now.date;
  if (!quickDraft.time) quickDraft.time = now.time;
  const expanded =
    quickDraft.expanded || Boolean(quickDraft.destination.trim());
  root.innerHTML = `<form class="quick-journey" id="quick-journey-form">
    <label class="quick-destination">
      <span class="quick-search-symbol" aria-hidden="true"></span>
      <input name="destination" data-stop-input value="${esc(quickDraft.destination)}" placeholder="目的地を入力" autocomplete="off" aria-label="目的地">
    </label>
    <div id="quick-stop-suggestions" class="stop-suggestions" hidden></div>
    <div class="quick-search-more${expanded ? " is-open" : ""}" data-quick-search-more aria-hidden="${expanded ? "false" : "true"}">
      <div class="quick-time-mode" role="group" aria-label="出発または到着">
        <button type="button" data-quick-mode="departure" class="${quickDraft.mode === "departure" ? "active" : ""}">出発</button>
        <button type="button" data-quick-mode="arrival" class="${quickDraft.mode === "arrival" ? "active" : ""}">到着</button>
      </div>
      <div class="quick-date-time">
        <label><span>日付</span><input type="date" name="quickDate" value="${esc(quickDraft.date)}"></label>
        <label><span>時刻</span><input type="time" name="quickTime" value="${esc(quickDraft.time)}"></label>
      </div>
      <label class="quick-kintetsu${usesKintetsu(quickDraft.destination) ? " is-visible" : ""}"><span>近鉄の列車</span><select name="quickTrainType"><option value="all"${quickDraft.trainType === "all" ? " selected" : ""}>普通・急行</option><option value="local"${quickDraft.trainType === "local" ? " selected" : ""}>普通のみ</option><option value="express"${quickDraft.trainType === "express" ? " selected" : ""}>急行のみ</option></select></label>
      <button type="submit" class="primary-action quick-search-submit">検索</button>
    </div>
  </form>${quickRecentHTML()}`;

  const form = root.querySelector("#quick-journey-form"),
    destination = form.elements.destination,
    more = form.querySelector("[data-quick-search-more]"),
    kintetsu = form.querySelector(".quick-kintetsu");
  const autocomplete = mountStopAutocomplete({
    container: form,
    list: form.querySelector("#quick-stop-suggestions"),
    network: state.network,
    onSelect(input, stop) {
      quickDraft.destination = input.value;
      quickDraft.destinationId = stop?.id ?? "";
    },
  });
  autocomplete.bind(destination);
  const expand = () => {
    quickDraft.expanded = true;
    more.classList.add("is-open");
    more.setAttribute("aria-hidden", "false");
  };
  destination.addEventListener("input", () => {
    quickDraft.destination = destination.value;
    if (destination.value.trim()) expand();
    kintetsu.classList.toggle("is-visible", usesKintetsu(destination.value));
  });
  form.querySelectorAll("[data-quick-mode]").forEach((button) =>
    button.addEventListener("click", () => {
      quickDraft.mode = button.dataset.quickMode;
      form
        .querySelectorAll("[data-quick-mode]")
        .forEach((x) => x.classList.toggle("active", x === button));
    }),
  );
  form.elements.quickDate.addEventListener(
    "change",
    () => (quickDraft.date = form.elements.quickDate.value),
  );
  form.elements.quickTime.addEventListener(
    "change",
    () => (quickDraft.time = form.elements.quickTime.value),
  );
  form.elements.quickTrainType.addEventListener(
    "change",
    () => (quickDraft.trainType = form.elements.quickTrainType.value),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitQuickSearch(form);
  });
  root.querySelectorAll("[data-quick-destination]").forEach((button) =>
    button.addEventListener("click", () => {
      quickDraft.destination = button.dataset.quickDestination;
      quickDraft.destinationId = button.dataset.quickStopId;
      quickDraft.expanded = true;
      root.innerHTML = "";
      renderQuickSearch();
      root.querySelector('input[name="destination"]')?.focus();
    }),
  );
}

function submitQuickSearch(form) {
  const planner = document.querySelector("#planner-form");
  if (!planner) return toast("経路検索を準備中です。もう一度お試しください");
  const destination = form.elements.destination.value.trim();
  if (!destination) {
    form.elements.destination.focus();
    return;
  }
  quickDraft.destination = destination;
  quickDraft.date = form.elements.quickDate.value;
  quickDraft.time = form.elements.quickTime.value;
  quickDraft.trainType = form.elements.quickTrainType.value;
  document.querySelector("[data-search-current]")?.click();
  planner.dispatchEvent(
    new CustomEvent("mymap-search-draft", {
      detail: { to: destination, toId: quickDraft.destinationId, via: [] },
    }),
  );
  planner.elements.date.value = quickDraft.date;
  planner.elements.time.value = quickDraft.time;
  planner.elements.timeMode.value = quickDraft.mode;
  planner.elements.trainType.value = quickDraft.trainType;
  planner.dispatchEvent(new Event("change", { bubbles: true }));
  planner.dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
}

function refinePlanner() {
  const planner = document.querySelector("#planner-form"),
    filter = document.querySelector("#search-filter");
  if (!planner || !filter || planner.dataset.refined === "true") return false;
  planner.dataset.refined = "true";
  const conditionsButton = planner.querySelector(".planner-conditions"),
    dateRow = filter.querySelector(".planner-date-row"),
    trainSelect = filter.querySelector('select[name="trainType"]'),
    trainLabel = trainSelect?.closest("label");
  if (dateRow && conditionsButton)
    planner.insertBefore(dateRow, conditionsButton);
  if (conditionsButton) {
    conditionsButton.classList.add("planner-more-conditions");
    const label = conditionsButton.querySelector("span:first-child");
    if (label) label.textContent = "詳細条件";
  }
  let kintetsu = planner.querySelector(".planner-kintetsu-condition");
  if (!kintetsu) {
    kintetsu = document.createElement("div");
    kintetsu.className = "planner-kintetsu-condition";
    conditionsButton?.before(kintetsu);
  }
  if (trainLabel) kintetsu.append(trainLabel);
  const sync = () => {
    const visible = usesKintetsu(
      planner.elements.from.value,
      planner.elements.to.value,
    );
    kintetsu.classList.toggle("is-visible", visible);
  };
  planner.elements.from.addEventListener("input", sync);
  planner.elements.to.addEventListener("input", sync);
  sync();
  return true;
}

function showSearchLoading() {
  const overlay = document.querySelector("#search-loading-overlay");
  if (!overlay) return;
  overlay.hidden = false;
  overlay.dataset.started = String(Date.now());
  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    const loading = document.querySelector(
        "[data-planner-status] .loading-note",
      ),
      result = document.querySelector("[data-planner-results] .planner-result"),
      warning = document.querySelector(
        "[data-planner-status] .planner-warning",
      ),
      started = Number(overlay.dataset.started || Date.now());
    if (result || (!loading && warning) || Date.now() - started > 25000) {
      overlay.hidden = true;
      clearInterval(loadingTimer);
    }
  }, 120);
}

function ensureSearchLoading() {
  if (document.querySelector("#search-loading-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "search-loading-overlay";
  overlay.className = "search-loading-overlay";
  overlay.hidden = true;
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML =
    '<div class="search-loading-card"><span class="search-spinner" aria-hidden="true"></span><b>検索中</b><small>最適な経路と運行情報を確認しています</small></div>';
  document.body.append(overlay);
  document.addEventListener("mymap-search-started", showSearchLoading);
}

function modeMarkup(stop) {
  if (!stop) return icon("info");
  if (stop.type === "subway") return `${icon("train")}<small>地下鉄</small>`;
  if (stop.type === "kintetsu") return `${icon("train")}<small>近鉄</small>`;
  if (stop.type === "kyotobus") return `${icon("bus")}<small>京都バス</small>`;
  if (stop.type === "citybus") return `${icon("bus")}<small>市バス</small>`;
  return icon("info");
}

async function appendNorth3(row, stop) {
  if (
    !stop?.lines?.includes("北3") ||
    row.parentElement?.querySelector(
      `.north3-inline[data-for="${CSS.escape(stop.id)}"]`,
    )
  )
    return;
  try {
    const snapshot = await loadNorth3Snapshot(),
      now = tokyoNow(),
      day = north3Day(now.date);
    if (!day || !row.isConnected) return;
    const boards = ["north", "south"]
        .map((direction) =>
          north3Board(snapshot, stop.fullName ?? stop.name, direction, day),
        )
        .filter(Boolean),
      entries = boards
        .flatMap((board) =>
          board.entries
            .filter(
              (entry) =>
                entry.depart >= now.minute &&
                entry.depart < now.minute + 60 &&
                !entry.operatingConditions,
            )
            .slice(0, 2)
            .map((entry) => ({
              ...entry,
              destination:
                board.direction === "north" ? "京都産大前" : "北大路BT",
            })),
        )
        .sort((a, b) => a.depart - b.depart)
        .slice(0, 2);
    if (!entries.length) return;
    const box = document.createElement("div");
    box.className = "nearby-departures compact-departures north3-inline";
    box.dataset.for = stop.id;
    box.innerHTML = entries
      .map(
        (entry) =>
          `<div><span><b>北3</b> ${esc(entry.destination)}方面</span><time>${formatMinute(entry.depart)}</time><b>${Math.max(0, Math.round(entry.depart - now.minute))}分<small>${entry.operatingCompany === "kyotobus" ? "京都バス" : "京都市バス"}</small></b></div>`,
      )
      .join("");
    row.after(box);
  } catch {}
}

async function appendKintetsu(row, stop) {
  if (
    stop?.type !== "kintetsu" ||
    row.parentElement?.querySelector(
      `.kintetsu-inline[data-for="${CSS.escape(stop.id)}"]`,
    )
  )
    return;
  try {
    const feed = await getKintetsuFeed(),
      now = tokyoNow(),
      rows = [];
    for (const service of feed?.services ?? []) {
      const index = service.stops?.indexOf(stop.id) ?? -1;
      if (index < 0) continue;
      for (const trip of service.trips ?? []) {
        const depart = trip.departures?.[index] ?? trip.arrivals?.[index];
        if (
          !Number.isFinite(depart) ||
          depart < now.minute ||
          depart > now.minute + 60
        )
          continue;
        rows.push({
          depart,
          category: trip.category ?? service.category ?? "local",
          destination: trip.destination ?? service.destination ?? "",
        });
      }
    }
    rows.sort((a, b) => a.depart - b.depart);
    if (!rows.length || !row.isConnected) return;
    const box = document.createElement("div");
    box.className = "nearby-departures compact-departures kintetsu-inline";
    box.dataset.for = stop.id;
    box.innerHTML = rows
      .slice(0, 2)
      .map(
        (entry) =>
          `<div><span><b>${entry.category === "express" ? "急行" : "普通"}</b>${entry.destination ? ` · ${esc(entry.destination)}行` : ""}</span><time>${formatMinute(entry.depart)}</time><b>${Math.max(0, Math.round(entry.depart - now.minute))}分<small>近鉄</small></b></div>`,
      )
      .join("");
    row.after(box);
  } catch {}
}

function refineNearby() {
  document.querySelectorAll(".nearby-guide .nearby-row").forEach((row) => {
    const stop = state.network?.stops?.get(row.dataset.nearbyDetail),
      symbol = row.querySelector(".mode-symbol");
    if (symbol && symbol.dataset.enhanced !== "true") {
      symbol.dataset.enhanced = "true";
      symbol.className = `mode-symbol enhanced-mode ${stop?.type === "subway" ? "subway" : stop?.type === "kintetsu" ? "rail" : "bus"}`;
      symbol.innerHTML = modeMarkup(stop);
    }
    void appendNorth3(row, stop);
    void appendKintetsu(row, stop);
  });
}

function installObservers() {
  const nowSearch = document.querySelector("#now-search"),
    nearby = document.querySelector("#nearby-panel"),
    subtitle = document.querySelector("#view-subtitle");
  if (nowSearch)
    new MutationObserver(renderQuickSearch).observe(nowSearch, {
      childList: true,
      subtree: false,
    });
  if (nearby)
    new MutationObserver(refineNearby).observe(nearby, {
      childList: true,
      subtree: true,
    });
  if (subtitle)
    new MutationObserver(syncTopbar).observe(subtitle, {
      childList: true,
      characterData: true,
      subtree: true,
    });
}

export function installIdleExperience() {
  ensureMenu();
  ensureSearchLoading();
  syncTopbar();
  renderQuickSearch();
  refineNearby();
  installObservers();

  const setupPlanner = () => {
    if (refinePlanner()) return;
    setTimeout(setupPlanner, 100);
  };
  setupPlanner();

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-open-app-menu]"))
      document.querySelector("#app-menu-sheet")?.showModal();
  });
  document.addEventListener("mymap-navigation-change", () => {
    syncTopbar();
    renderQuickSearch();
    refineNearby();
  });
  document
    .querySelector(".tabbar")
    ?.addEventListener("click", () => requestAnimationFrame(syncTopbar));
}
