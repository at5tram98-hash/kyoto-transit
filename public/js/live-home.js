import { ui } from "./locale.js";
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
import { reducedMotion } from "./navigation-motion.js";

// Live owns its screen, not a copy of the journey planner form or input store.
export function mountLiveHome(host, search) {
  const text = (key) => message(key, settings);
  host.innerHTML = ui("live_home_001", [
    icon("bolt"),
    icon("location"),
    icon("search"),
    text("searchStop"),
    icon("map"),
    text("map"),
    icon("search"),
  ]);
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
  const quickStrip = host.querySelector(".live-quick-strip"),
    quickDestinations = host.querySelector(".live-quick-destinations");
  let quickTouched = false,
    lastQuickMove = 0;
  const stopQuickScroll = () => {
    quickTouched = true;
    quickDestinations.scrollTo({
      left: quickDestinations.scrollLeft,
      behavior: "instant",
    });
  };
  for (const event of ["pointerdown", "wheel", "keydown", "focusin"])
    quickStrip.addEventListener(event, stopQuickScroll, { passive: true });
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener(
    "change",
    (event) => {
      if (event.matches) stopQuickScroll();
    },
  );
  const quickPlaces = () => {
    const ids = readSavedPlaces();
    if (!ids.length) {
      for (const name of [
        ui("live_home_002"),
        ui("live_home_003"),
        ui("live_home_004"),
      ]) {
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
      ui("live_home_005", [
        quickPlaces()
          .map(
            (s) =>
              `<button type="button" class="native-row" data-quick-destination="${esc(s.id)}" data-quick-symbol="${quickPlaceSymbol(settings, s.id, s.type)}">${icon(quickPlaceSymbol(settings, s.id, s.type))}<span>${esc(s.name)}</span><span class="chevron">›</span></button>`,
          )
          .join(""),
      ]),
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
            [
              ui("live_home_006"),
              matches.filter((s) => !s.type.includes("bus")),
            ],
            [
              ui("live_home_007"),
              matches.filter((s) => s.type.includes("bus")),
            ],
          ]
        : [
            [
              ui("live_home_008"),
              recentIds
                .map((id) => state.network.stops.get(id))
                .filter(Boolean)
                .slice(0, 6),
            ],
            [ui("live_home_009"), saved],
            [ui("live_home_010"), near],
          ];
      results.innerHTML =
        sections
          .map(([label, stops]) =>
            stops.length
              ? `<h3 class="native-section-label">${label}</h3><div class="native-list">${stops.map((s) => `<button type="button" class="native-row" data-live-stop="${esc(s.id)}"><span class="transport-icon" data-operator="${esc(s.type)}">${icon(s.type.includes("bus") ? "bus" : "train")}</span><span><b>${esc(s.name)}</b><small>${esc(s.lines?.join("・") ?? s.type)}</small></span><span class="chevron">›</span></button>`).join("")}</div>`
              : "",
          )
          .join("") ||
        `<p class="empty-state">${q ? ui("live_home_011") : ui("live_home_012")}</p>`;
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
    status.textContent = ui("live_home_013");
    try {
      const feed = await ensureSubwayFeed(true);
      document.dispatchEvent(new CustomEvent("mymap-live-refresh"));
      status.innerHTML =
        navigator.onLine === false
          ? ui("live_home_014")
          : feed && feed !== prior && !feed.cached
            ? ui("live_home_015")
            : ui("live_home_024", [
                feed ? ui("live_home_016") : ui("live_home_017"),
              ]);
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
          ui("live_home_025", [
            esc(stop.lines?.join("・") ?? ""),
            esc(stop.id),
            esc(stop.id),
            esc(stop.id),
            readSavedPlaces().includes(stop.id)
              ? ui("live_home_018")
              : ui("live_home_019"),
          ]),
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
      openContextSheet(ui("live_home_020"), ui("live_home_021"));
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
  const menu = document.createElement("div");
  menu.className = "live-quick-popover";
  menu.id = "live-quick-popover";
  menu.setAttribute("popover", "manual");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", text("quick"));
  document.body.append(menu);
  trigger.setAttribute("aria-controls", menu.id);
  const closeMenu = () => {
    if (menu.matches(":popover-open")) menu.hidePopover();
    trigger.setAttribute("aria-expanded", "false");
  };
  function showMenu({ focus = false } = {}) {
    stopQuickScroll();
    menu.innerHTML = quickPlaces()
      .map(
        (s) =>
          `<button type="button" role="menuitem" data-quick-destination="${esc(s.id)}">${icon(quickPlaceSymbol(settings, s.id, s.type))}<span>${esc(s.name)}</span></button>`,
      )
      .join("");
    menu.showPopover();
    const anchor = trigger.getBoundingClientRect(),
      viewport = visualViewport;
    const left = viewport?.offsetLeft ?? 0,
      top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? innerWidth,
      height = viewport?.height ?? innerHeight;
    menu.style.left = `${Math.max(left + 8, Math.min(anchor.left, left + width - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(top + 8, Math.min(anchor.bottom + 8, top + height - menu.offsetHeight - 8))}px`;
    trigger.setAttribute("aria-expanded", "true");
    if (focus) menu.querySelector("button")?.focus();
  }
  menu.addEventListener("click", (e) => {
    const button = e.target.closest("[data-quick-destination]");
    if (button) {
      closeMenu();
      choose(state.network.stops.get(button.dataset.quickDestination));
    }
  });
  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll("button")],
      index = items.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      items[
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? items.length - 1
            : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length
      ]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      trigger.focus();
    } else if (e.key === "Tab") closeMenu();
  });
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      showMenu({ focus: true });
    }
  });
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!menu.contains(e.target) && !trigger.contains(e.target)) closeMenu();
    },
    { passive: true },
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.matches(":popover-open")) {
      closeMenu();
      trigger.focus();
    }
  });
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
      showMenu();
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
    menu
      .querySelectorAll("[data-quick-destination]")
      .forEach((b) => b.classList.toggle("quick-tracking", b === target));
  });
  trigger.addEventListener("pointerup", (event) => {
    const selected = menu.querySelector(".quick-tracking");
    const wasPressing = pressing;
    cancelPress();
    trigger.setAttribute("aria-expanded", "false");
    if (selected) {
      closeMenu();
      choose(state.network.stops.get(selected.dataset.quickDestination));
    } else if (wasPressing) {
      if (
        trigger.contains(
          document.elementFromPoint(event.clientX, event.clientY),
        )
      )
        trigger.setAttribute("aria-expanded", "true");
      else closeMenu();
    }
  });
  trigger.addEventListener("pointercancel", () => {
    cancelPress();
    closeMenu();
  });
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
    // Optional quiet marquee uses the browser's native smooth scroll. User
    // interaction cancels it for the session; it never changes scroll physics.
    if (
      !quickTouched &&
      !reducedMotion() &&
      !document.querySelector("dialog[open]") &&
      Date.now() - lastQuickMove >= 1000 &&
      quickDestinations.scrollLeft + quickDestinations.clientWidth <
        quickDestinations.scrollWidth - 1
    ) {
      lastQuickMove = Date.now();
      quickDestinations.scrollBy({ left: 18, behavior: "smooth" });
    }
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
      ? `${closest && closest.meters <= 1000 ? closest.stop.name + ui("live_home_026") : ui("live_home_022")}${low ? ui("live_home_023", [Math.round(fix.accuracy)]) : ""}`
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
  document.addEventListener("mymap-navigation-change", () => {
    closeMenu();
    syncClock();
  });
  document.addEventListener("visibilitychange", () => {
    cancelPress();
    closeMenu();
    syncClock();
  });
  window.addEventListener("pagehide", () => {
    cancelPress();
    closeMenu();
    clearInterval(timer);
  });
  window.addEventListener("pageshow", syncClock);
  setupSheetGestures();
  render();
  navigation.refresh();
}
