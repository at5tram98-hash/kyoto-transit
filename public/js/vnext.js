import { createNetwork } from "./network.js";
import { locate } from "./mobility.js";
import { createLocationSession } from "./location-session.js";
import { mountTimetables, mountOperations } from "./timetable-ui.js";
import { mountRouteSearch } from "./route-search-ui.js";
import {
  $,
  $$,
  esc,
  icon,
  state,
  settings,
  haptic,
  tokyoNow,
  augmentKyotoBusGeometry,
  ensureRailFeed,
  ensureSubwayFeed,
  nearest,
  persistJourney,
  restoreJourney,
  rideKey,
  toast,
} from "./vnext-state.js";
import {
  autoDetectRide,
  updateBusTrail,
  confirmRideCandidate,
  resetRideDetection,
  startManualRide,
} from "./vnext-detect.js";
import { renderNow, setupNowInteractions } from "./vnext-view.js";
import {
  setupContextSheet,
  openContextSheet,
  destinationSheet,
} from "./context-sheet.js";
import { navigation, initializeNavigation } from "./navigation.js";
import { registerNowScreens, validNowScreen } from "./now-navigation.js";
import {
  renderSettings,
  setupSettings,
  refreshNetwork,
} from "./vnext-network-view.js";
import { openFoldback, setupFoldback } from "./vnext-foldback.js";
import { foldbackJourney } from "./boarding.js";
import { mountArrivals } from "./vnext-arrivals.js";

let timetables,
  operations,
  arrivals,
  routeSearch,
  updateRegistration,
  applyingUpdate = false;
async function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return;
  try {
    const url = new URL("../sw.js", import.meta.url);
    const registration =
      navigator.serviceWorker.controller?.scriptURL === url.href
        ? await navigator.serviceWorker.ready
        : await navigator.serviceWorker.register(url.href, {
            scope: "./",
            updateViaCache: "none",
          });
    updateRegistration = registration;
    const show = () => {
      if (registration.waiting && navigator.serviceWorker.controller)
        $("#app-update").hidden = false;
    };
    show();
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state === "installed") show();
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (applyingUpdate) location.reload();
    });
    registration.update().catch(() => {});
  } catch (e) {
    console.warn("service worker", e);
  }
}
function moveTabSelection() {
  const nav = $(".tabbar"),
    active = nav?.querySelector(".tab-button.active"),
    pill = nav?.querySelector(".tab-selection");
  if (!nav || !active || !pill) {
    nav?.classList.remove("tab-ready");
    return;
  }
  const rect = active.getBoundingClientRect(),
    parent = nav.getBoundingClientRect();
  pill.style.width = `${rect.width}px`;
  pill.style.transform = `translate3d(${rect.left - parent.left}px,0,0)`;
  nav.classList.add("tab-ready");
}
function syncTab(tab) {
  state.tab = tab;
  $("#view-subtitle").textContent =
    tab === "now" ? "現在地に合わせて周辺案内" : "My Map";
  if (tab === "now") {
    renderNow();
    arrivals?.show();
  } else arrivals?.pause();
  if (tab === "timetable") timetables?.show();
  if (tab === "operations") operations?.show();
  if (tab === "settings") renderSettings();
  requestAnimationFrame(moveTabSelection);
}
function setTab(tab) {
  navigation.selectTab(tab);
  haptic();
}
function setupEvents() {
  setupNowInteractions();
  setupContextSheet(renderNow, openFoldback);
  $(".tabbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) setTab(b.dataset.tab);
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.stationDetail)
      navigation.push("station", {
        stopId: b.dataset.stationDetail,
        journey: state.ride ? rideKey(state.ride) : null,
      });
    else if (b.hasAttribute("data-board-armed")) {
      if (state.armedJourney) boardRide(state.armedJourney.ride);
    } else if (b.hasAttribute("data-cancel-armed")) {
      state.armedJourney = null;
      renderNow();
    } else if (b.dataset.contextAction === "destination")
      destinationSheet(state.heroModel?.bus);
    else if (b.dataset.nearbyDetail)
      navigation.push("nearby", { stopId: b.dataset.nearbyDetail });
    else if (b.hasAttribute("data-open-settings")) setTab("settings");
    else if (b.dataset.contextAction === "map")
      navigation.push("map", {
        journey: state.ride ? rideKey(state.ride) : null,
      });
    else if (b.dataset.contextAction === "delay")
      navigation.push("delay", {
        journey: state.ride ? rideKey(state.ride) : null,
      });
    else if (b.hasAttribute("data-apply-update")) {
      if (updateRegistration?.waiting) {
        persistJourney(true);
        applyingUpdate = true;
        b.disabled = true;
        b.textContent = "更新中…";
        updateRegistration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
      }
    } else if (b.hasAttribute("data-retry-nearby")) {
      b.disabled = true;
      await ensureSubwayFeed(true);
      renderNow();
    } else if (b.hasAttribute("data-start-foldback")) {
      const plan = state.foldbackPlan,
        key = state.ride;
      b.disabled = true;
      try {
        const ride = await foldbackJourney(plan, {
          network: state.network,
          subwayFeed: await ensureSubwayFeed(),
          signal: AbortSignal.timeout(20000),
        });
        if (state.ride === key && state.foldbackPlan === plan) boardRide(ride);
      } catch (error) {
        toast(error.message);
      } finally {
        if (b.isConnected) b.disabled = false;
      }
    } else if (b.hasAttribute("data-retry-location"))
      state.locationSession?.start({ retry: true });
    else if (b.dataset.openTimetable) {
      timetables.select(b.dataset.openTimetable);
    } else if (b.dataset.openArrivals) {
      $("#context-sheet").close();
      navigation.push("arrivals", { stopId: b.dataset.openArrivals });
    } else if (b.dataset.startHere) {
      $("#context-sheet").close();
      routeSearch?.setFrom(b.dataset.startHere);
    } else if (b.dataset.rideCandidate !== undefined) {
      if (confirmRideCandidate(b.dataset.rideCandidate)) renderNow();
    } else if (b.id === "ride-foldback" || b.hasAttribute("data-open-foldback"))
      openFoldback();
    else if (b.id === "ride-operations")
      navigation.push("operation", { id: state.ride?.operator });
    else if (b.id === "ride-end") {
      state.ride = null;
      state.foldbackPlan = null;
      state.rideShift = 0;
      state.rideShiftKnown = false;
      state.rideObservation = null;
      state.rideConfidence = 0;
      state.rideSource = null;
      resetRideDetection();
      persistJourney(true);
      navigation.root("now");
      renderNow();
      arrivals?.show();
    } else if (b.id === "network-refresh") refreshNetwork();
    else if (b.id === "location-indicator")
      state.locationSession?.start({ retry: true });
  });
  document.addEventListener("visibilitychange", () => {
    document.documentElement.dataset.appHidden = String(document.hidden);
    if (document.hidden) {
      state.locationSession?.stop();
      state.locationStatus = "paused";
    } else {
      state.locationSession?.start();
      renderNow();
      if (state.tab === "now") arrivals?.show();
      if (state.tab === "operations") operations.show();
      autoDetectRide(true, renderNow);
    }
  });
  window.addEventListener("pagehide", () => {
    persistJourney(true);
    state.locationSession?.stop();
    arrivals?.pause();
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      state.locationSession?.start();
      renderNow();
      if (state.tab === "now") arrivals?.show();
    }
  });
  window.addEventListener(
    "resize",
    () => requestAnimationFrame(moveTabSelection),
    { passive: true },
  );
  setupFoldback();
}
function boardRide(ride) {
  if (!startManualRide(ride)) return false;
  navigation.root("now");
  renderNow();
  arrivals?.show();
  return true;
}
async function init() {
  $(".tabbar").innerHTML =
    '<div class="tab-selection" aria-hidden="true"></div>' +
    [
      ["now", "今"],
      ["timetable", "時刻表"],
      ["operations", "運行情報"],
      ["settings", "設定"],
    ]
      .map(
        ([id, label]) =>
          `<button class="tab-button ${id === "now" ? "active" : ""}" data-tab="${id}"${id === "settings" ? " data-open-settings" : ""} aria-current="${id === "now" ? "page" : "false"}">${icon(id)}<span>${label}</span></button>`,
      )
      .join("");
  requestAnimationFrame(moveTabSelection);
  try {
    const [catalog, geo] = await Promise.all([
      fetch("data/bus-catalog.json").then((r) => {
        if (!r.ok) throw Error("路線データを読み込めません");
        return r.json();
      }),
      fetch("data/locations.json").then((r) => {
        if (!r.ok) throw Error("位置データを読み込めません");
        return r.json();
      }),
    ]);
    state.network = createNetwork(catalog);
    state.geo = geo;
    augmentKyotoBusGeometry();
    restoreJourney();
    timetables = mountTimetables({
      network: state.network,
      getState: () => ({ favorites: [] }),
      now: tokyoNow,
      setTab,
      onBoard: boardRide,
      loadSubwayFeed: () => ensureSubwayFeed(),
    });
    routeSearch = mountRouteSearch({
      onCurrentLocation: () => {
        const stop = nearest().all[0]?.stop;
        if (!stop) toast("現在位置は未取得です。出発地を入力してください");
        return stop;
      },
      onArm: (ride) => {
        state.armedJourney = { ride, selectedAt: Date.now() };
        navigation.root("now");
        renderNow();
        const card = $(".armed-journey");
        card?.focus({ preventScroll: true });
        card?.scrollIntoView({
          block: "start",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
      },
      network: state.network,
      settings,
      tokyoNow,
      onBoard: boardRide,
    });
    operations = mountOperations();
    arrivals = mountArrivals({ network: state.network });
    renderSettings();
    setupSettings(renderNow);
    registerNowScreens({ arrivals, onFoldback: openFoldback });
    initializeNavigation({ onTabChange: syncTab, validate: validNowScreen });
    routeSearch.restoreShared();
    setupEvents();
    [$('[data-view="now"]'), $('[data-view="timetable"]')].forEach((root) =>
      root.addEventListener("click", (e) => {
        const b = e.target.closest("[data-open-search],[data-search-to]");
        if (b) routeSearch.open(b.dataset.searchTo);
      }),
    );
    document.addEventListener("mymap-navigation-change", () => {
      requestAnimationFrame(moveTabSelection);
      if (
        state.tab === "now" &&
        ["root", "arrivals"].includes(navigation.route.type)
      )
        arrivals.show();
      else arrivals.pause();
    });
    state.locationSession = createLocationSession({
      geolocation: navigator.geolocation,
      permissions: navigator.permissions,
      loadData: async () => state.geo,
      onStatus: (s) => {
        state.locationStatus = s;
        renderNow();
      },
      onPosition: (p, g) => {
        state.geo = g;
        state.fix = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          timestamp: p.timestamp,
          speed: p.coords.speed,
          heading: p.coords.heading,
        };
        state.samples = [
          ...state.samples.filter((x) => p.timestamp - x.timestamp < 120000),
          state.fix,
        ].slice(-40);
        state.location = locate(state.fix, state.geo, state.network);
        const near = nearest(),
          bus = near.all.find((s) => s.stop.type === "citybus");
        updateBusTrail(bus?.id, bus?.meters ?? Infinity);
        renderNow();
        autoDetectRide(false, renderNow);
        if (
          state.tab === "now" &&
          ["root", "arrivals"].includes(navigation.route.type)
        )
          arrivals.show();
      },
    });
    state.locationSession.start();
    renderNow();
    arrivals.show();
    setInterval(() => {
      if (document.hidden) return;
      renderNow();
      if (state.tab === "operations") operations.show();
      autoDetectRide(false, renderNow);
      if (
        state.tab !== "now" &&
        state.ride &&
        ["kintetsu", "through"].includes(state.ride.operator) &&
        Date.now() - state.railFeedAt > 18000
      )
        ensureRailFeed(true).then(renderNow);
    }, 20000);
  } catch (e) {
    console.error(e);
    $("#now-hero").innerHTML =
      `<section class="hero-card warning"><h2>起動できませんでした</h2><p>${esc(e.message)}</p><button class="primary-action" data-reload>再読み込み</button></section>`;
    document.addEventListener(
      "click",
      (ev) => {
        if (ev.target.closest("[data-reload]")) location.reload();
      },
      { once: true },
    );
  }
}
registerServiceWorker();
init();
