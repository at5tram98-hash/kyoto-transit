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
} from "./vnext-state.js";
import { updateRideAnchor } from "./vnext-detect.js";
import { renderNetworkPanel } from "./vnext-network-view.js";
import { compactBusHTML } from "./vnext-arrivals.js";
import { updateHTML } from "./view-rendering.js";
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
function departureHTML(stopId) {
  const now = tokyoNow(),
    feed = state.subwayFeedDate === now.date ? state.subwayFeed : null;
  if (!feed)
    return `<div class="nearby-departures"><p class="source-note">${nearbyRequest ? "発車予定を確認中…" : "発車予定を取得できませんでした。"}${!nearbyRequest ? '<button class="plain-action" data-retry-nearby>再取得</button>' : ""}</p></div>`;
  const groups = nearbyDepartures(feed, stopId, now);
  return `<div class="nearby-departures">${groups.map((g) => `<div><span>${g.direction === "north" ? "国際会館方面" : "竹田・近鉄方面"}</span>${g.entries.length ? g.entries.map((e) => `<p><time>${formatMinute(e.depart)}</time><span>${esc(e.destination ?? "行先未取得")}行き</span></p>`).join("") : '<p class="source-note">1時間以内の発車予定はありません</p>'}</div>`).join("")}<p class="source-note">${feed.cached ? "保存した公式時刻表" : "公式時刻表"} · 発車予定${feed.meta?.stale ? " · ダイヤの変更を公式サイトで確認してください" : ""}</p></div>`;
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
  const b = $("#location-indicator"),
    active = state.locationStatus === "active";
  b.classList.toggle("active", active);
  updateHTML(
    b,
    `${icon("location")}<span>${active ? "位置情報" : "確認"}</span>`,
  );
}
function candidateHTML() {
  if (!state.rideCandidates?.length) return "";
  return `<section class="section-block ride-choice-block"><div class="section-heading"><div><span class="section-label">乗車中の便</span><h3>どの便に乗っていますか？</h3></div></div><div class="ride-choice-list">${state.rideCandidates
    .slice(0, 3)
    .map(
      (c, i) =>
        `<button class="native-row ride-choice-row" data-ride-candidate="${i}"><span class="mode-symbol ${modeClass(c.ride)}">${icon(["citybus", "kyotobus"].includes(c.ride.operator) ? "bus" : "train")}</span><span><b>${esc(serviceName(c.ride))}</b><small>${esc(c.ride.destination ?? "終点")}方面${Number.isFinite(c.ride.depart) ? `・${formatMinute(c.ride.depart)}発` : ""}</small></span><strong>選択</strong><span class="chevron">›</span></button>`,
    )
    .join("")}</div></section>`;
}
export function renderNow() {
  updateRideAnchor();
  if (state.tab !== "now") return;
  renderStatusPill();
  const root = $("#now-hero"),
    vehicle = $("#vehicle-panel"),
    networkPanel = $("#network-panel"),
    nearPanel = $("#nearby-panel"),
    now = journeyClock(state.ride, tokyoNow()),
    near = nearest(),
    motion = trajectory(state.samples);
  // Keep the onboard display usable when GPS is temporarily lost underground.
  if (state.ride) {
    enterContext(
      ["citybus", "kyotobus"].includes(state.ride.operator) ? "bus" : "rail",
    );
    renderRide(root, vehicle, networkPanel, nearPanel, now);
    return;
  }
  enterContext("nearby");
  updateHTML(vehicle, candidateHTML());
  updateHTML(networkPanel, "");
  if (state.locationStatus === "loading") {
    updateHTML(
      root,
      '<section class="hero-card neutral"><div class="hero-eyebrow"><span class="pulse-dot"></span>現在地を確認中</div><h2>いまの移動を<br>確認しています</h2><p>接近情報は停留所を選んで確認できます。</p></section>',
    );
    updateHTML(nearPanel, "");
    return;
  }
  if (["denied", "unavailable", "unsupported"].includes(state.locationStatus)) {
    const denied = state.locationStatus === "denied";
    updateHTML(
      root,
      `<section class="hero-card warning"><div class="hero-eyebrow">${denied ? "位置情報が必要です" : "現在地を確認できません"}</div><h2>${denied ? "位置情報を<br>許可してください" : "現在地を<br>再取得します"}</h2><p>時刻表・経路検索・停留所の接近情報は引き続き使えます。</p><button class="primary-action" data-retry-location>位置情報を再取得</button></section>`,
    );
    updateHTML(nearPanel, "");
    return;
  }
  const guide = chooseNearbyGuide(
      { rail: near.rail, bus: near.bus },
      settings.railGuideDistance,
    ),
    moving = Number.isFinite(motion.speed) && motion.speed >= 2.8,
    ambiguous = state.rideCandidates?.length > 1;
  updateHTML(
    root,
    `<section class="hero-card ${moving ? "detecting" : "neutral"}"><div class="hero-eyebrow">${moving ? '<span class="pulse-dot"></span>乗車中の便を確認中' : "NEARBY · 周辺案内"}</div><h2>${ambiguous ? "乗っている便を選択" : moving ? "移動中" : "近くから、出かけよう"}</h2><p>${guide ? `${esc(guide.stop.name)}まで約${Math.round(guide.meters)}m` : "近くの駅・停留所を現在地から探します。"}</p>${state.detectBusy ? '<div class="thin-progress"><i></i></div>' : ""}</section>`,
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
      ? `<section class="section-block nearby-guide"><div class="section-heading"><div><span class="section-label">歩いて行ける</span><h3>近くの駅・停留所</h3></div></div>${nearby.map((s) => `<div class="nearby-place"><button class="nearby-row" data-open-timetable="${esc(s.id)}"><span class="mode-symbol ${s.stop.type.includes("bus") ? "bus" : "subway"}">${icon(s.stop.type.includes("bus") ? "bus" : "train")}</span><span><b>${esc(s.stop.name)}</b><small>${esc((s.stop.lines ?? []).join("・"))}</small></span><strong>${Math.round(s.meters)}m</strong><span class="chevron">›</span></button>${s.stop.type === "subway" ? departureHTML(s.id) : ""}<div class="nearby-actions"><button class="secondary-action" data-start-here="${esc(s.id)}">ここから出発</button>${s.stop.type === "citybus" ? `<button class="secondary-action" data-open-arrivals="${esc(s.id)}">接近情報</button>` : ""}</div></div>`).join("")}</section>`
      : "",
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
  updateHTML(
    root,
    `<section class="hero-card aboard ${mode} journey-display"><div class="hero-eyebrow"><span class="live-dot"></span>${bus ? "BUS · バス乗車中" : "ON BOARD · 電車乗車中"}</div><div class="service-title"><span class="mode-symbol ${mode}">${icon(bus ? "bus" : "train")}</span><div><h2>${esc(serviceName(ride))}</h2><p>${esc(ride.destination ?? stops.at(-1)?.name ?? "終点")}行き</p></div></div><div class="journey-next"><span class="section-label">${bus ? "次の停留所" : "次の停車駅"}</span><strong class="journey-next-name"></strong><span class="position-source"></span></div><div class="journey-track" role="img"><div class="journey-track-line"><i></i><span>${icon(bus ? "bus" : "train")}</span></div><div class="journey-track-labels"><span>${esc(stops[0]?.name ?? "出発")}</span><span>${esc(stops.at(-1)?.name ?? "終点")}</span></div></div><div class="journey-metrics"><div><span>次の到着見込み</span><strong class="journey-arrival"></strong></div><div><span>終点の到着見込み</span><strong class="journey-end-arrival"></strong></div><div><span>${bus ? "残りの停留所" : "残りの停車駅"}</span><strong class="journey-remaining"></strong></div></div><div class="ride-meta"><span class="journey-delay"></span><span class="journey-location-status"></span></div></section>`,
  );
  updateHTML(
    root.querySelector(".journey-next-name"),
    esc(
      progress.currentIndex === stops.length - 1
        ? "終点に到着"
        : (progress.next?.name ?? "確認中"),
    ),
  );
  const current = stops[progress.currentIndex];
  updateHTML(
    root.querySelector(".position-source"),
    esc(
      progress.source === "location"
        ? `現在地：${current?.name ?? progress.previous?.name ?? "確認中"}付近`
        : progress.source === "schedule"
          ? `${progress.previous?.name ?? "出発駅"} → ${progress.next?.name ?? "終点"} · 時刻表から推定`
          : "現在地を確認中",
    ),
  );
  for (const [selector, value] of [
    [".journey-arrival", progress.arrival],
    [".journey-end-arrival", progress.endArrival],
  ])
    updateHTML(
      root.querySelector(selector),
      Number.isFinite(value)
        ? formatMinute(Math.round(value))
        : "<small>時刻未取得</small>",
    );
  updateHTML(
    root.querySelector(".journey-remaining"),
    `${progress.remaining}<small>${bus ? "停留所" : "駅"}</small>`,
  );
  const known = stops.some((s) => Number.isFinite(stopTime(s))),
    delay = Number.isFinite(shift) ? Math.round(shift) : null;
  updateHTML(
    root.querySelector(".journey-delay"),
    known && delay !== null && (state.rideShiftKnown || shift !== 0)
      ? delay > 0
        ? `約${delay}分の遅れ（推定）`
        : delay < 0
          ? `約${Math.abs(delay)}分早着（推定）`
          : "ほぼ定刻（推定）"
      : "遅れ情報未取得",
  );
  updateHTML(
    root.querySelector(".journey-location-status"),
    state.locationStatus === "active"
      ? "現在地を更新中"
      : "位置情報の復帰を待っています",
  );
  const track = root.querySelector(".journey-track"),
    position = `${Math.round(progress.fraction * 100)}%`;
  if (track.style.getPropertyValue("--journey-position") !== position)
    track.style.setProperty("--journey-position", position);
  track.setAttribute(
    "aria-label",
    `終点までの進行状況 ${Math.round(progress.fraction * 100)}パーセント、${progress.source === "location" ? "現在地による案内" : "時刻表による推定"}`,
  );
  const busApproach =
    ride.operator === "citybus" && state.busLive
      ? `<div class="ride-approach"><div class="section-label">接近情報</div>${compactBusHTML(state.busLive)}</div>`
      : "";
  updateHTML(
    vehicle,
    `${busApproach}${!bus ? foldbackPlanHTML(ride, now) : ""}<section class="section-block journey-stops"><div class="section-heading"><div><span class="section-label">${bus ? "停留所ごとの案内" : "終点までの停車案内"}</span><h3>${esc(ride.destination ?? stops.at(-1)?.name ?? "終点")}</h3></div>${!bus ? `<button class="plain-action" id="ride-foldback">${icon("fold")}折り返し</button>` : ""}</div><div class="journey-table-caption"><span>${bus ? "停留所" : "停車駅"}</span><span>予定 / 到着見込み</span></div>${timeline(stops, progress, now.minute, shift, bus)}<p class="source-note">${known ? "公式時刻表を基準に、現在の遅れ推定を到着見込みへ反映しています。" : "公式の途中時刻を取得できていないため、停留所の順序と現在地を案内しています。"}${state.locationStatus !== "active" ? " 位置情報が戻るまで、停車位置は時刻表からの推定です。" : ""}</p>${settings.showConfidence ? `<details class="confidence"><summary>判定詳細</summary><p>一致度 ${Math.round(state.rideConfidence)} / 100</p><p>${esc(state.rideSource)}</p></details>` : ""}</section>`,
  );
  if (bus) updateHTML(networkPanel, "");
  else void renderNetworkPanel(networkPanel, ride, now);
  updateHTML(
    nearPanel,
    `<section class="section-block compact"><button class="native-row" id="ride-operations"><span class="mode-symbol info">${icon("operations")}</span><span><b>運行情報</b><small>遅延・運休</small></span><span class="chevron">›</span></button><button class="native-row" id="ride-end"><span class="mode-symbol muted">${icon("close")}</span><span><b>乗車判定を終了</b></span><span class="chevron">›</span></button></section>`,
  );
}
function timeline(stops, progress, minute, shift, bus) {
  if (!stops.length)
    return '<p class="empty-state">停車駅・停留所を確認中です。</p>';
  return `<ol class="stop-list journey-stop-list">${stops
    .map((s, i) => {
      const scheduled = stopTime(s),
        adjusted = Number.isFinite(scheduled) ? scheduled + shift : null,
        passed =
          progress.currentIndex >= 0
            ? i < progress.currentIndex
            : Number.isFinite(adjusted)
              ? adjusted < minute - 0.5
              : i < progress.nextIndex;
      const next = i === progress.nextIndex,
        current = i === progress.currentIndex;
      return `<li class="${passed ? "passed" : ""} ${next ? "next" : ""} ${current ? "current" : ""}" ${next ? 'aria-current="step"' : ""}><span class="rail-dot"></span><div><b>${esc(s.name)}</b>${current ? "<small>現在地付近</small>" : i === stops.length - 1 ? "<small>終点</small>" : next ? `<small>次の${bus ? "停留所" : "停車駅"}</small>` : ""}</div><div class="stop-times">${Number.isFinite(adjusted) ? `<time>${formatMinute(Math.round(adjusted))}</time><small>${s.estimated ? "推定時刻" : `予定 ${formatMinute(scheduled)}`}</small>` : "<small>時刻未取得</small>"}</div></li>`;
    })
    .join("")}</ol>`;
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
