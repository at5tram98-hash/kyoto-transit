import {
  groupCityBusRows,
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
import { readSearchPairs } from "./search-history.js";
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
    return '<p class="source-caption">近鉄の発車予定は時刻表で確認できます</p>';
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
      .map(
        (e) =>
          `<div><span>${e.category === "express" ? "急行" : "普通"}${e.destination ? ` · ${esc(e.destination)}行` : ""}</span><time>${formatMinute(e.depart)}</time><b>${Math.round(e.depart - now.minute)}分<small>${nearbyRailFeed.meta?.stale ? "予定（保存）" : "発車予定"}</small></b></div>`,
      )
      .join("") ||
    '<p class="source-caption">1時間以内の発車予定はありません</p>'
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
    return '<p class="source-note">北3の発車予定を確認中…</p>';
  }
  const now = tokyoNow(),
    day = north3Day(now.date);
  if (!day)
    return '<p class="source-note">北3の運行日区分は未確認です。公式時刻表をご確認ください。</p>';
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
    return `<div class="nearby-departures compact-departures">${rows.map((e) => `<div><span>北3 · ${e.direction === "north" ? "京都産大前" : "北大路BT"}方面</span><time>${formatMinute(e.depart)}</time><b>${Math.round(e.depart - now.minute)}分<small>${e.operatingCompany === "kyotobus" ? "京都バス" : "市バス"} · 予定</small></b></div>`).join("") || '<p class="source-caption">1時間以内の通常便はありません</p>'}</div>`;
  }
  return `<div class="nearby-departures">${["north", "south"]
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
      return `<div><span>北3 · ${direction === "north" ? "京都産大前" : "北大路BT"}方面</span>${rows.map((e) => `<p><time>${formatMinute(e.depart)}</time><span>${e.operatingCompany === "kyotobus" ? "京都バス" : "京都市バス"} · 発車予定</span></p>`).join("") || '<p class="source-note">1時間以内の通常便はありません</p>'}</div>`;
    })
    .join(
      "",
    )}<p class="source-note">保存した公式時刻表 · ダイヤ変更・大学休校日は要確認</p></div>`;
}
function nearbyBusHTML(stop) {
  if (stop.type !== "citybus") return north3DepartureHTML(stop);
  const data = state.busLive;
  if (data?.stop !== (stop.fullName ?? stop.name))
    return north3DepartureHTML(stop);
  const rows = groupCityBusRows(data.results ?? [])
    .filter((r) =>
      (r.arrivals ?? [r]).some(
        (a) => Number.isFinite(a.minutes) || Number.isFinite(a.stopsAway),
      ),
    )
    .slice(0, 2);
  const observed = data.source === "live" && !data.stale && isFresh(data.asOf);
  return rows.length
    ? `<div class="nearby-departures compact-departures">${rows.map((r) => `<div><span>${esc(r.route)} · ${esc(busDirectionLabel(r.route, r.dest))}</span><b>${esc(busArrivalText({ ...r, arrivals: r.arrivals?.slice(0, 1) }))}<small>${observed ? "実測" : "予測"}</small></b></div>`).join("")}</div>`
    : north3DepartureHTML(stop);
}
function departureHTML(stopId, expanded = false) {
  const now = tokyoNow(),
    feed = state.subwayFeedDate === now.date ? state.subwayFeed : null;
  if (!feed)
    return `<div class="nearby-departures"><p class="source-note">${nearbyRequest ? "発車予定を確認中…" : "発車予定を取得できませんでした。"}${!nearbyRequest ? '<button class="plain-action" data-retry-nearby>再取得</button>' : ""}</p></div>`;
  const groups = nearbyDepartures(feed, stopId, now);
  if (!expanded) {
    const populated = groups.filter((g) => g.entries.length);
    if (!populated.length)
      return '<p class="nearby-summary source-caption">発車予定は時刻表で確認できます</p>';
    return `<div class="nearby-departures compact-departures">${populated
      .map((g) => {
        const e = g.entries[0];
        return `<div><span>${g.direction === "north" ? "国際会館方面" : "竹田・近鉄方面"}</span><time>${formatMinute(e.depart)}</time><b>${Math.max(0, Math.round(e.depart - now.minute))}分<small>発車予定</small></b></div>`;
      })
      .join("")}</div>`;
  }

  return `<div class="nearby-departures">${groups.map((g) => `<div><span>${g.direction === "north" ? "国際会館方面" : "竹田・近鉄方面"}</span>${g.entries.length ? (expanded ? g.entries : g.entries.slice(0, 1)).map((e) => `<p><time>${formatMinute(e.depart)}</time><span>${esc(e.destination ?? "行先未取得")}行き</span></p>`).join("") : '<p class="source-note">1時間以内の発車予定はありません</p>'}</div>`).join("")}<p class="source-note">${feed.cached ? "保存した公式時刻表" : "公式時刻表"} · 発車予定${expanded && feed.meta?.stale ? " · ダイヤの変更を公式サイトで確認してください" : ""}</p></div>`;
}
function enterContext(next) {
  const view = $('[data-view="now"]'),
    changed = context !== next;
  view.dataset.context = next;
  $("#view-subtitle").textContent = {
    rail: "電車に合わせた乗車案内",
    bus: "バスに合わせた乗車案内",
    nearby: "現在地に合わせて周辺案内",
  }[next];
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
    active: "取得中",
    loading: "確認中",
    denied: "端末の許可が必要",
    unavailable: "電波を確認中",
    unsupported: "この端末は未対応",
    disabled: "OFF",
    paused: "待機中",
  };
  b.classList.toggle("active", state.locationStatus === "active");
  updateHTML(b, `${icon("location")}<span>現在地を再確認</span>`);
  const label = $("#location-status");
  if (label) label.textContent = labels[state.locationStatus] ?? "待機中";
}
function candidateHTML() {
  if (!state.rideCandidates?.length) return "";
  return `<section class="section-block ride-choice-block"><div class="section-heading"><div><span class="section-label">乗車中の便</span><h3>${state.rideCandidates.length === 1 ? "この電車・バスに乗りましたか？" : "どの便に乗っていますか？"}</h3></div></div><div class="ride-choice-list">${state.rideCandidates
    .slice(0, 3)
    .map(
      (c, i) =>
        `<button class="native-row ride-choice-row" data-ride-candidate="${i}"><span class="mode-symbol ${modeClass(c.ride)}">${icon(["citybus", "kyotobus"].includes(c.ride.operator) ? "bus" : "train")}</span><span><b>${esc(serviceName(c.ride))}</b><small>${esc(c.ride.destination ?? "終点")}方面${Number.isFinite(c.ride.depart) ? `・${formatMinute(c.ride.depart)}発` : ""}</small></span><strong>選択</strong><span class="chevron">›</span></button>`,
    )
    .join("")}</div></section>`;
}
export function renderNow() {
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
    updateHTML(vehicle, "");
    $("#now-search").hidden = true;
    document.querySelector(".app-shell").dataset.rideMode = state.heroModel.bus
      ? "bus"
      : "rail";
    navigation.refresh();
    return;
  }
  enterContext("nearby");
  delete document.querySelector(".app-shell").dataset.rideMode;
  $("#now-search").hidden = false;
  updateHTML($("#ride-actions"), "");
  let pairs = { history: [], favorites: [] };
  try {
    pairs = readSearchPairs(localStorage);
  } catch {}
  updateHTML(
    $("#now-search"),
    `<button class="native-row navigation-search-entry" data-open-search><span class="transport-icon">${icon("search")}</span><span><b>目的地を検索</b></span><span class="chevron">›</span></button>${
      [...pairs.favorites, ...pairs.history]
        .filter((p, i, a) => a.findIndex((q) => q.to === p.to) === i)
        .slice(0, 3).length
        ? `<section class="navigation-recent"><h3>最近・よく使う行き先</h3><div class="native-list">${[
            ...pairs.favorites,
            ...pairs.history,
          ]
            .filter((p, i, a) => a.findIndex((q) => q.to === p.to) === i)
            .slice(0, 3)
            .map(
              (p) =>
                `<button class="native-row" data-search-to="${esc(p.to)}"><span><b>${esc(p.to)}</b><small>${esc(p.from)}から</small></span><span class="chevron">›</span></button>`,
            )
            .join("")}</div></section>`
        : ""
    }`,
  );
  updateHTML(
    vehicle,
    `${state.armedJourney ? `<section class="section-block armed-journey" tabindex="-1"><span class="section-label">案内開始の準備ができました</span><h3>${esc(serviceName(state.armedJourney.ride))} · ${esc(state.armedJourney.ride.destination)}行き</h3><p class="source-note">${esc(state.armedJourney.ride.userDestination?.name ?? "目的地")}で降車予定。位置・移動・対象便が一致したら乗車を確認します。</p>${itinerarySummary(state.itinerary, state.network)}<div class="screen-action-group"><button class="secondary-action" data-board-armed>この便に乗車中 · 案内を開始</button><button class="plain-action" data-cancel-armed>解除</button></div></section>` : state.itinerary ? itinerarySummary(state.itinerary, state.network) : ""}${candidateHTML()}`,
  );
  updateHTML(networkPanel, "");
  const moving = Number.isFinite(motion.speed) && motion.speed >= 2.8;
  const locationNote =
    state.locationStatus === "active"
      ? ""
      : state.locationStatus === "loading"
        ? "現在地を確認中"
        : "現在地は未取得 · 検索から案内できます";
  updateHTML(
    root,
    `<div class="idle-status"><span class="idle-state">未乗車</span><p>${moving ? "移動中 · 便を確認しています" : locationNote || (near.all[0]?.meters <= 1000 ? `${esc(near.all[0].stop.name)}付近` : "現在地に合わせて周辺案内")}</p></div>`,
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
  const arrivalsEntry = `<div class="native-list"><button class="native-row" data-navigation-screen="arrivals"><span><b>すべての接近情報</b></span><span class="chevron">›</span></button></div>`;
  updateNearbyPanel(
    nearPanel,
    (nearby.length
      ? `<section class="section-block nearby-guide"><div class="section-heading"><h3>近くの駅・バス停</h3><span class="source-caption">距離順</span></div>${nearby.map((s) => `<div class="nearby-item" data-nearby-key="${esc(s.id)}"><button class="nearby-row" data-operator="${esc(s.stop.type)}" data-nearby-detail="${esc(s.id)}"><span class="mode-symbol enhanced-mode ${s.stop.type.includes("bus") ? "bus" : s.stop.type === "kintetsu" ? "rail" : "subway"}" data-operator="${esc(s.stop.type)}">${icon(s.stop.type.includes("bus") ? "bus" : "train")}<small>${{ subway: "地下鉄", kintetsu: "近鉄", citybus: "市バス", kyotobus: "京都バス" }[s.stop.type] ?? "交通"}</small></span><span data-nearby-copy><b>${esc(s.stop.name)}</b><small>${esc(s.stop.lines?.join("・") ?? "")} · 徒歩約${Math.max(1, Math.ceil(s.meters / 70))}分 · ${Math.round(s.meters)}m</small></span><span class="chevron">›</span></button><div data-nearby-departures>${s.stop.type === "subway" ? departureHTML(s.id) : s.stop.type === "kintetsu" ? kintetsuDepartureHTML(s.stop) : nearbyBusHTML(s.stop)}</div></div>`).join("")}</section>`
      : "") + arrivalsEntry,
  );
  navigation.refresh();
}
export function nearbyDetailHTML(id) {
  const stop = state.network.stops.get(id);
  if (!stop) return '<p class="empty-state">駅・停留所が見つかりません。</p>';
  return `${stop.type === "subway" ? departureHTML(id, true) : `${stop.type.includes("bus") ? '<section class="bus-stop-preview" data-bus-stop-preview></section>' : ""}${stop.type === "kintetsu" ? kintetsuDepartureHTML(stop) : ""}`}<div class="screen-action-group"><button class="primary-action" data-start-here="${esc(id)}">ここから出発</button><button class="secondary-action" data-open-timetable="${esc(id)}">時刻表を見る</button></div>`;
}
function renderRide(root, vehicle, networkPanel, nearPanel, now) {
  const ride = state.ride,
    bus = ["citybus", "kyotobus"].includes(ride.operator),
    shift = state.rideShift;
  const progress = journeyProgress(ride, {
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
      section.innerHTML =
        '<button class="mini-map-open" data-context-action="map" aria-label="地図と現在地を開く"><span class="route-map-host" aria-hidden="true"></span><span>地図・現在地 ›</span></button>';
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
          ? `${model.userDestination?.name}に到着しました。ここで降ります`
          : `次は ${model.userDestination?.name}。降車の準備をしてください`;
      toast(message);
      if (
        settings.notifications &&
        globalThis.Notification?.permission === "granted"
      ) {
        try {
          new Notification("降車のお知らせ", {
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
      `<section class="section-block journey-stops"><div class="section-heading"><div><span class="section-label">${bus ? "停留所ごとの案内" : "終点までの停車案内"}</span><h3>${esc(ride.destination ?? stops.at(-1)?.name ?? "終点")}</h3></div>${!bus ? `<button class="plain-action" id="ride-foldback">${icon("fold")}折り返し</button>` : ""}</div><div class="journey-table-caption"><span>${bus ? "停留所" : "停車駅"}</span><span>予定 / 到着見込み</span></div>${timeline(tableStops, tableProgress, now.minute, shift, bus, ride)}<p class="source-note">${known ? "公式時刻表を基準に、現在の遅れ推定を到着見込みへ反映しています。" : "公式の途中時刻を取得できていないため、停留所の順序と現在地を案内しています。"}${state.locationStatus !== "active" ? " 位置情報が戻るまで、停車位置は時刻表からの推定です。" : ""}</p>${ride.operatingConditions?.schoolDayRequired ? '<p class="source-note">この便は京都バス運行で、大学休校日は運休します。運行条件をご確認ください。</p>' : ""}${settings.showConfidence ? `<details class="confidence"><summary>判定詳細</summary><p>一致度 ${Math.round(state.rideConfidence)} / 100</p><p>${esc(state.rideSource)}</p></details>` : ""}</section>`,
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
      `<div data-ride-next></div><div class="ride-action-list"><div class="ride-primary-actions">${action("stops", bus ? "停留所" : "停車駅", "timetable")}${action("map", "地図", "location")}${action(bus ? "arrivals" : "trains", bus ? "接近" : "列車位置", bus ? "bus" : "train")}${bus ? action("operation", "運行", "operations") : `<button class="ride-primary-action" data-open-foldback>${icon("fold")}<span>折り返し</span></button>`}</div><div class="native-list">${row("delay", "遅延分析", null)}${bus ? "" : row("operation", "運行情報", null)}<button class="native-row" id="ride-end"><span>乗車案内を終了</span><span class="chevron">›</span></button></div></div><div data-ride-foldback-plan></div>`,
    );
    actionRoot.dataset.mode = mode;
  }
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
  if (!stops.length)
    return '<p class="empty-state">停車駅・停留所を確認中です。</p>';
  return `<ol class="stop-list journey-stop-list">${stops.map((s, i) => timelineRow(s, { index: i, progress, minute, shift, bus, ride })).join("")}</ol>`;
}
let lastTrackIndex = null,
  manualScrollUntil = 0,
  lastAlertKey = null;
export function setupNowInteractions() {
  setupRouteMaps();
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
    possible: `乗換余裕 約${Math.floor(assessment.slack)}分`,
    tight: "乗換の余裕が少なくなっています",
    missed: "選んだ列車への乗換時間が不足しています",
    unknown: "到着時刻を確認できません",
  }[assessment.status];
  return `<section class="section-block foldback-plan ${assessment.status}"><div class="section-label">選択中の折り返し</div><button class="native-row" data-open-foldback><span class="mode-symbol info">${icon("fold")}</span><span><b>${esc(stop?.name ?? plan.stopId)} · ${formatMinute(plan.depart)}発</b><small>${esc(plan.destination)}行き · ${esc(text)}</small></span><span class="chevron">›</span></button><button class="secondary-action" data-start-foldback>折り返し列車に乗車したら案内を開始</button><p class="source-note">反対方向の列車は予定時刻です。ホーム移動と運行状況を確認してください。</p></section>`;
}
