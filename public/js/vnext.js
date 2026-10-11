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
  toast,
} from "./vnext-state.js";
import {
  autoDetectRide,
  updateBusTrail,
  confirmRideCandidate,
  resetRideDetection,
  startManualRide,
} from "./vnext-detect.js";
import { renderNow } from "./vnext-view.js";
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
function setTab(tab) {
  if (!["now", "timetable", "operations", "settings"].includes(tab)) return;
  if (state.tab === tab) return;
  state.tab = tab;
  $$("[data-view]").forEach((v) => (v.hidden = v.dataset.view !== tab));
  $$(".tab-button").forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle("active", active);
    b.setAttribute("aria-current", active ? "page" : "false");
  });
  $("#view-title").textContent = {
    now: "今",
    timetable: "時刻表",
    operations: "運行情報",
    settings: "設定",
  }[tab];
  $("#view-subtitle").textContent =
    tab === "now" ? "現在地に合わせて自動案内" : "My Map";
  if (tab === "now") {
    renderNow();
    arrivals?.show();
  } else arrivals?.pause();
  if (tab === "timetable") routeSearch?.show();
  if (tab === "operations") operations.show();
  if (tab === "settings") renderSettings();
  requestAnimationFrame(moveTabSelection);
  window.scrollTo({ top: 0, behavior: "instant" });
  haptic();
}
function setupEvents() {
  $(".tabbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) setTab(b.dataset.tab);
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-apply-update")) {
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
      setTab("timetable");
      routeSearch?.openBoard();
      timetables.select(b.dataset.openTimetable);
    } else if (b.dataset.openArrivals) {
      setTab("now");
      await arrivals?.selectStop(b.dataset.openArrivals, true);
    } else if (b.dataset.startHere) {
      setTab("timetable");
      routeSearch?.setFrom(b.dataset.startHere);
    } else if (b.dataset.rideCandidate !== undefined) {
      if (confirmRideCandidate(b.dataset.rideCandidate)) renderNow();
    } else if (b.id === "ride-foldback" || b.hasAttribute("data-open-foldback"))
      openFoldback();
    else if (b.id === "ride-operations") setTab("operations");
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
      renderNow();
      arrivals?.show();
    } else if (b.id === "network-refresh") refreshNetwork();
    else if (b.id === "location-indicator")
      state.locationSession?.start({ retry: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
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
  setTab("now");
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
          `<button class="tab-button ${id === "now" ? "active" : ""}" data-tab="${id}" aria-current="${id === "now" ? "page" : "false"}">${icon(id)}<span>${label}</span></button>`,
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
      network: state.network,
      settings,
      tokyoNow,
      onBoard: boardRide,
    });
    operations = mountOperations();
    arrivals = mountArrivals({ network: state.network });
    renderSettings();
    setupSettings(renderNow);
    setupEvents();
    state.locationSession = createLocationSession({
      geolocation: navigator.geolocation,
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
        if (state.tab === "now") arrivals.show();
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
