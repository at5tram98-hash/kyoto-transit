import {
  groupCityBusRows,
  busDirectionLabel,
  busArrivalText,
} from "./arrival-stability.js";
import { isFresh } from "./realtime.js";
import { nearbyDepartures } from "./nearby-departures.js";
import { trajectory } from "./riding.js";
import { chooseNearbyGuide, formatMinute } from "./vnext-core.js";
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
import { compactBusHTML } from "./vnext-arrivals.js";
import { updateHTML } from "./view-rendering.js";
import { heroModel, delayAnalysis, nearbyDirection } from "./now-model.js";
import { loadNorth3Snapshot, north3Board, north3Day } from "./north3-feed.js";
import { nextStationHero, timelineRow } from "./now-components.js";
import {
  routeMapModel,
  routeMapHTML,
  renderRouteMap,
  setupRouteMaps,
} from "./route-map.js";
import { routeConfigFor } from "./bus-routes.js";
import { openContextSheet } from "./context-sheet.js";
import { resolveNowState } from "./ride-state-resolver.js";
import {
  journeyProgress,
  stopTime,
  assessFoldback,
  journeyClock,
} from "./journey-core.js";

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
let north3Request = null;
function north3DepartureHTML(stop) {
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
  const search = $("#route-search-root"),
    host = next === "nearby" ? $("#now-search") : $('[data-view="timetable"]');
  if (search && host && search.parentElement !== host) host.prepend(search);
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
      for (const [i, node] of [
        $("#now-hero"),
        $("#vehicle-panel"),
        $("#nearby-panel"),
      ].entries()) {
        node.getAnimations().forEach((a) => a.cancel());
        node.animate(
          [
            { opacity: 0.25, transform: `translateY(${i ? 16 : 8}px)` },
            { opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: 360,
            delay: i * 35,
            easing: "cubic-bezier(.22,.8,.25,1)",
          },
        );
      }
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
  // Keep the onboard display usable when GPS is temporarily lost underground.
  if (state.ride) {
    enterContext(resolveNowState(state.ride));
    renderRide(root, vehicle, networkPanel, nearPanel, now);
    return;
  }
  enterContext("nearby");
  updateHTML(
    vehicle,
    `${state.armedJourney ? `<section class="section-block armed-journey" tabindex="-1"><span class="section-label">案内開始の準備ができました</span><h3>${esc(serviceName(state.armedJourney.ride))} · ${esc(state.armedJourney.ride.destination)}行き</h3><p class="source-note">${esc(state.armedJourney.ride.userDestination?.name ?? "目的地")}で降車予定。位置・移動・対象便が一致したら乗車を確認します。</p><button class="secondary-action" data-board-armed>この便に乗車中 · 案内を開始</button><button class="plain-action" data-cancel-armed>解除</button></section>` : ""}${candidateHTML()}`,
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
    `<section class="hero-card idle-status"><span class="idle-symbol">${icon("fold")}</span><div><h2>現在は未乗車です</h2><p>${moving ? "移動中 · 対象の便を確認しています" : locationNote || "行き先を検索して、案内を準備"}</p></div></section>`,
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
  updateHTML(
    nearPanel,
    nearby.length
      ? `<section class="section-block nearby-guide"><div class="section-heading"><h3>近くの駅・バス停</h3><span class="source-caption">距離順</span></div>${nearby.map((s) => `<button class="nearby-row" data-nearby-detail="${esc(s.id)}"><span class="mode-symbol ${s.stop.type.includes("bus") ? "bus" : "subway"}">${s.stop.type.includes("bus") ? esc(s.stop.lines?.[0] ?? "バス") : "K"}</span><span><b>${esc(s.stop.name)}</b><small>${esc(s.stop.lines?.join("・") ?? "")} · ${Math.round(s.meters)}m ${nearbyDirection(state.fix, s)}</small></span><span class="chevron">›</span></button>${s.stop.type === "subway" ? departureHTML(s.id) : nearbyBusHTML(s.stop)}`).join("")}</section>`
      : "",
  );
}
export function nearbySheet(id) {
  const stop = state.network.stops.get(id);
  if (!stop) return;
  openContextSheet(
    stop.name,
    `${stop.type === "subway" ? departureHTML(id, true) : north3DepartureHTML(stop)}<button class="primary-action" data-start-here="${esc(id)}">ここから出発</button><button class="secondary-action" data-open-timetable="${esc(id)}">時刻表を見る</button>${stop.type === "citybus" ? `<button class="secondary-action" data-open-arrivals="${esc(id)}">接近情報を見る</button>` : ""}`,
  );
}
function renderRide(root, vehicle, networkPanel, nearPanel, now) {
  const ride = state.ride,
    mode = modeClass(ride),
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
        '<div class="route-map-host"></div><button class="plain-action" data-context-action="map">地図を広げる ↗</button>';
      root.querySelector(".personal-destination").before(section);
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
  const busApproach =
    ride.operator === "citybus" && state.busLive
      ? `<div class="ride-approach"><div class="section-label">接近情報</div>${compactBusHTML(state.busLive)}</div>`
      : "";
  updateHTML(
    vehicle,
    `${busApproach}<section class="section-block journey-stops"><div class="section-heading"><div><span class="section-label">${bus ? "停留所ごとの案内" : "終点までの停車案内"}</span><h3>${esc(ride.destination ?? stops.at(-1)?.name ?? "終点")}</h3></div>${!bus ? `<button class="plain-action" id="ride-foldback">${icon("fold")}折り返し</button>` : ""}</div><div class="journey-table-caption"><span>${bus ? "停留所" : "停車駅"}</span><span>予定 / 到着見込み</span></div>${timeline(tableStops, tableProgress, now.minute, shift, bus, ride)}<p class="source-note">${known ? "公式時刻表を基準に、現在の遅れ推定を到着見込みへ反映しています。" : "公式の途中時刻を取得できていないため、停留所の順序と現在地を案内しています。"}${state.locationStatus !== "active" ? " 位置情報が戻るまで、停車位置は時刻表からの推定です。" : ""}</p>${ride.operatingConditions?.schoolDayRequired ? '<p class="source-note">この便は京都バス運行で、大学休校日は運休します。運行条件をご確認ください。</p>' : ""}${settings.showConfidence ? `<details class="confidence"><summary>判定詳細</summary><p>一致度 ${Math.round(state.rideConfidence)} / 100</p><p>${esc(state.rideSource)}</p></details>` : ""}</section><section class="section-block journey-analysis"><div class="section-label">遅延分析 · 推定</div><h3>${esc(analysis.conclusion)}</h3><div class="analysis-actions"><button class="secondary-action" data-context-action="delay">遅れの根拠</button><button class="secondary-action" data-context-action="destination">降車アシスト</button></div></section>${!bus ? foldbackPlanHTML(ride, now) : ""}`,
  );
  followTimeline(progress);
  if (bus) updateHTML(networkPanel, "");
  else void renderNetworkPanel(networkPanel, ride, now);
  updateHTML(
    nearPanel,
    `${!bus ? `<section class="section-block"><div class="section-heading"><h3>経路と現在地</h3><button class="plain-action" data-context-action="map">全画面</button></div><div class="route-map-host"></div></section>` : ""}<section class="section-block compact"><button class="native-row" id="ride-operations"><span class="mode-symbol info">${icon("operations")}</span><span><b>運行情報</b><small>遅延・運休</small></span><span class="chevron">›</span></button><button class="native-row" id="ride-end"><span class="mode-symbol muted">${icon("close")}</span><span><b>乗車判定を終了</b></span><span class="chevron">›</span></button></section>`,
  );
  if (!bus)
    renderRouteMap(nearPanel.querySelector(".route-map-host"), map, model);
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
    window.scrollY < $("#now-hero").offsetHeight
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
  for (const key of ["trainState", "phase", "line"])
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
    ".ride-meta",
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
      const pill = target.querySelector(".status-pill"),
        nextPill = source.querySelector(".status-pill");
      pill.className = nextPill.className;
      updateHTML(pill, nextPill.innerHTML);
    } else if (target && source) updateHTML(target, source.innerHTML);
    else if (selector === ".station-en") {
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
        ".through-notice,.source-note,.journey-warning",
      ),
    ],
    newExtras = [
      ...next.querySelectorAll(".through-notice,.source-note,.journey-warning"),
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
