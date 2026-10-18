import { ui } from "./locale.js";
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
    updateHTML(panel, ui("vnext_network_view_001", [icon("refresh")]));
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
    updateHTML(container, ui("vnext_network_view_002"));
  updateTrainTrack(container, ride, trains, now);
  updateHTML(
    container.querySelector(".live-track-rows"),
    ui("vnext_network_view_003", [trainRows(same), trainRows(opposite)]),
  );
}
function trainRows(trains) {
  if (!trains.length) return ui("vnext_network_view_004");
  return `<div class="train-rows">${trains.map((t) => `<div class="train-row"><span class="train-arrow">${t.direction === "north" ? "←" : "→"}</span><div><b>${dot(t.estimated ? "prediction" : "live")}${esc(t.label ?? (t.category === "express" ? ui("vnext_network_view_005") : ui("vnext_network_view_006")))}</b><small>${esc(state.network.stops.get(t.from)?.name ?? t.from)} ${t.atStation ? ui("vnext_network_view_007") : "〜"} ${esc(state.network.stops.get(t.to)?.name ?? t.to)}</small></div><span class="delay ${t.delay ? "late" : ""}">${t.delay === null ? "—" : t.delay ? ui("vnext_network_view_008", [t.delay]) : ui("vnext_network_view_009")}</span></div>`).join("")}</div>`;
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
      t.key === ahead
        ? ui("vnext_network_view_010")
        : opposite
          ? ui("vnext_network_view_011")
          : ui("vnext_network_view_012");
    el.style.left = `${Math.max(3, Math.min(97, (t.position / Math.max(1, axis.length - 1)) * 100))}%`;
    el.setAttribute(
      "aria-label",
      `${opposite ? ui("vnext_network_view_013") : t.key === ahead ? ui("vnext_network_view_014") : ui("vnext_network_view_015")} ${t.label ?? ui("vnext_network_view_016")} ${t.estimated ? ui("vnext_network_view_017") : ui("vnext_network_view_018")}`,
    );
    old.delete(t.key);
  }
  old.forEach((e) => e.remove());
  track.setAttribute(
    "aria-label",
    ui("vnext_network_view_083", [
      progress.source === "location"
        ? ui("vnext_network_view_019")
        : ui("vnext_network_view_020"),
    ]),
  );
  updateHTML(
    container.querySelector(".live-track-source"),
    ui("vnext_network_view_084", [
      progress.source === "location"
        ? ui("vnext_network_view_021")
        : ui("vnext_network_view_022"),
      trains.length
        ? ui("vnext_network_view_023")
        : ui("vnext_network_view_024"),
    ]),
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
  return ui("vnext_network_view_085", [
    settings.debugLive ? "" : "hidden",
    ARRIVAL_INTERVAL / 1000,
    rows
      .map(
        (r) =>
          `<div><b>${esc(r.key)}</b><span>${esc(r.source ?? "—")} · ${r.freshness ? new Date(r.freshness).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}${r.error ? ` · ${esc(r.error)}` : ""}</span></div>`,
      )
      .join("") || ui("vnext_network_view_025"),
  ]);
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
    return ui("vnext_network_view_026");
  const entries = nearest().all,
    count = entries.filter(
      (s) => s.stop.type === "subway" && s.meters <= settings.railGuideDistance,
    ).length;
  if (!entries.length) return ui("vnext_network_view_027");
  return ui("vnext_network_view_028", [settings.railGuideDistance, count]);
}
export function renderSettings(
  root = $("#settings-content"),
  category = "home",
) {
  if (category === "home") {
    const symbols = {
      pass: "ticket",
      distance: "location",
      notifications: "bell",
      auto: "bolt",
      location: "location",
      display: "display",
      accessibility: "accessibility",
      routes: "train",
      info: "info",
      privacy: "shield",
      terms: "document",
      advanced: "settings",
      permissions: "info",
      places: "bookmark",
    };
    const row = (id, title, saved = false) =>
      `<button class="native-row settings-menu-row" ${saved ? "data-saved-page" : "data-setting-page"}="${id}"><span class="settings-menu-symbol">${icon(saved && id === "routes" ? "map" : (symbols[id] ?? "map"))}</span><span>${title}</span><span class="chevron">›</span></button>`;
    root.innerHTML = ui("vnext_network_view_086", [
      row("pass", ui("vnext_network_view_029")),
      row("distance", ui("vnext_network_view_030")),
      row("notifications", ui("vnext_network_view_031")),
      row("auto", ui("vnext_network_view_032")),
      row("location", ui("vnext_network_view_033")),
      row("display", ui("vnext_network_view_034")) +
        row("accessibility", ui("setting_accessibility")),
      row("routes", ui("vnext_network_view_035")),
      row("info", ui("vnext_network_view_036")),
      row("privacy", ui("vnext_network_view_037")),
      row("terms", ui("vnext_network_view_038")),
      row("advanced", ui("vnext_network_view_039")),
      row("permissions", ui("vnext_network_view_040")),
      row("places", ui("settings_saved_places"), true),
      row("routes", ui("settings_saved_routes"), true),
    ]);
    return;
  }
  if (category === "privacy") {
    root.innerHTML = ui("vnext_network_view_041");
    return;
  }
  if (category === "terms") {
    root.innerHTML = ui("vnext_network_view_042");
    return;
  }
  if (category === "permissions") {
    root.innerHTML = ui("vnext_network_view_087", [
      esc(state.locationStatus),
      typeof Notification === "undefined"
        ? ui("vnext_network_view_043")
        : Notification.permission === "granted"
          ? ui("vnext_network_view_044")
          : ui("vnext_network_view_045"),
      settings.audioAssist !== false ? "checked" : "",
      globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition
        ? ui("vnext_network_view_046")
        : ui("vnext_network_view_047"),
      esc(new URL(import.meta.url).searchParams.get("v") ?? "development"),
    ]);
    for (const name of ["geolocation", "microphone"])
      navigator.permissions
        ?.query({ name })
        .then((status) => {
          const el = root.querySelector(`[data-permission="${name}"]`);
          if (el)
            el.textContent =
              {
                granted: ui("vnext_network_view_048"),
                prompt: ui("vnext_network_view_049"),
                denied: ui("vnext_network_view_050"),
              }[status.state] ?? ui("vnext_network_view_051");
        })
        .catch(() => {
          const el = root.querySelector(`[data-permission="${name}"]`);
          if (el) el.textContent = ui("vnext_network_view_052");
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
    root.innerHTML = ui("vnext_network_view_053", [
      settings.alightAssist !== false ? "checked" : "",
      settings.notifications ? "checked" : "",
    ]);
    return;
  }
  if (category === "display" || category === "accessibility") {
    root.innerHTML = ui("vnext_network_view_054", [
      [1, 1.5, 2]
        .map(
          (n) =>
            `<option value="${n}" ${Number(settings.fontScale ?? 1) === n ? "selected" : ""}>${n * 100}%</option>`,
        )
        .join(""),
      settings.highContrast ? "checked" : "",
      settings.reduceMotion ? "checked" : "",
      settings.hour12 ? "" : "selected",
      settings.hour12 ? "selected" : "",
      settings.locale === "en" ? "" : "selected",
      settings.locale === "en" ? "selected" : "",
    ]);
    return;
  }
  root.innerHTML = ui("vnext_network_view_055", [
    settings.autoDetect ? "checked" : "",
    settings.haptics ? "checked" : "",
    settings.showConfidence ? "checked" : "",
    settings.passCityBus ? "checked" : "",
    settings.passKyotoBus ? "checked" : "",
    settings.passSubway ? "checked" : "",
    subwayOptions(),
    subwayOptions(),
    esc(settings.passExpires ?? ""),
    settings.railGuideDistance,
    settings.railGuideDistance,
    distancePreview(),
    KYOTO_ROUTES.join("・"),
    CITY_ROUTES.join("・"),
    logHTML(),
  ]);
  const from = root.querySelector('[data-setting-value="passSubwayFrom"]'),
    to = root.querySelector('[data-setting-value="passSubwayTo"]');
  if (from) from.value = settings.passSubwayFrom ?? "K01";
  if (to) to.value = settings.passSubwayTo ?? "K11";
  const sections = [...root.querySelectorAll(":scope>.settings-section")];
  const categories = {
    auto: [0, ui("vnext_network_view_056")],
    advanced: [0, ui("vnext_network_view_057")],
    pass: [1, ui("vnext_network_view_058")],
    distance: [2, ui("vnext_network_view_059")],
    routes: [3, ui("vnext_network_view_060")],
    info: [4, ui("vnext_network_view_061")],
  };
  root.replaceChildren(sections[categories[category]?.[0] ?? 4]);
}
export function setupSettings(onRender, onSavedRoute) {
  const locationHome = document.querySelector('[data-view="settings"]');
  const applyDisplay = () => {
    const scale = Number(settings.fontScale);
    if ([1, 1.5, 2].includes(scale))
      document.documentElement.style.fontSize = `${scale * 100}%`;
    document.documentElement.dataset.largeText = String(scale >= 1.5);
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
        ? `<div class="native-list">${places.map((stop) => ui("vnext_network_view_062", [esc(stop.id), esc(stop.name), esc(stop.lines?.join("・")), esc(stop.id), esc(stop.name), icon(quickPlaceSymbol(settings, stop.id, stop.type)), esc(stop.id), esc(stop.name)])).join("")}</div>${places.length ? "" : ui("vnext_network_view_063")}`
        : `<div class="native-list">${pairs.map((pair, i) => ui("vnext_network_view_088", [i, esc(pair.from), esc(pair.to), pair.via?.length ? ui("vnext_network_view_064", [esc(pair.via.map((v) => v.name).join("・"))]) : "", i, esc(pair.to)])).join("")}</div>${pairs.length ? "" : ui("vnext_network_view_065")}`;
  }
  navigation.register("saved", {
    title: (r) =>
      r.params.id === "places"
        ? ui("vnext_network_view_066")
        : ui("vnext_network_view_067"),
    create({ element, route }) {
      element.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.quickSymbolPlace) {
          const id = b.dataset.quickSymbolPlace,
            sheet = $("#context-sheet");
          sheet.dataset.detent = "fit";
          openContextSheet(
            ui("vnext_network_view_068"),
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
        if (e.target.dataset.settingValue === "locale") {
          saveSettings();
          location.reload();
          return;
        }
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
          b.textContent = ui("vnext_network_view_069");
          return;
        }
        Notification.requestPermission()
          .then((permission) => {
            settings.notifications = permission === "granted";
            saveSettings();
            renderSettings(root, category);
          })
          .catch(() => {
            b.textContent = ui("vnext_network_view_070");
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
        location: ui("vnext_network_view_071"),
        auto: ui("vnext_network_view_072"),
        notifications: ui("vnext_network_view_073"),
        display: ui("vnext_network_view_074"),
        accessibility: ui("setting_accessibility"),
        pass: ui("vnext_network_view_075"),
        distance: ui("vnext_network_view_076"),
        routes: ui("vnext_network_view_077"),
        info: ui("vnext_network_view_078"),
        privacy: ui("vnext_network_view_079"),
        terms: ui("vnext_network_view_080"),
        permissions: ui("vnext_network_view_081"),
      })[r.params.id] ?? ui("vnext_network_view_082"),
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
