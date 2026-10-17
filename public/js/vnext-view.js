import { groupNearbyPlaces } from "./transit-places.js";
import { rideDetectionSession } from "./ride-detection-session.js";
import { ui } from "./locale.js";
import {
  groupCityBusRows,
  normalizedBusSources,
  busDirectionLabel,
  busArrivalText,
} from "./arrival-stability.js";
import { isFresh } from "./realtime.js";
import { nearbyDepartures } from "./nearby-departures.js";
import { trajectory } from "./riding.js";
import { formatMinute } from "./vnext-core.js";
import {
  $,
  esc,
  icon,
  state,
  settings,
  tokyoNow,
  nearest,
  serviceName,
  modeClass,
  rideKey,
  ensureSubwayFeed,
  toast,
} from "./vnext-state.js";
import { updateRideAnchor } from "./vnext-detect.js";
import { renderNetworkPanel } from "./vnext-network-view.js";
import { updateHTML, updateNearbyPanel } from "./view-rendering.js";
import { getKintetsuFeed } from "./fast-data.js";
import { heroModel, delayAnalysis, nearbyDirection } from "./now-model.js";
import { loadNorth3Snapshot, north3Board, north3Day } from "./north3-feed.js";
import {
  nextStationHero,
  timelineRow,
  itinerarySummary,
} from "./now-components.js";
import {
  routeMapModel,
  routeMapHTML,
  renderRouteMap,
  setupRouteMaps,
} from "./route-map.js";
import { routeConfigFor } from "./bus-routes.js";
import { navigation } from "./navigation.js";
import { stateChange, updateMeaning } from "./navigation-motion.js";
import { resolveNowState } from "./ride-state-resolver.js";
import {
  journeyProgress,
  stopTime,
  assessFoldback,
  journeyClock,
} from "./journey-core.js";

const stopSources = new WeakMap();
let context = null,
  nearbyRequest = null,
  nearbyAttempt = 0;
function requestNearbyFeed() {
  if (
    nearbyRequest ||
    Date.now() - nearbyAttempt < 60000 ||
    state.subwayFeedDate === tokyoNow().date
  )
    return;
  nearbyAttempt = Date.now();
  nearbyRequest = ensureSubwayFeed().finally(() => {
    nearbyRequest = null;
    if (!state.ride && state.tab === "now") renderNow();
  });
}
let nearbyRailFeed = null,
  nearbyRailDate = null,
  nearbyRailJob = null,
  nearbyRailAttempt = 0;
function kintetsuDepartureHTML(stop) {
  const now = tokyoNow();
  if (nearbyRailDate !== now.date) {
    if (
      !nearbyRailJob &&
      Date.now() - nearbyRailAttempt > 60000 &&
      !document.querySelector('[data-view="now"]').hidden
    ) {
      nearbyRailAttempt = Date.now();
      nearbyRailJob = getKintetsuFeed(now.date)
        .then((feed) => {
          nearbyRailFeed = feed;
          nearbyRailDate = now.date;
          if (state.tab === "now" && !state.ride) renderNow();
        })
        .catch(() => {})
        .finally(() => (nearbyRailJob = null));
    }
    return ui("vnext_view_001");
  }
  const rows = [];
  for (const service of nearbyRailFeed?.services ?? []) {
    const index = service.stops.indexOf(stop.id);
    if (index < 0 || index === service.stops.length - 1) continue;
    for (const trip of service.trips ?? []) {
      const depart = trip.departures?.[index] ?? trip.arrivals?.[index];
      if (
        trip.date !== now.date ||
        !Number.isFinite(depart) ||
        depart < now.minute ||
        depart > now.minute + 60
      )
        continue;
      rows.push({
        depart,
        category: trip.category ?? service.category,
        destination: trip.destination ?? trip.headsign ?? service.destination,
      });
    }
  }
  return `<div class="nearby-departures compact-departures">${
    rows
      .sort((a, b) => a.depart - b.depart)
      .slice(0, 2)
      .map((e) =>
        ui("vnext_view_095", [
          e.category === "express"
            ? ui("vnext_view_002")
            : ui("vnext_view_003"),
          e.destination ? ui("vnext_view_004", [esc(e.destination)]) : "",
          formatMinute(e.depart),
          Math.round(e.depart - now.minute),
          nearbyRailFeed.meta?.stale
            ? ui("vnext_view_005")
            : ui("vnext_view_006"),
        ]),
      )
      .join("") || ui("vnext_view_007")
  }</div>`;
}
let north3Request = null;
function north3DepartureHTML(stop, expanded = false) {
  if (!stop.lines.includes("北3")) return "";
  if (!state.north3Snapshot) {
    if (!north3Request)
      north3Request = loadNorth3Snapshot()
        .then((snapshot) => {
          state.north3Snapshot = snapshot;
          if (!state.ride) renderNow();
        })
        .catch(() => {})
        .finally(() => (north3Request = null));
    return ui("vnext_view_008");
  }
  const now = tokyoNow(),
    day = north3Day(now.date);
  if (!day) return ui("vnext_view_009");
  if (!expanded) {
    const rows = ["north", "south"]
      .flatMap((direction) => {
        const board = north3Board(
          state.north3Snapshot,
          stop.fullName ?? stop.name,
          direction,
          day,
        );
        return (board?.entries ?? [])
          .filter(
            (e) =>
              e.depart >= now.minute &&
              e.depart < now.minute + 60 &&
              !e.operatingConditions,
          )
          .map((e) => ({ ...e, direction }));
      })
      .sort((a, b) => a.depart - b.depart)
      .slice(0, 2);
    return `<div class="nearby-departures compact-departures">${rows.map((e) => ui("vnext_view_096", [e.direction === "north" ? ui("vnext_view_010") : ui("vnext_view_011"), formatMinute(e.depart), Math.round(e.depart - now.minute), e.operatingCompany === "kyotobus" ? ui("vnext_view_012") : ui("vnext_view_013")])).join("") || ui("vnext_view_014")}</div>`;
  }
  return ui("vnext_view_110", [
    ["north", "south"]
      .map((direction) => {
        const b = north3Board(
          state.north3Snapshot,
          stop.fullName ?? stop.name,
          direction,
          day,
        );
        if (!b) return "";
        const rows = b.entries
          .filter(
            (e) =>
              e.depart >= now.minute &&
              e.depart < now.minute + 60 &&
              !e.operatingConditions,
          )
          .slice(0, 2);
        return ui("vnext_view_106", [
          direction === "north" ? ui("vnext_view_015") : ui("vnext_view_016"),
          rows
            .map((e) =>
              ui("vnext_view_097", [
                formatMinute(e.depart),
                e.operatingCompany === "kyotobus"
                  ? ui("vnext_view_017")
                  : ui("vnext_view_018"),
              ]),
            )
            .join("") || ui("vnext_view_019"),
        ]);
      })
      .join(""),
  ]);
}
function directionRowsHTML(id, entries) {
  const directions = [
    ...new Map(entries.map((e) => [e.key, e.label])).entries(),
  ];
  const remembered = navigation.recalled("live-directions") ?? {},
    selected = directions.some(([key]) => key === remembered[id])
      ? remembered[id]
      : "all";
  return `${directions.length > 1 ? ui("vnext_view_098", [[["all", ui("vnext_view_020")], ...directions].map(([key, label]) => `<button type="button" data-live-direction="${esc(key)}" data-live-direction-stop="${esc(id)}" aria-pressed="${selected === key}">${esc(label)}</button>`).join("")]) : ""}<div class="nearby-departures compact-departures">${entries
    .filter((e) => selected === "all" || e.key === selected)
    .map((e) => e.html)
    .join("")}</div>`;
}
function nearbyBusHTML(stop) {
  if (stop.type !== "citybus") return north3DepartureHTML(stop);
  const data = state.busLive;
  if (data?.stop !== (stop.fullName ?? stop.name))
    return north3DepartureHTML(stop);
  const rows = groupCityBusRows(normalizedBusSources(data))
    .filter((r) =>
      (r.arrivals ?? [r]).some(
        (a) => Number.isFinite(a.minutes) || Number.isFinite(a.stopsAway),
      ),
    )
    .slice(0, 2);
  const observed = data.source === "live" && !data.stale && isFresh(data.asOf);
  return rows.length
    ? directionRowsHTML(
        stop.id,
        rows.map((r) => ({
          key: r.dest,
          label: busDirectionLabel(r.route, r.dest),
          html: `<div class="live-nearby-arrival" data-operator="citybus"><span><b class="transport-badge">${esc(r.route)}</b> ${esc(busDirectionLabel(r.route, r.dest))}${r.boarding ? `<small>${esc(r.boarding)}</small>` : ""}</span><b class="${observed && r.source === "live" && r.arrivals?.[0]?.stopsAway === 1 ? "live-arrival-imminent" : ""}">${esc(busArrivalText({ ...r, arrivals: r.arrivals?.slice(0, 1) }))}<small>${!navigator.onLine ? ui("vnext_view_021") : r.source === "schedule" ? ui("vnext_view_022") : observed && r.source === "live" ? ui("vnext_view_023") : ui("vnext_view_024")}</small></b></div>`,
        })),
      )
    : north3DepartureHTML(stop);
}
function departureHTML(stopId, expanded = false) {
  const now = tokyoNow(),
    feed = state.subwayFeedDate === now.date ? state.subwayFeed : null;
  if (!feed)
    return `<div class="nearby-departures"><p class="source-note">${nearbyRequest ? ui("vnext_view_025") : ui("vnext_view_026")}${!nearbyRequest ? ui("vnext_view_027") : ""}</p></div>`;
  const groups = nearbyDepartures(feed, stopId, now);
  if (!expanded) {
    const populated = groups.filter((g) => g.entries.length);
    if (!populated.length) return ui("vnext_view_028");
    return directionRowsHTML(
      stopId,
      populated.map((g) => {
        const e = g.entries[0],
          label =
            g.direction === "north"
              ? ui("vnext_view_029")
              : ui("vnext_view_030");
        return {
          key: g.direction,
          label,
          html: ui("vnext_view_031", [
            label,
            formatMinute(e.depart),
            Math.max(0, Math.round(e.depart - now.minute)),
          ]),
        };
      }),
    );
  }

  return ui("vnext_view_107", [
    groups
      .map(
        (g) =>
          `<div><span>${g.direction === "north" ? ui("vnext_view_032") : ui("vnext_view_033")}</span>${g.entries.length ? (expanded ? g.entries : g.entries.slice(0, 1)).map((e) => ui("vnext_view_099", [formatMinute(e.depart), esc(e.destination ?? ui("vnext_view_034"))])).join("") : ui("vnext_view_035")}</div>`,
      )
      .join(""),
    feed.cached ? ui("vnext_view_036") : ui("vnext_view_037"),
    expanded && feed.meta?.stale ? ui("vnext_view_038") : "",
  ]);
}
function enterContext(next) {
  const view = $('[data-view="now"]'),
    changed = context !== next;
  view.dataset.context = next;
  $("#view-subtitle").textContent = "MyMap";
  if (changed) {
    const previous = context;
    context = next;
    if (
      previous &&
      !document.hidden &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      stateChange($("#now-hero"));
    }
  }
}
function renderStatusPill() {
  const b = $("#location-indicator");
  const labels = {
    active: ui("vnext_view_039"),
    loading: ui("vnext_view_040"),
    denied: ui("vnext_view_041"),
    unavailable: ui("vnext_view_042"),
    unsupported: ui("vnext_view_043"),
    disabled: "OFF",
    paused: ui("vnext_view_044"),
  };
  b.classList.toggle("active", state.locationStatus === "active");
  updateHTML(b, ui("vnext_view_045", [icon("location")]));
  const label = $("#location-status");
  if (label)
    label.textContent = labels[state.locationStatus] ?? ui("vnext_view_046");
}
function candidateHTML() {
  if (!state.rideCandidates?.length) return "";
  return ui("vnext_view_108", [
    state.rideCandidates.length === 1
      ? ui("vnext_view_047")
      : ui("vnext_view_048"),
    state.rideCandidates
      .slice(0, 3)
      .map((c, i) =>
        ui("vnext_view_100", [
          i,
          modeClass(c.ride),
          icon(
            ["citybus", "kyotobus"].includes(c.ride.operator) ? "bus" : "train",
          ),
          esc(serviceName(c.ride)),
          esc(c.ride.destination ?? ui("vnext_view_049")),
          Number.isFinite(c.ride.depart)
            ? ui("vnext_view_050", [formatMinute(c.ride.depart)])
            : "",
        ]),
      )
      .join(""),
  ]);
}
export function renderNow() {
  if (state.ride && rideDetectionSession.snapshot().phase === "idle")
    rideDetectionSession.confirm(state.ride);
  updateRideAnchor();
  renderStatusPill();
  if (state.tab !== "now") return;
  const root = $("#now-hero"),
    vehicle = $("#vehicle-panel"),
    networkPanel = $("#network-panel"),
    nearPanel = $("#nearby-panel"),
    now = journeyClock(state.ride, tokyoNow()),
    near = nearest(),
    motion = trajectory(state.samples);
  document.querySelector(".app-shell").dataset.nowHome = String(
    !state.ride &&
      !rideDetectionSession.snapshot().shell &&
      !state.armedJourney &&
      !state.itinerary,
  );
  $('[data-view="now"]').dataset.contextIdentity = state.ride
    ? rideKey(state.ride)
    : state.armedJourney
      ? `armed:${rideKey(state.armedJourney.ride)}`
      : state.itinerary
        ? `journey:${state.itinerary.phase}:${state.itinerary.legIndex}`
        : "idle";
  // Keep the onboard display usable when GPS is temporarily lost underground.
  if (state.ride) {
    enterContext(resolveNowState(state.ride));
    renderRide(root, $("#ride-stops-source"), networkPanel, nearPanel, now);
    const status = rideDetectionSession.snapshot();
    updateHTML(
      vehicle,
      `<p class="source-note" data-detection-status role="status">${ui(status.phase === "contradicting" ? "smartlive_contradicting" : "smartlive_confirmed")}</p><button type="button" class="plain-action" data-correct-ride>${ui("smartlive_correct")}</button>`,
    );
    $("#now-search").hidden = true;
    document.querySelector(".app-shell").dataset.rideMode = state.heroModel.bus
      ? "bus"
      : "rail";
    navigation.refresh();
    return;
  }
  const session = rideDetectionSession.snapshot();
  if (session.phase === "rechecking" && session.shell) {
    enterContext(resolveNowState(session.shell));
    document.querySelector(".app-shell").dataset.rideMode = session.mode;
    $('[data-view="now"]').dataset.contextIdentity = "rechecking";
    $("#now-search").hidden = true;
    updateHTML(
      root,
      `<section class="section-block" data-rechecking-shell><span class="section-label">Live</span><h2>${ui(session.mode === "bus" ? "smartlive_bus" : "smartlive_rail")}</h2><p role="status">${ui("smartlive_rechecking")}</p><p class="source-note">${ui("smartlive_unknown")}</p></section>`,
    );
    updateHTML(
      vehicle,
      `${itinerarySummary(state.itinerary, state.network)}${candidateHTML()}`,
    );
    updateHTML(
      $("#ride-actions"),
      `<button type="button" class="plain-action" data-not-riding>${ui("smartlive_not_riding")}</button>`,
    );
    updateHTML(networkPanel, "");
    updateHTML(nearPanel, "");
    navigation.refresh();
    return;
  }
  enterContext("nearby");
  delete document.querySelector(".app-shell").dataset.rideMode;
  $("#now-search").hidden = Boolean(state.armedJourney || state.itinerary);
  updateHTML($("#ride-actions"), "");
  $("#now-search").dispatchEvent(new Event("mymap-now-context"));
  updateHTML(
    vehicle,
    `${state.rideCandidates.length ? `<p class="source-note" data-detection-status role="status">${ui(rideDetectionSession.snapshot().phase === "confirming" ? "smartlive_confirming" : "smartlive_searching")}</p>` : ""}${state.armedJourney ? ui("vnext_view_101", [esc(serviceName(state.armedJourney.ride)), esc(state.armedJourney.ride.destination), esc(state.armedJourney.ride.userDestination?.name ?? ui("vnext_view_051")), itinerarySummary(state.itinerary, state.network)]) : state.itinerary ? itinerarySummary(state.itinerary, state.network) : ""}${candidateHTML()}`,
  );
  updateHTML(networkPanel, "");
  const moving = Number.isFinite(motion.speed) && motion.speed >= 2.8;
  const locationNote =
    state.locationStatus === "active"
      ? ""
      : state.locationStatus === "loading"
        ? ui("vnext_view_052")
        : ui("vnext_view_053");
  updateHTML(
    root,
    ui("vnext_view_102", [
      moving
        ? ui("vnext_view_054")
        : locationNote ||
          (near.all[0]?.meters <= 1000
            ? ui("vnext_view_055", [esc(near.all[0].stop.name)])
            : ui("vnext_view_056")),
    ]),
  );
  const nearby = near.all
    .filter(
      (s) =>
        s.meters <=
        (s.stop.type.includes("bus") ? 500 : settings.railGuideDistance),
    )
    .filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i)
    .slice(0, 4);
  if (nearby.some((s) => s.stop.type === "subway")) requestNearbyFeed();
  const arrivalsEntry = ui("vnext_view_057");
  updateNearbyPanel(
    nearPanel,
    (nearby.length
      ? ui("vnext_view_109", [
          groupNearbyPlaces(nearby, state.geo)
            .map(
              (place) =>
                `<section data-nearby-place="${esc(
                  place.rows
                    .map((s) => s.id)
                    .sort()
                    .join(":"),
                )}">${place.rows.length > 1 ? `<p class="section-label">${esc(place.name)}</p>` : ""}${place.rows
                  .map((s) =>
                    ui("vnext_view_103", [
                      esc(s.id),
                      esc(s.stop.type),
                      esc(s.id),
                      s.stop.type.includes("bus")
                        ? "bus"
                        : s.stop.type === "kintetsu"
                          ? "rail"
                          : "subway",
                      esc(s.stop.type),
                      icon(s.stop.type.includes("bus") ? "bus" : "train"),
                      {
                        subway: ui("vnext_view_058"),
                        kintetsu: ui("vnext_view_059"),
                        citybus: ui("vnext_view_060"),
                        kyotobus: ui("vnext_view_061"),
                      }[s.stop.type] ?? ui("vnext_view_062"),
                      esc(s.stop.name),
                      esc(s.stop.lines?.join("・") ?? ""),
                      Math.max(1, Math.ceil(s.meters / 70)),
                      Math.round(s.meters),
                      s.stop.type === "subway"
                        ? departureHTML(s.id)
                        : s.stop.type === "kintetsu"
                          ? kintetsuDepartureHTML(s.stop)
                          : nearbyBusHTML(s.stop),
                    ]),
                  )
                  .join("")}</section>`,
            )
            .join(""),
        ])
      : "") + arrivalsEntry,
  );
  navigation.refresh();
}
export function nearbyDetailHTML(id) {
  const stop = state.network.stops.get(id);
  if (!stop) return ui("vnext_view_063");
  return ui("vnext_view_064", [
    stop.type === "subway"
      ? departureHTML(id, true)
      : `${stop.type.includes("bus") ? '<section class="bus-stop-preview" data-bus-stop-preview></section>' : ""}${stop.type === "kintetsu" ? kintetsuDepartureHTML(stop) : ""}`,
    esc(id),
    esc(id),
  ]);
}
function renderRide(root, vehicle, networkPanel, nearPanel, now) {
  const ride = state.ride,
    bus = ["citybus", "kyotobus"].includes(ride.operator),
    shift = state.rideShift;
  const progress =
      state.rideObservation?.progress?.source === "audio"
        ? state.rideObservation.progress
        : journeyProgress(ride, {
            minute: now.minute,
            shift,
            fix: state.fix,
            geo: state.geo,
            trail: state.busTrail,
          }),
    stops = progress.stops;
  const model = heroModel(ride, progress, {
    minute: now.minute,
    shift,
    shiftKnown: state.rideShiftKnown || shift !== 0,
    fix: state.fix,
    geo: state.geo,
    locationStatus: state.locationStatus,
    feed: bus
      ? state.busLive
      : ride.operator === "subway"
        ? state.subwayFeed
        : state.railFeed,
    previous: state.heroObservation,
    motionSpeed: trajectory(state.samples).speed,
  });
  state.heroObservation = model.observed;
  state.heroModel = model;
  if (
    state.rideShiftKnown &&
    (state.delayHistory.at(-1)?.shift !== shift ||
      Date.now() - (state.delayHistory.at(-1)?.at ?? 0) >= 60000)
  )
    state.delayHistory = [
      ...state.delayHistory,
      { shift, at: Date.now() },
    ].slice(-60);
  const map = routeMapModel(ride, progress, {
    geo: state.geo,
    fix: state.fix,
    routeConfig: routeConfigFor(ride.route, ride.routeVariant),
  });
  state.routeMap = map;
  renderHero(root, nextStationHero(model, ride, progress), model);
  if (bus) {
    let section = root.querySelector(".bus-mini-map");
    if (!section) {
      section = document.createElement("section");
      section.className = "bus-mini-map";
      section.innerHTML = ui("vnext_view_065");
      root.querySelector(".personal-destination").after(section);
    }
    renderRouteMap(section.querySelector(".route-map-host"), map, model);
  }
  const known = stops.some((s) => Number.isFinite(stopTime(s)));
  const tableStops =
    !bus && ride.fullOfficialStops?.length ? ride.fullOfficialStops : stops;
  const offset = Math.max(
    0,
    tableStops.findIndex((s) => s.id === stops[0]?.id),
  );
  const tableProgress = {
    ...progress,
    stops: tableStops,
    nextIndex: progress.nextIndex + offset,
    currentIndex:
      progress.currentIndex < 0 ? -1 : progress.currentIndex + offset,
  };
  const analysis = delayAnalysis(model, state.delayHistory);
  if (settings.alightAssist !== false && model.nextIsDestination) {
    const key = `${rideKey(ride)}|${model.userDestination?.id}`;
    if (key !== lastAlertKey) {
      lastAlertKey = key;
      const message =
        model.phase === "STOPPED"
          ? ui("vnext_view_066", [model.userDestination?.name])
          : ui("vnext_view_067", [model.userDestination?.name]);
      toast(message);
      if (
        settings.notifications &&
        globalThis.Notification?.permission === "granted"
      ) {
        try {
          new Notification(ui("vnext_view_068"), {
            body: message,
            tag: "mymap-alight",
          });
        } catch {}
      }
    }
  }

  if (
    navigation.route.type === "stops" ||
    vehicle.dataset.rideKey !== rideKey(ride) ||
    stopSources.get(vehicle) !== tableStops
  ) {
    updateHTML(
      vehicle,
      ui("vnext_view_104", [
        bus ? ui("vnext_view_069") : ui("vnext_view_070"),
        esc(ride.destination ?? stops.at(-1)?.name ?? ui("vnext_view_071")),
        !bus ? ui("vnext_view_072", [icon("fold")]) : "",
        bus ? ui("vnext_view_073") : ui("vnext_view_074"),
        timeline(tableStops, tableProgress, now.minute, shift, bus, ride),
        known ? ui("vnext_view_075") : ui("vnext_view_076"),
        state.locationStatus !== "active" ? ui("vnext_view_077") : "",
        ride.operatingConditions?.schoolDayRequired ? ui("vnext_view_078") : "",
        settings.showConfidence
          ? ui("vnext_view_079", [
              Math.round(state.rideConfidence),
              esc(state.rideSource),
            ])
          : "",
      ]),
    );
    vehicle.dataset.rideKey = rideKey(ride);
    stopSources.set(vehicle, tableStops);
  }
  if (navigation.route.type === "stops") followTimeline(progress);
  if (bus) updateHTML(networkPanel, "");
  else if (navigation.route.type === "trains")
    void renderNetworkPanel(networkPanel, ride, now);
  const row = (type, label, detail) =>
    `<button class="native-row" data-navigation-screen="${type}"><span><b>${label}</b>${detail ? `<small>${detail}</small>` : ""}</span><span class="chevron">›</span></button>`;
  const action = (type, label, symbol) =>
    `<button class="ride-primary-action" data-navigation-screen="${type}" aria-label="${label}">${icon(symbol)}<span>${label}</span></button>`;
  const actionRoot = $("#ride-actions"),
    mode = bus ? "bus" : "rail";
  if (
    actionRoot.dataset.mode !== mode ||
    !actionRoot.querySelector("[data-ride-next]")
  ) {
    updateHTML(
      actionRoot,
      ui("vnext_view_105", [
        action(
          "stops",
          bus ? ui("vnext_view_080") : ui("vnext_view_081"),
          "timetable",
        ),
        action("map", ui("vnext_view_082"), "location"),
        action(
          bus ? "arrivals" : "trains",
          bus ? ui("vnext_view_083") : ui("vnext_view_084"),
          bus ? "bus" : "train",
        ),
        bus
          ? action("operation", ui("vnext_view_085"), "operations")
          : ui("vnext_view_086", [icon("fold")]),
        row("delay", ui("vnext_view_087"), null),
        bus ? "" : row("operation", ui("vnext_view_088"), null),
      ]),
    );
    actionRoot.dataset.mode = mode;
  }
  const priority = state.foldbackPlan
    ? "foldback"
    : model.delayMinutes >= 5
      ? "delay"
      : "stops";
  for (const button of actionRoot.querySelectorAll("button"))
    button.toggleAttribute(
      "data-ride-priority",
      button.dataset.navigationScreen === priority ||
        (priority === "foldback" && button.hasAttribute("data-open-foldback")),
    );
  const nextAction = actionRoot.querySelector("[data-ride-next]"),
    summary = state.foldbackPlan
      ? ""
      : itinerarySummary(
          state.itinerary,
          state.network,
          model.delayMinutes,
          state.ride,
        );
  if (summary && nextAction.querySelector(".itinerary-summary")) {
    const template = document.createElement("template");
    template.innerHTML = summary;
    updateHTML(
      nextAction.querySelector(".itinerary-summary>span"),
      template.content.querySelector(".itinerary-summary>span").innerHTML,
    );
  } else updateHTML(nextAction, summary);
  updateHTML(
    actionRoot.querySelector("[data-ride-foldback-plan]"),
    bus ? "" : foldbackPlanHTML(ride, now),
  );
  updateHTML(nearPanel, "");
}
function timeline(stops, progress, minute, shift, bus, ride) {
  if (!stops.length) return ui("vnext_view_089");
  return `<ol class="stop-list journey-stop-list">${stops.map((s, i) => timelineRow(s, { index: i, progress, minute, shift, bus, ride })).join("")}</ol>`;
}
let lastTrackIndex = null,
  manualScrollUntil = 0,
  lastAlertKey = null;
export function setupNowInteractions() {
  setupRouteMaps();
  $("#nearby-panel").addEventListener("click", (event) => {
    const button = event.target.closest("[data-live-direction]");
    if (!button) return;
    const values = navigation.recalled("live-directions") ?? {};
    navigation.remember(
      "live-directions",
      Object.fromEntries([
        ...Object.entries(values)
          .filter(([id]) => id !== button.dataset.liveDirectionStop)
          .slice(-7),
        [button.dataset.liveDirectionStop, button.dataset.liveDirection],
      ]),
    );
    renderNow();
  });
  document.addEventListener("mymap-arrivals-updated", () => {
    if (!state.ride) renderNow();
  });
  for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
    window.addEventListener(
      event,
      () => {
        manualScrollUntil = Date.now() + 10000;
      },
      { passive: true },
    );
}
function followTimeline(progress) {
  const changed = lastTrackIndex !== progress.nextIndex;
  lastTrackIndex = progress.nextIndex;
  const table = $(".journey-stop-list"),
    row = table?.querySelector('[aria-current="step"]');
  if (
    !changed ||
    !row ||
    Date.now() < manualScrollUntil ||
    navigation.route.type !== "stops"
  )
    return;
  const box = table.getBoundingClientRect();
  if (box.bottom > 100 && box.top < innerHeight - 100)
    row.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
}
const heroMarkup = new WeakMap();
function renderHero(root, html, model) {
  const compact =
    parseFloat(getComputedStyle(document.documentElement).fontSize) > 20 ||
    innerHeight < 700;
  const signature = html + compact;
  if (
    heroMarkup.get(root) === signature &&
    root.firstElementChild?.dataset.rideKey === model.observed.key
  )
    return;
  heroMarkup.set(root, signature);
  const template = document.createElement("template");
  template.innerHTML = html;
  const next = template.content.firstElementChild,
    current = root.firstElementChild;
  next.classList.toggle("compact", compact);
  if (compact) next.querySelector(".station-overview")?.removeAttribute("open");
  if (
    !current?.classList.contains("journey-display") ||
    current.dataset.rideKey !== model.observed.key
  ) {
    updateHTML(root, next.outerHTML);
    root.firstElementChild.dataset.rideKey = model.observed.key;
    return;
  }
  if (compact && !current.classList.contains("compact"))
    current.querySelector(".station-overview")?.removeAttribute("open");
  current.className = next.className;
  for (const key of ["operator", "trainState", "phase", "line"])
    current.dataset[key] = next.dataset[key];
  for (const selector of [
    ".route-header",
    ".next-state-label",
    ".next-station-title",
    ".station-en",
    ".next-countdown",
    ".destination-progress",
    ".station-strip",
    ".personal-destination",
    ".journey-metrics",
  ]) {
    const target = current.querySelector(selector),
      source = next.querySelector(selector);
    if (selector === ".route-header" && target && source) {
      const oldTokens = target.querySelector(".route-tokens"),
        newTokens = source.querySelector(".route-tokens");
      oldTokens.className = newTokens.className;
      [...oldTokens.children].forEach((token, i) => {
        const nextToken = newTokens.children[i];
        token.className = nextToken.className;
        token.hidden = nextToken.hidden;
        updateHTML(token, nextToken.innerHTML);
      });
      updateHTML(
        target.querySelector("div"),
        source.querySelector("div").innerHTML,
      );
    } else if (selector === ".next-station-title" && target && source) {
      updateMeaning(
        target.querySelector(".journey-next-name"),
        source.querySelector(".journey-next-name").innerHTML,
        "station",
      );
      const code = target.querySelector(".station-code"),
        newCode = source.querySelector(".station-code");
      if (code && newCode) updateMeaning(code, newCode.innerHTML);
      else if (newCode) target.append(newCode.cloneNode(true));
      else code?.remove();
    } else if (
      selector === ".destination-progress" &&
      target &&
      source &&
      target.querySelector(".remaining-number") &&
      source.querySelector(".remaining-number")
    ) {
      const number = target.querySelector(".remaining-number"),
        newNumber = source.querySelector(".remaining-number");
      if (
        target.textContent.replace(number.textContent, "#") ===
        source.textContent.replace(newNumber.textContent, "#")
      )
        updateMeaning(number, newNumber.innerHTML);
      else updateMeaning(target, source.innerHTML);
    } else if (target && source) {
      if (
        [
          ".next-station-title",
          ".next-countdown",
          ".destination-progress",
        ].includes(selector)
      )
        updateMeaning(
          target,
          source.innerHTML,
          selector === ".next-station-title" ? "station" : "crossfade",
        );
      else updateHTML(target, source.innerHTML);
    } else if (selector === ".station-en") {
      if (target && !source) target.remove();
      else if (source && !target)
        current.querySelector(".next-countdown").before(source.cloneNode(true));
    }
  }
  const hero = current.querySelector(".next-station-hero");
  hero.setAttribute(
    "aria-label",
    next.querySelector(".next-station-hero").getAttribute("aria-label"),
  );
  const oldExtras = [
      ...current.querySelectorAll(
        ".through-notice,.source-note,.journey-warning,.journey-delay",
      ),
    ],
    newExtras = [
      ...next.querySelectorAll(
        ".through-notice,.source-note,.journey-warning,.journey-delay",
      ),
    ];
  for (let i = 0; i < newExtras.length; i++) {
    const old = oldExtras[i],
      extra = newExtras[i];
    if (old && old.className === extra.className)
      updateHTML(old, extra.innerHTML);
    else {
      old?.remove();
      if (extra.classList.contains("journey-warning"))
        current.prepend(extra.cloneNode(true));
      else current.append(extra.cloneNode(true));
    }
  }
  oldExtras.slice(newExtras.length).forEach((el) => el.remove());
}
function foldbackPlanHTML(ride, now) {
  const plan = state.foldbackPlan;
  if (!plan || plan.rideKey !== rideKey(ride)) return "";
  const stop = ride.officialStops?.find((s) => s.id === plan.stopId),
    assessment = assessFoldback(stop, plan.depart, {
      shift: state.rideShift,
      buffer: plan.buffer,
      now: now.minute,
    });
  const text = {
    possible: ui("vnext_view_090", [Math.floor(assessment.slack)]),
    tight: ui("vnext_view_091"),
    missed: ui("vnext_view_092"),
    unknown: ui("vnext_view_093"),
  }[assessment.status];
  return ui("vnext_view_094", [
    assessment.status,
    icon("fold"),
    esc(stop?.name ?? plan.stopId),
    formatMinute(plan.depart),
    esc(plan.destination),
    esc(text),
  ]);
}
