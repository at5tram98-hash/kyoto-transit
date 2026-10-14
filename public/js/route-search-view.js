import { esc, icon } from "./vnext-state.js";
import { formatTime } from "./router.js";
import { boardingAvailable } from "./journey-session.js";
const yen = (n) =>
  Number.isFinite(n) ? `${Math.round(n).toLocaleString("ja-JP")}円` : "—";
const dot = (source) =>
  `<i class="source-dot ${source === "live" ? "live" : source === "prediction" ? "prediction" : "schedule"}" aria-hidden="true"></i>`;
export const operatorLabel = {
  subway: "地下鉄烏丸線",
  kintetsu: "近鉄京都線",
  through: "烏丸線・近鉄直通",
  citybus: "京都市バス",
  kyotobus: "京都バス",
};
const clock = (minute, label) => {
  const parts = formatTime(minute).split(" ");
  return `${parts.length > 1 ? `<small class="journey-clock-day">${esc(parts[0])}</small>` : ""}<b>${esc(parts.at(-1))}</b><small>${label}</small>`;
};
const serviceLabel = (leg) =>
  leg.route ? `${leg.route}系統` : (operatorLabel[leg.operator] ?? leg.label);

export function routeHTML(
  route,
  network,
  rides = [],
  routeIndex = 0,
  current,
  detail = false,
  { readOnly = false, hideActions = false } = {},
) {
  const name = (id) => network.stops.get(id)?.name ?? id,
    available = route.legs
      .map((leg, i) => ({ leg, i }))
      .filter(({ i }) => rides[i]),
    first = available[0],
    walk = route.legs
      .filter((l) => l.kind === "walk")
      .reduce((sum, l) => sum + l.minutes, 0),
    passApplied =
      route.fare.details?.some((d) => d.covered) ||
      (Number.isFinite(route.fare.additional) &&
        Number.isFinite(route.fare.normal) &&
        route.fare.additional < route.fare.normal);
  const routeBadges = route.legs
    .filter((leg) => leg.kind === "ride")
    .map(
      (leg) =>
        `<span class="transport-badge route-mode-badge" data-operator="${esc(leg.operator === "through" ? "through" : (leg.operatingCompany ?? leg.operator))}">${icon(leg.operator.includes("bus") ? "bus" : "train")}${esc(serviceLabel(leg))}</span>`,
    )
    .join('<span class="route-mode-transfer" aria-hidden="true">›</span>');
  const startTime =
    route.legs[0]?.kind === "ride" ? route.legs[0].depart : route.start;
  const shownDuration = Math.max(0, route.time - startTime);
  const point = (minute, id, label, cls = "") =>
    `<div class="planner-leg journey-point ${cls}"><time class="planner-clock">${clock(minute, label)}</time><span class="planner-line"></span><div><b class="journey-stop-name">${esc(name(id))}</b><small>${label}</small></div></div>`;
  const timeline = [];
  route.legs.forEach((leg, legIndex) => {
    const previous = route.legs[legIndex - 1],
      fromTime = previous?.arrive ?? route.start;
    if (leg.depart > fromTime && (previous || leg.kind !== "ride")) {
      if (!previous) timeline.push(point(fromTime, leg.from, "出発"));
      timeline.push(
        `<div class="planner-leg journey-wait"><span class="journey-wait-time">${Math.round(leg.depart - fromTime)}分</span><span class="planner-line"></span><div><b>${previous && leg.kind === "ride" ? "乗換待ち" : "待ち時間"}</b><small>${esc(name(leg.from))}</small></div></div>`,
      );
    }
    if (leg.kind !== "ride") {
      timeline.push(
        `<div class="planner-leg ${leg.kind === "walk" ? "walk" : "journey-dwell"}"><time class="planner-clock">${clock(leg.depart, "開始")}</time><span class="planner-line"></span><div><b>${leg.kind === "walk" ? "徒歩" : leg.kind === "dwell" ? "滞在" : "待ち"} ${leg.minutes}分</b><small>${esc(name(leg.from))}${leg.kind === "walk" ? ` → ${esc(name(leg.to))}` : ""}</small>${leg.kind === "dwell" ? "<small>指定した経由地での滞在</small>" : ""}</div></div>`,
      );
      if (legIndex === route.legs.length - 1)
        timeline.push(point(leg.arrive, leg.to, "到着", "journey-final"));
      return;
    }
    const ride = rides[legIndex],
      intermediate = (leg.path ?? []).slice(1, -1),
      stops =
        detail && intermediate.length
          ? `<details class="planner-leg-stops" data-leg-disclosure="${esc(`${legIndex}:${leg.from}:${leg.to}`)}"><summary>途中の停車駅 · ${intermediate.length}駅</summary><ol>${intermediate.map((id, j) => `<li><span>${esc(name(id))}</span><time>${Number.isFinite(leg.times?.[j + 1]) ? formatTime(leg.times[j + 1]) : "時刻未取得"}</time></li>`).join("")}</ol></details>`
          : "",
      actions = hideActions
        ? ""
        : `${ride && boardingAvailable(ride, current) ? `<button class="plain-action planner-board" data-board-route="${routeIndex}" data-board-leg="${legIndex}">この便に乗車中 · 案内を開始 ›</button>` : ""}${ride && !route.connectionUnavailable && first?.i !== legIndex ? `<button class="plain-action" data-arm-route="${routeIndex}" data-arm-leg="${legIndex}">この区間で案内を準備 ›</button>` : ""}`,
      departure =
        detail && !readOnly
          ? `<button class="journey-departure" data-change-route="${routeIndex}" data-change-leg="${legIndex}" aria-haspopup="dialog" aria-controls="trip-choice-sheet" aria-expanded="false" aria-label="${esc(name(leg.from))} ${formatTime(leg.depart)}発の便を変更">${clock(leg.depart, "発 ▾")}</button>`
          : `<time class="planner-clock">${clock(leg.depart, "発")}</time>`,
      source = leg.realtime
        ? `${dot(leg.realtime.source)}${leg.realtime.source === "live" ? "便別実測" : "遅れの推定"}${Number.isFinite(leg.realtime.delay) ? ` · ${leg.realtime.delay > 0 ? "+" : ""}${leg.realtime.delay}分` : ""}`
        : `${dot("schedule")}${leg.dataConfidence === "stale" ? "保存した予定時刻" : "予定時刻"}`;
    timeline.push(
      `<div class="journey-ride" data-operator="${esc(leg.operatingCompany ?? leg.operator)}"><div class="planner-leg ride">${departure}<span class="planner-line"></span><div><b class="journey-stop-name">${esc(name(leg.from))}</b><div class="journey-service"><b>${esc(serviceLabel(leg))}${leg.category === "express" ? " · 急行" : leg.category === "local" ? " · 普通" : ""}</b><small>${esc(leg.destination ?? "行先未確認")}${leg.destination ? "行" : ""}${leg.through ? " · 直通、乗換不要" : ""}</small></div>${leg.platform ? `<small>発 ${esc(leg.platform)}のりば · 時刻表記載</small>` : ""}<small class="journey-leg-source">${source}</small>${!leg.realtimeApplied && leg.realtime ? `<small>到着見込み（推定） ${formatTime(leg.arrive + leg.realtime.delay)}</small>` : ""}${stops}${actions ? `<div class="planner-leg-actions">${actions}</div>` : ""}</div></div>${point(leg.arrive, leg.to, "着", `${legIndex === route.legs.length - 1 ? "journey-final" : "journey-transfer"}`)}${leg.arrivalPlatform ? `<p class="journey-arrival-platform">着 ${esc(leg.arrivalPlatform)}のりば · 時刻表記載</p>` : ""}</div>`,
    );
  });
  return `<article class="planner-result" data-operator="${esc(route.legs.find((l) => l.kind === "ride")?.operator ?? "walk")}"><div class="planner-result-head"><span class="planner-badge">${esc(route.changedLeg != null ? "選択した便" : (route.optionLabel ?? "候補"))}</span><span class="planner-quality">${dot(route.realtimeSource ?? "schedule")}${route.realtimeSource === "live" ? "便別運行情報反映" : route.realtimeSource === "prediction" ? "遅れの推定" : "時刻表"}</span></div><div class="planner-times"><strong>${formatTime(startTime)}</strong><span>→</span><strong>${formatTime(route.time)}</strong><small><b>${shownDuration}</b>分</small></div><p class="planner-route-summary">${routeBadges}</p><div class="planner-metrics"><span>乗換 ${route.transfers}回</span><span>徒歩 ${walk}分</span><span>追加 <b>${yen(route.fare.additional)}</b>${route.fare.additional !== route.fare.normal ? `<small>通常 ${yen(route.fare.normal)}</small>` : ""}</span></div>${passApplied ? '<p class="planner-pass-state">✓ 定期適用 · 区間外は追加運賃</p>' : ""}${route.connectionUnavailable ? '<p class="planner-warning">この便の遅れを反映すると後続の接続がありません。別の便か経路を選んでください。</p>' : route.connectionRisk ? '<p class="planner-warning">推定の遅れでは乗換に間に合わない可能性があります。予定時刻は変更していません。</p>' : ""}<div class="planner-result-actions">${detail ? `<div class="planner-timeline">${timeline.join("")}</div>` : `<button class="native-row planner-open-route" data-open-route="${routeIndex}"><span>経路詳細</span><span class="chevron">›</span></button>`}</div></article>${detail && first && !hideActions && !route.connectionUnavailable ? `<footer class="screen-bottom-action"><button class="primary-action" data-arm-route="${routeIndex}" data-arm-leg="${first.i}">この経路を使う</button></footer>` : ""}`;
}
