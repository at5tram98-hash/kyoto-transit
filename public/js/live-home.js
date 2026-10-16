import { readSearchPairs } from "./search-history.js";
import {
  esc,
  icon,
  state,
  settings,
  saveSettings,
  nearest,
  haptic,
  tokyoNow,
  ensureSubwayFeed,
} from "./vnext-state.js";
import { navigation } from "./navigation.js";
import { openContextSheet, setupSheetGestures } from "./context-sheet.js";
import {
  readSavedPlaces,
  toggleSavedPlace,
  quickPlaceSymbol,
} from "./saved-places.js";
import { stopSuggestions } from "./route-search-model.js";
import { routeMapHTML, renderRouteMap, nearbyMapModel } from "./route-map.js";
import { updateHTML } from "./view-rendering.js";
import { liveClock, appLocale, message } from "./locale.js";
import { north3Day } from "./north3-feed.js";

// Live owns its screen, not a copy of the journey planner form or input store.
export function mountLiveHome(host, search) {
  const text = (key) => message(key, settings);
  host.innerHTML = `<div class="live-clock-bar"><span data-live-day></span><time data-live-clock aria-label="現在時刻" aria-live="off"></time><button type="button" data-clock-format aria-label="12時間・24時間表示を切り替える"></button></div><div class="live-quick-strip" aria-label="Quick Select"><button type="button" class="live-quick-trigger" data-quick-open aria-haspopup="dialog">${icon("bolt")}<span>Quick</span></button><div class="live-quick-destinations"></div></div><div class="live-location-header">${icon("location")}<span class="source-dot" data-location-dot></span><span data-live-location></span></div><button type="button" class="live-stop-search" data-live-stop-search>${icon("search")}<span>${text("searchStop")}</span></button><div class="live-map-host"></div><div class="live-map-actions"><button class="plain-action" type="button" data-live-full-map>${icon("map")}<span>${text("map")}</span></button><button type="button" class="plain-action" data-live-plan>${icon("search")}<span>経路を検索</span></button></div><p class="live-update-status source-caption" role="status" data-live-update></p>`;
  const toolbar = `<div class="live-navigation-capsule"><button type="button" class="plain-action" data-live-refresh aria-label="${text("refresh")}">${icon("refresh")}</button><button type="button" class="plain-action" data-live-saved aria-label="${text("saved")}">${icon("bookmark")}</button><button type="button" class="plain-action" data-live-more aria-label="${text("more")}" aria-haspopup="dialog">${icon("more")}</button></div>`;
  navigation.register("root:now", {
    toolbar,
    onToolbar: ({ event }) => handle(event),
  });
  const sheet = document.querySelector("#context-sheet"),
    body = sheet.querySelector(".sheet-body");
  let timer = null,
    pressTimer = null,
    pressing = false,
    start = null,
    suppressClick = false,
    refreshing = false;
  const quickPlaces = () => {
    const ids = readSavedPlaces();
    if (!ids.length) {
      for (const name of ["京都", "京都産大前", "国際会館"]) {
        const stop = [...state.network.stops.values()].find(
          (s) => s.name === name,
        );
        if (stop) ids.push(stop.id);
      }
    }
    return ids
      .map((id) => state.network.stops.get(id))
      .filter(Boolean)
      .slice(0, 8);
  };
  function choose(stop) {
    if (!stop) return;
    haptic();
    if (sheet.open) sheet.close();
    const from = nearest().all[0]?.stop;
    const now = tokyoNow();
    search.openInput({
      ...(from ? { from: from.name, fromId: from.id } : {}),
      to: stop.name,
      toId: stop.id,
      date: now.date,
      time: now.time,
      timeMode: "departure",
    });
  }
  function openQuick() {
    sheet.dataset.detent = "fit";
    openContextSheet(
      text("quick"),
      `<p class="source-note">保存した場所から目的地を選べます。長押しして指を横へ動かしても選べます。</p><div class="live-quick-menu">${quickPlaces()
        .map(
          (s) =>
            `<button type="button" class="native-row" data-quick-destination="${esc(s.id)}" data-quick-symbol="${quickPlaceSymbol(settings, s.id, s.type)}">${icon(quickPlaceSymbol(settings, s.id, s.type))}<span>${esc(s.name)}</span><span class="chevron">›</span></button>`,
        )
        .join(
          "",
        )}</div><button type="button" class="native-row" data-live-saved><span>Quick Selectを編集・保存した場所</span><span class="chevron">›</span></button>`,
    );
  }
  function openStopSearch() {
    sheet.dataset.detent = "large";
    openContextSheet(
      text("searchStop"),
      `<label class="live-stop-input">${icon("search")}<input type="search" placeholder="${text("searchStop")}" aria-label="${text("searchStop")}" autocomplete="off"></label><div data-live-stop-results></div>`,
    );
    const input = body.querySelector("input"),
      results = body.querySelector("[data-live-stop-results]");
    const render = () => {
      const q = input.value.trim(),
        saved = readSavedPlaces()
          .map((id) => state.network.stops.get(id))
          .filter(Boolean),
        near = nearest()
          .all.slice(0, 6)
          .map((s) => s.stop);
      const recentIds = [
        ...new Set([
          ...(navigation.recalled("live-stop-recent") ?? []),
          ...readSearchPairs(localStorage).history.flatMap((pair) => [
            pair.toId,
            pair.fromId,
          ]),
        ]),
      ];
      const matches = stopSuggestions(state.network, q, 30);
      const sections = q
        ? [
            ["駅", matches.filter((s) => !s.type.includes("bus"))],
            ["停留所", matches.filter((s) => s.type.includes("bus"))],
          ]
        : [
            [
              "最近",
              recentIds
                .map((id) => state.network.stops.get(id))
                .filter(Boolean)
                .slice(0, 6),
            ],
            ["保存", saved],
            ["近く", near],
          ];
      results.innerHTML =
        sections
          .map(([label, stops]) =>
            stops.length
              ? `<h3 class="native-section-label">${label}</h3><div class="native-list">${stops.map((s) => `<button type="button" class="native-row" data-live-stop="${esc(s.id)}"><span class="transport-icon" data-operator="${esc(s.type)}">${icon(s.type.includes("bus") ? "bus" : "train")}</span><span><b>${esc(s.name)}</b><small>${esc(s.lines?.join("・") ?? s.type)}</small></span><span class="chevron">›</span></button>`).join("")}</div>`
              : "",
          )
          .join("") ||
        `<p class="empty-state">${q ? "一致する駅・停留所がありません。" : "駅名・停留所名を入力してください。"}</p>`;
    };
    input.addEventListener("input", render);
    render();
    input.focus();
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    const prior = state.subwayFeed,
      status = host.querySelector("[data-live-update]");
    status.textContent = "交通情報を更新中…";
    try {
      const feed = await ensureSubwayFeed(true);
      document.dispatchEvent(new CustomEvent("mymap-live-refresh"));
      status.innerHTML =
        navigator.onLine === false
          ? "オフライン · 保存した時刻表を使用します"
          : feed && feed !== prior && !feed.cached
            ? "時刻表を確認しました"
            : `${feed ? "保存した時刻表を表示しています。" : "時刻表を取得できません。"}<button type="button" class="plain-action" data-live-refresh>再試行</button>`;
    } finally {
      refreshing = false;
    }
  }
  function handle(event) {
    const marker = event.target.closest("[data-map-stop]");
    if (marker && !marker.closest("[data-map-dragging]")) {
      const stop = state.network.stops.get(marker.dataset.mapStop);
      if (stop) {
        sheet.dataset.detent = "fit";
        openContextSheet(
          stop.name,
          `<p class="source-note">${esc(stop.lines?.join("・") ?? "")}</p><div class="native-list"><button type="button" class="native-row" data-live-stop="${esc(stop.id)}"><span>発車・接近情報を見る</span><span class="chevron">›</span></button><button type="button" class="native-row" data-open-timetable="${esc(stop.id)}"><span>時刻表を見る</span><span class="chevron">›</span></button><button type="button" class="native-row" data-live-save-place="${esc(stop.id)}"><span>${readSavedPlaces().includes(stop.id) ? "保存を解除" : "Quick Selectに保存"}</span><span class="chevron">›</span></button></div>`,
        );
      }
      return;
    }
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.liveSavePlace) {
      toggleSavedPlace(b.dataset.liveSavePlace);
      sheet.close();
    } else if (b.dataset.openTimetable) sheet.close();
    else if (b.hasAttribute("data-clock-format")) {
      settings.hour12 = !settings.hour12;
      saveSettings();
      tick();
    } else if (b.hasAttribute("data-quick-open")) {
      if (!suppressClick) openQuick();
      suppressClick = false;
    } else if (b.dataset.quickDestination)
      choose(state.network.stops.get(b.dataset.quickDestination));
    else if (b.hasAttribute("data-live-stop-search")) openStopSearch();
    else if (b.dataset.liveStop) {
      const stop = state.network.stops.get(b.dataset.liveStop);
      if (!stop) return;
      navigation.remember(
        "live-stop-recent",
        [
          stop.id,
          ...(navigation.recalled("live-stop-recent") ?? []).filter(
            (id) => id !== stop.id,
          ),
        ].slice(0, 8),
      );
      sheet.close();
      navigation.push("nearby", { stopId: stop.id });
    } else if (b.hasAttribute("data-live-plan")) search.open();
    else if (b.hasAttribute("data-live-saved")) {
      sheet.close();
      navigation.push("saved", { id: "places" });
    } else if (b.hasAttribute("data-live-refresh")) void refresh();
    else if (b.hasAttribute("data-live-full-map"))
      navigation.push("map", { nearby: true });
    else if (b.hasAttribute("data-live-more")) {
      sheet.dataset.detent = "fit";
      openContextSheet(
        "Liveの操作",
        `<div class="native-list"><button type="button" class="native-row" data-live-plan><span>経路を検索</span><span class="chevron">›</span></button><button type="button" class="native-row" data-navigation-screen="arrivals"><span>すべての接近情報</span><span class="chevron">›</span></button><button type="button" class="native-row" data-open-settings><span>位置情報・表示の設定</span><span class="chevron">›</span></button></div>`,
      );
    } else if (b.dataset.navigationScreen && sheet.open) {
      sheet.close();
      navigation.push(b.dataset.navigationScreen);
    }
  }
  host.addEventListener("click", handle);
  host.addEventListener("keydown", (event) => {
    const marker = event.target.closest("[data-map-stop]");
    if (marker && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      marker.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  });
  sheet.addEventListener("click", handle);
  const trigger = host.querySelector("[data-quick-open]");
  function cancelPress() {
    clearTimeout(pressTimer);
    pressing = false;
    start = null;
    trigger?.setAttribute("aria-expanded", "false");
    host.querySelector(".live-quick-strip").removeAttribute("data-selecting");
    host
      .querySelectorAll("[data-quick-destination]")
      .forEach((b) => b.classList.remove("quick-tracking"));
  }
  trigger.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    start = { x: e.clientX, y: e.clientY };
    suppressClick = false;
    trigger.setPointerCapture(e.pointerId);
    pressTimer = setTimeout(() => {
      pressing = true;
      suppressClick = true;
      host
        .querySelector(".live-quick-strip")
        .setAttribute("data-selecting", "true");
      haptic();
      trigger.setAttribute("aria-expanded", "true");
    }, 420);
  });
  trigger.addEventListener("pointermove", (e) => {
    if (!start) return;
    if (
      !pressing &&
      Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12
    ) {
      cancelPress();
      return;
    }
    if (!pressing) return;
    const target = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest("[data-quick-destination]");
    host
      .querySelectorAll("[data-quick-destination]")
      .forEach((b) => b.classList.toggle("quick-tracking", b === target));
  });
  trigger.addEventListener("pointerup", (event) => {
    const selected = host.querySelector(".quick-tracking");
    const wasPressing = pressing;
    cancelPress();
    trigger.setAttribute("aria-expanded", "false");
    if (selected)
      choose(state.network.stops.get(selected.dataset.quickDestination));
    else if (
      wasPressing &&
      trigger.contains(document.elementFromPoint(event.clientX, event.clientY))
    )
      openQuick();
  });
  trigger.addEventListener("pointercancel", cancelPress);
  function tick() {
    if (
      document.hidden ||
      navigation.tab !== "now" ||
      navigation.route.type !== "root" ||
      host.hidden
    )
      return;
    const clock = liveClock(new Date(), {
      locale: appLocale(settings),
      hour12: settings.hour12 === true,
    });
    host.querySelector("[data-live-clock]").textContent = clock.time;
    host.querySelector("[data-clock-format]").textContent = clock.period;
    const day = north3Day(tokyoNow().date);
    host.querySelector("[data-live-day]").textContent = text(
      day === "saturday"
        ? "saturday"
        : day === "holiday"
          ? "holiday"
          : day === "weekday"
            ? "weekdays"
            : "unknownDay",
    );
  }
  function syncClock() {
    clearInterval(timer);
    tick();
    if (
      !document.hidden &&
      navigation.tab === "now" &&
      navigation.route.type === "root" &&
      !host.hidden
    )
      timer = setInterval(tick, 1000);
  }
  function render() {
    const near = nearest(),
      closest = near.all[0],
      fix = state.fix;
    const active =
      state.locationStatus === "active" &&
      fix &&
      [fix.lat, fix.lng, fix.accuracy, fix.timestamp].every(Number.isFinite) &&
      Math.abs(fix.lat) <= 90 &&
      Math.abs(fix.lng) <= 180 &&
      fix.accuracy >= 0 &&
      Date.now() - fix.timestamp <= 45000 &&
      fix.timestamp <= Date.now() + 5000;
    const low = active && fix.accuracy > 50;
    const dot = host.querySelector("[data-location-dot]");
    dot.dataset.quality = active ? (low ? "low" : "available") : "missing";
    const copy = active
      ? `${closest && closest.meters <= 1000 ? closest.stop.name + "付近" : "現在地を取得"}${low ? ` · 精度約${Math.round(fix.accuracy)}m` : ""}`
      : text(
          state.locationStatus === "loading"
            ? "locationLoading"
            : "locationMissing",
        );
    host.querySelector("[data-live-location]").textContent = copy;
    const quick = quickPlaces()
      .map(
        (s) =>
          `<button type="button" data-quick-destination="${esc(s.id)}" data-quick-symbol="${quickPlaceSymbol(settings, s.id, s.type)}">${icon(quickPlaceSymbol(settings, s.id, s.type))}<span>${esc(s.name)}</span></button>`,
      )
      .join("");
    updateHTML(host.querySelector(".live-quick-destinations"), quick);
    const map = nearbyMapModel(
      state.geo,
      near,
      active ? state.fix : null,
      state.network,
    );
    const mapHost = host.querySelector(".live-map-host");
    if (map) {
      state.nearbyMap = map;
      const model = { bus: false, lineId: "nearby" };
      if (!mapHost.querySelector(".route-map"))
        mapHost.innerHTML = routeMapHTML(map, model, {
          interactive: true,
          controls: false,
        });
      else
        renderRouteMap(mapHost, map, model, {
          interactive: true,
          controls: false,
        });
    } else
      updateHTML(
        mapHost,
        `<p class="empty-state">${text("nearbyUnknown")}</p>`,
      );
    if (!refreshing && !navigator.onLine)
      host.querySelector("[data-live-update]").textContent = text("offline");
    syncClock();
  }
  host.addEventListener("mymap-now-context", render);
  document.addEventListener("mymap-saved-places-change", render);
  document.addEventListener("mymap-navigation-change", syncClock);
  document.addEventListener("visibilitychange", () => {
    cancelPress();
    syncClock();
  });
  window.addEventListener("pagehide", () => {
    cancelPress();
    clearInterval(timer);
  });
  window.addEventListener("pageshow", syncClock);
  setupSheetGestures();
  render();
  navigation.refresh();
}
