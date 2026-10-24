import { clearFalseRide, checkInRide } from "./vnext-detect.js";
import { openCheckIn } from "./checkin-sheet.js";
import { positionOptions, modeAllowsPip } from "./run-mode.js";
import { syncAtsDetection } from "./ats.js";
import { openAtsSheet, homeRoute } from "./ats-ui.js";
import { stopPip, togglePip, pipSupported, refreshPip } from "./pip.js";
import { requestMotionPermission, restoreMotionPermission } from "./motion-permission.js";
import { actionSheet, startProgress, endProgress } from "./ios-ui.js";
import { beginRideRecheck } from "./ride-rechecking.js";
import { ui, placeName, appLocale, userFacingError, userError } from "./locale.js";
import { rideConfirmationFacts } from "./ride-confirmation-facts.js";
import { nextSidebarTabIndex } from "./desktop-tabs-d4.js";
import { transitEvidenceEngine, transitCandidateKey } from "./transit-evidence.js";
import { formatMinute } from "./vnext-core.js";
import { mountLiveHome } from "./live-home.js";
import { readSavedPlaces } from "./saved-places.js";
import { createNetwork } from "./network.js";
import { startEnglishNames } from "./english-names.js";
import { locate } from "./mobility.js";
import { createLocationSession } from "./location-session.js";
import { mountTimetables, mountOperations } from "./timetable-ui.js";
import { readSearchPairs } from "./search-history.js";
import { mountRouteSearch } from "./route-search-ui.js";
import {
  $,
  $$,
  esc,
  icon,
  state,
  settings,
  saveSettings,
  tokyoNow,
  augmentKyotoBusGeometry,
  ensureRailFeed,
  ensureSubwayFeed,
  nearest,
  persistJourney,
  restoreJourney,
  rideKey,
  toast,
  serviceName,
} from "./vnext-state.js";
import {
  autoDetectRide,
  updateBusTrail,
  confirmRideCandidate,
  resetRideDetection,
  startManualRide,
  finishCurrentRide,
  chooseRideCandidates,
  confirmThroughContinuation,
} from "./vnext-detect.js";
import { renderNow, setupNowInteractions, rideChoiceRowsHTML } from "./vnext-view.js";
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
import { boardingAvailable } from "./journey-session.js";

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
function primaryRootTitle(tab) {
  const english = document.documentElement.lang === "en";
  if (tab === "now") return english ? "Now" : "今";
  if (tab === "settings") return english ? "Settings" : "設定";
  return null;
}
function syncPrimaryRootTitle() {
  if (navigation.route.type !== "root") return;
  const title = primaryRootTitle(state.tab);
  if (title) $("#view-title").textContent = title;
}
function syncTab(tab) {
  state.tab = tab;
  $(".app-shell").dataset.activeTab = tab;
  if (tab !== "now") $(".app-shell").dataset.nowHome = "false";
  $("#view-subtitle").textContent = tab === "now" ? "MyMap" : "MyMap";
  if (tab === "now") {
    renderNow();
    arrivals?.show();
  } else arrivals?.pause();
  if (tab === "timetable") timetables?.show();
  if (tab === "operations") operations?.show();
  if (tab === "settings") renderSettings();
  requestAnimationFrame(() => {
    moveTabSelection();
    syncPrimaryRootTitle();
  });
}
function setTab(tab) {
  navigation.selectTab(tab);
}
async function openRideChooser() {
  startProgress("ride-chooser");
  try {
    await presentRideChooser();
  } finally {
    endProgress("ride-chooser");
  }
}
async function presentRideChooser() {
  const sheet = $("#context-sheet");
  sheet.dataset.detent = "medium";
  openContextSheet(
    ui("choose_ride_title"),
    `<section class="section-block ride-chooser" aria-busy="true"><p class="source-note" role="status">${esc(ui("choose_ride_loading"))}</p></section>`,
  );
  const candidates = await chooseRideCandidates(),
    section = sheet.querySelector(".ride-chooser");
  if (!section?.isConnected || !sheet.open) return;
  section.removeAttribute("aria-busy");
  section.innerHTML = candidates.length
    ? `<div class="ride-choice-list native-list">${rideChoiceRowsHTML(candidates)}</div><p class="source-caption">${esc(ui("choose_ride_note"))}</p>`
    : `<p class="empty-state" role="status">${esc(ui("choose_ride_empty"))}</p>`;
}
function openRideCandidateConfirmation(index) {
  const candidate = state.rideCandidates[Number(index)];
  if (!candidate) return;
  const key = transitCandidateKey(candidate.ride);
  const fact = rideConfirmationFacts(
    candidate, transitEvidenceEngine.support(candidate.ride)
  );
  const stage = ui({
    "route-verified": "b2_confirm_route",
    motion: "b2_confirm_motion",
    "not-verified": "b2_confirm_unverified",
  }[fact.stage]);
  const row = (label, value) =>
    `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  const details = [
    row(ui("b2_confirm_from"), fact.boarding ?? ui("b2_confirm_unset")),
    row(ui("b2_confirm_departure"), Number.isFinite(fact.departure)
      ? formatMinute(fact.departure) : "—"),
    row(ui("b2_confirm_alight"), fact.alighting ?? ui("b2_confirm_unset")),
  ].join("");
  openContextSheet(
    ui("b2_confirm_board"),
    `<section class="section-block ride-confirmation" data-confirmation-stage="${esc(fact.stage)}"><span class="section-label">${esc(serviceName(candidate.ride))}</span><h2>${esc(placeName(fact.destination) ?? ui("vnext_view_049"))}</h2><p class="source-note" role="status">${esc(stage)}</p><dl class="context-facts">${details}</dl><details class="confidence"><summary>${esc(ui("b2_confirm_source"))}</summary><p>${esc(fact.source)}</p>${fact.score === null ? "" : `<p>${esc(ui("b2_confirm_score"))}: ${fact.score}/100</p>`}</details><p class="source-caption">${esc(ui("b2_confirm_explain"))}</p><div class="screen-action-group"><button type="button" class="primary-action" data-confirm-ride-candidate="${esc(key)}">${esc(ui("b2_confirm_start"))}</button><button type="button" class="secondary-action" data-context-close>${ui("static_close")}</button></div></section>`,
  );
}
function setupEvents() {
  setupNowInteractions();
  setupContextSheet(renderNow, openFoldback);
  const tabbar = $(".tabbar");
  tabbar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) setTab(b.dataset.tab);
  });
  tabbar.addEventListener("keydown", (e) => {
    if (!matchMedia("(min-width: 1024px) and (pointer: fine)").matches ||
        e.altKey || e.ctrlKey || e.metaKey || e.shiftKey ||
        !(e.target instanceof Element)) return;
    const focused = e.target.closest(".tab-button[data-tab]");
    if (!focused) return;
    const tabs = [...tabbar.querySelectorAll(".tab-button[data-tab]")];
    const next = nextSidebarTabIndex(e.key, tabs.indexOf(focused), tabs.length);
    if (next === null) return;
    e.preventDefault();
    const destination = tabs[next];
    // Navigation intentionally focuses new screen content. Keyboard
    // navigation from the desktop rail instead keeps the rail as the
    // interaction context, including after the asynchronous transition.
    document.addEventListener("mymap-navigation-change", () => {
      if (destination.isConnected &&
          navigation.tab === destination.dataset.tab &&
          matchMedia("(min-width: 1024px) and (pointer: fine)").matches)
        destination.focus({ preventScroll: true });
    }, { once: true });
    destination.focus({ preventScroll: true });
    destination.click();
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
      state.itinerary = null;
      persistJourney(true);
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
        b.textContent = ui("vnext_001");
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
        toast(userError(error));
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
    } else if (b.hasAttribute("data-correct-ride")) {
      beginRideRecheck("manual");
      renderNow();
      void autoDetectRide(true, renderNow);
    } else if (b.dataset.throughContinue !== undefined) {
      if (confirmThroughContinuation(Number(b.dataset.throughContinue))) {
        haptic();
        renderNow();
      }
    } else if (b.hasAttribute("data-ats-open")) {
      openAtsSheet(renderNow);
    } else if (b.dataset.atsArrivals) {
      navigation.push("nearby", { stopId: b.dataset.atsArrivals });
    } else if (b.hasAttribute("data-ats-choose")) {
      openRideChooser();
    } else if (b.hasAttribute("data-ats-checkin")) {
      openCheckIn(checkInAndShow);
    } else if (b.hasAttribute("data-ats-plan")) {
      routeSearch?.open();
    } else if (b.dataset.atsRoute !== undefined) {
      const pair = homeRoute(Number(b.dataset.atsRoute)),
        now = tokyoNow();
      if (pair) routeSearch?.openInput({ ...pair, date: now.date, time: now.time, timeMode: "departure" });
    } else if (b.hasAttribute("data-choose-ride")) {
      openRideChooser();
    } else if (b.hasAttribute("data-checkin")) {
      openCheckIn(checkInAndShow);
    } else if (b.hasAttribute("data-enable-motion")) {
      void requestMotionPermission().then(() => renderNow());
    } else if (b.hasAttribute("data-not-riding")) {
      clearFalseRide();
      renderNow();
    } else if (b.dataset.confirmRideCandidate !== undefined) {
      const index = state.rideCandidates.findIndex(
        (candidate) => transitCandidateKey(candidate.ride) === b.dataset.confirmRideCandidate,
      );
      if (index >= 0 && confirmRideCandidate(index)) {
        $("#context-sheet")?.close();
        renderNow();
      }
    } else if (b.dataset.rideCandidate !== undefined) {
      openRideCandidateConfirmation(b.dataset.rideCandidate);
    } else if (b.id === "ride-foldback" || b.hasAttribute("data-open-foldback"))
      openFoldback();
    else if (b.id === "ride-operations")
      navigation.push("operation", { id: state.ride?.operator });
    else if (b.id === "ride-end") {
      // Ending guidance is destructive: confirm with an action sheet.
      void actionSheet({
        title: ui("ride_end_title"),
        message: ui("ride_end_message"),
        actions: [
          { id: "end", label: ui("ride_end_confirm"), role: "destructive" },
        ],
      }).then((choice) => {
        if (choice !== "end" || !state.ride) return;
        finishCurrentRide();
        navigation.root("now");
        renderNow();
        arrivals?.show();
      });
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
  const networkState = () => {
    const offline = navigator.onLine === false;
    $("#network-status").hidden = !offline;
    renderNow();
    if (state.tab === "operations") void operations.show();
  };
  window.addEventListener("offline", networkState);
  window.addEventListener("online", networkState);
  networkState();
  setupFoldback();
}
function boardRide(ride, itinerary) {
  if (itinerary && boardingAvailable(ride, tokyoNow()))
    state.itinerary = itinerary;
  if (!startManualRide(ride)) return false;
  navigation.root("now");
  renderNow();
  arrivals?.show();
  return true;
}
function checkInAndShow(ride) {
  if (!checkInRide(ride)) return false;
  navigation.root("now");
  renderNow();
  arrivals?.show();
  return true;
}
function advancePlannedJourney() {
  if (state.itinerary?.phase === "riding")
    finishCurrentRide({ keepItinerary: true });
  else if (state.itinerary?.phase === "walking") {
    state.itinerary = { ...state.itinerary, phase: "arrived" };
    persistJourney(true);
  } else return;
  navigation.root("now");
  renderNow();
  arrivals?.show();
}
function savedTransitStopIds() {
  try {
    const supported = new Set(["subway", "kintetsu", "citybus", "kyotobus"]);
    return [
      ...new Set([
        ...readSavedPlaces(),
        ...readSearchPairs(localStorage).favorites.flatMap((pair) => [
          pair.fromId,
          pair.toId,
        ]),
      ]),
    ]
      .filter((id) => supported.has(state.network.stops.get(id)?.type))
      .slice(0, 10);
  } catch {
    return [];
  }
}
async function init() {
  $(".tabbar").innerHTML =
    '<div class="tab-selection" aria-hidden="true"></div>' +
    [
      ["now", document.documentElement.lang === "en" ? "Now" : "今"],
      ["search", ui("vnext_002")],
      ["timetable", ui("vnext_003")],
      ["operations", ui("vnext_004")],
      [
        "settings",
        document.documentElement.lang === "en" ? "Settings" : "設定",
      ],
    ]
      .map(
        ([id, label]) =>
          `<button class="tab-button ${id === "now" ? "active" : ""}" data-tab="${id}"${id === "settings" ? " data-open-settings" : ""} aria-current="${id === "now" ? "page" : "false"}">${icon(id === "settings" ? "more" : id)}<span>${label}</span></button>`,
      )
      .join("");
  requestAnimationFrame(moveTabSelection);
  try {
    const [catalog, geo] = await Promise.all([
      fetch("data/bus-catalog.json").then((r) => {
        if (!r.ok) throw userFacingError(ui("vnext_006"));
        return r.json();
      }),
      fetch("data/locations.json").then((r) => {
        if (!r.ok) throw userFacingError(ui("vnext_007"));
        return r.json();
      }),
    ]);
    state.network = createNetwork(catalog);
    if (appLocale(settings) === "en") startEnglishNames();
    state.geo = geo;
    augmentKyotoBusGeometry();
    restoreJourney();
    timetables = mountTimetables({
      network: state.network,
      getState: () => ({ favorites: savedTransitStopIds() }),
      getNearby: () => nearest().all,
      now: tokyoNow,
      setTab,
      onBoard: boardRide,
      loadSubwayFeed: () => ensureSubwayFeed(),
    });
    routeSearch = mountRouteSearch({
      onCurrentLocation: ({ silent = false } = {}) => {
        const stop = nearest().all[0]?.stop;
        if (!stop && !silent) toast(ui("vnext_008"));
        return stop;
      },
      onArm: (ride, itinerary) => {
        state.itinerary = itinerary ?? null;
        state.armedJourney = { ride, selectedAt: Date.now() };
        persistJourney(true);
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
      getItinerary: () => state.itinerary,
      getCurrentRide: () => state.ride,
      getRecoveryStop: () => state.heroModel?.nextStation?.id,
      getRideDelay: () => (state.rideShiftKnown ? state.rideShift : 0),
      onItineraryAdvance: advancePlannedJourney,
      onItineraryUpdate: (plan) => {
        state.itinerary = plan;
        if (state.armedJourney && plan.phase !== "riding")
          state.armedJourney = {
            ride: plan.rides[plan.legIndex],
            selectedAt: Date.now(),
          };
        persistJourney(true);
        renderNow();
      },
    });
    operations = mountOperations({
      getFavorites: () => settings.favoriteOperations,
      setFavorites: (ids) => {
        settings.favoriteOperations = ids;
        saveSettings();
      },
      onReplan: (avoid) => routeSearch.replan(avoid, { review: !avoid.length }),
      getCurrentOperators: () =>
        [
          state.ride?.operator === "through"
            ? "through"
            : (state.ride?.operatingCompany ?? state.ride?.operator),
          ...(state.itinerary?.route.legs ?? [])
            .filter((l) => l.kind === "ride")
            .map((l) =>
              l.operator === "through"
                ? "through"
                : (l.operatingCompany ?? l.operator),
            ),
        ].filter(Boolean),
      getUsedOperators: () =>
        [
          state.ride?.operator === "through"
            ? "through"
            : (state.ride?.operatingCompany ?? state.ride?.operator),
          ...(state.itinerary?.route.legs ?? [])
            .filter((l) => l.kind === "ride")
            .map((l) => l.operator),
          ...(
            (navigation.recalled("search-data") ?? []).at(-1)?.routes ?? []
          ).flatMap((r) =>
            r.legs.filter((l) => l.kind === "ride").map((l) => l.operator),
          ),
        ].filter(Boolean),
    });
    arrivals = mountArrivals({ network: state.network });
    renderSettings();
    setupSettings(renderNow, (input) => routeSearch.openInput(input));
    registerNowScreens({ arrivals, onFoldback: openFoldback });
    syncAtsDetection();
    mountLiveHome($("#now-search"), routeSearch);
    initializeNavigation({ onTabChange: syncTab, validate: validNowScreen });
    syncPrimaryRootTitle();
    routeSearch.restoreShared();
    setupEvents();
    document.addEventListener("mymap-itinerary-replan", (event) => {
      routeSearch.replan([], event.detail);
    });
    $('[data-view="now"]').addEventListener("click", (event) => {
      if (event.target.closest("[data-open-itinerary]"))
        navigation.push("journey");
      if (event.target.closest("[data-itinerary-next]"))
        advancePlannedJourney();
    });
    [$('[data-view="now"]'), $('[data-view="timetable"]')].forEach((root) =>
      root.addEventListener("click", (e) => {
        const b = e.target.closest("[data-open-search],[data-search-to]");
        if (b) routeSearch.open(b.dataset.searchTo);
      }),
    );
    document.addEventListener("mymap-navigation-change", () => {
      syncPrimaryRootTitle();
      requestAnimationFrame(moveTabSelection);
      if (
        navigation.route.type === "arrivals" ||
        (state.tab === "now" && navigation.route.type === "root")
      )
        arrivals.show();
      else arrivals.pause();
    });
    state.locationSession = createLocationSession({
      geolocation: navigator.geolocation,
      permissions: navigator.permissions,
      positionOptions: () => positionOptions(),
      loadData: async () => state.geo,
      onStatus: (s) => {
        const changed = state.locationStatus !== s;
        state.locationStatus = s;
        if (changed && s !== "active") renderNow();
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
          navigation.route.type === "arrivals" ||
          (state.tab === "now" && navigation.route.type === "root")
        )
          arrivals.show();
      },
    });
    document.addEventListener("mymap-ride-prediction", () => renderNow());
    // A new mode restarts location with its accuracy and stops/starts
    // detection and Picture in Picture accordingly.
    document.addEventListener("mymap-run-mode", () => {
      // The mode caps the ATS level; detection follows the level.
      syncAtsDetection();
      saveSettings();
      state.locationSession?.stop();
      if (!document.hidden) state.locationSession?.start({ retry: true });
      if (!settings.autoDetect) resetRideDetection();
      if (!modeAllowsPip()) stopPip();
      renderNow();
    });
    document.addEventListener("mymap-ats-level", () => {
      if (!settings.autoDetect) resetRideDetection();
      renderNow();
    });
    document.addEventListener("mymap-ats-home", () => renderNow());
    document.addEventListener("mymap-motion-permission", () => renderNow());
    document.addEventListener("mymap-choose-ride", () => openRideChooser());
    document.addEventListener("mymap-checkin", () => openCheckIn(checkInAndShow));
    document.addEventListener("mymap-transit-evidence", () => {
      renderNow();
      void autoDetectRide(true, renderNow);
    });
    document.addEventListener("mymap-live-refresh", (event) => {
      void arrivals.show();
      event.detail?.waitUntil?.(Promise.all([arrivals.refreshBus(), arrivals.refreshRail()]));
      renderNow();
    });
    window.addEventListener("online", () => {
      if (document.hidden) return;
      void autoDetectRide(true, renderNow);
      if (state.tab === "now") void arrivals.show();
      if (state.tab === "operations") void operations.show();
      renderNow();
    });
    restoreMotionPermission(document);
    state.locationSession.start();
    renderNow();
    arrivals.show();
    // Underground no GPS fixes arrive to drive detection; poll briefly so
    // accelerometer and announcement evidence are evaluated (gated inside).
    setInterval(() => {
      if (!document.hidden && !state.ride) autoDetectRide(false, renderNow);
    }, 5000);
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
    $("#now-hero").innerHTML = ui("vnext_009", [esc(userError(e))]);
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