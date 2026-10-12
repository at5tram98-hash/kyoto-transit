import { esc } from "./vnext-state.js";
import { formatMinute } from "./vnext-core.js";
import { stationModel } from "./now-model.js";

export function routeBadge(model, { small = false } = {}) {
  const badges = model.boundary?.codes ?? [
    model.bus ? (model.route ?? "バス") : model.lineId,
  ];
  return `<span class="route-tokens ${model.boundary ? "boundary" : ""}">${[
    0, 1,
  ]
    .map((index) => {
      const code = badges[index] ?? "";
      return `<span class="route-token ${small ? "small" : ""} ${code.startsWith("K") ? "line-k" : code.startsWith("B") ? "line-b" : "line-bus"}" ${code ? "" : "hidden"}>${esc(code)}</span>`;
    })
    .join("")}</span>`;
}
export function statusPill(confidence, text, updated) {
  const labels = {
    confirmed: "現在地と一致",
    estimated: "推定",
    stale: "古いデータ",
    unavailable: "時刻未取得",
  };
  return `<span class="status-pill ${confidence}">${esc(text ?? labels[confidence])}${confidence === "stale" && updated ? `<time> · ${esc(new Date(updated).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }))}更新</time>` : ""}</span>`;
}
export function estimateTime(value, confidence) {
  return Number.isFinite(value)
    ? `${formatMinute(Math.round(value))}<small>${confidence === "confirmed" ? "予定" : "推定"}</small>`
    : "<small>時刻未取得</small>";
}
export function nextStationHero(model, ride, progress) {
  const next = model.nextStation,
    destination = model.userDestination;
  const duration = model.routeUnavailable
    ? "運休・経路変更を確認してください"
    : model.phase === "STOPPED"
      ? `停車中${model.nextNext ? ` · 次は ${model.nextNext.name}` : " · 終点"}`
      : model.minutes === null
        ? "到着時刻を確認中"
        : model.minutes === 0
          ? "まもなく到着（推定）"
          : `あと${model.minutes}分で到着${model.confidence === "confirmed" ? "予定" : "見込み（推定）"}`;
  const spoken = `${model.label} ${next?.name ?? "確認中"} ${next?.code ?? ""}、${duration}、目的地${destination?.name ?? "未設定"}まで${model.remainingStops}${model.bus ? "停留所" : "駅"}`;
  const start = Math.max(0, model.index - 1),
    end = Math.min(
      progress.stops.length,
      Math.max(start + 4, Math.min(progress.stops.length, start + 4)),
    );
  const strip = progress.stops.slice(start, end).map((s) => stationModel(s));
  const source =
    model.locationConfidence === "available"
      ? `現在地：${progress.stops[progress.currentIndex]?.name ?? progress.previous?.name ?? "駅間"}付近`
      : "現在位置は未取得 · 時刻表から推定";
  return `<section class="hero-card aboard journey-display ${model.bus ? "bus" : model.lineId === "B" ? "rail" : "subway"}" data-train-state="${model.trainState}" data-phase="${model.phase}" data-line="${model.lineId}">
    ${model.routeUnavailable || (model.delayMinutes ?? 0) >= 10 ? `<p class="journey-warning" role="status">${model.routeUnavailable ? "運休・経路変更を確認してください。現在位置は未確認です。" : `約${model.delayMinutes}分の遅れ（推定）。運行情報をご確認ください。`}</p>` : ""}
    <div class="route-header">${routeBadge({ ...model, route: ride.route })}<div><h2>${esc(model.bus ? `${ride.route ?? ""}系統${ride.route === "北3" ? " / North 3" : ""}` : model.lineId === "K" ? "烏丸線" : "近鉄京都線")} <span>${esc(model.destination ?? "行先確認中")}行き</span></h2><p>${esc(model.bus ? (ride.operatingCompany === "kyotobus" ? "京都バス運行" : ride.operatingCompany === "citybus" ? "京都市バス運行" : (ride.operatingCompany ?? (ride.route === "北3" ? "京都市バス · 便により京都バス" : "運行事業者を確認中"))) : model.serviceType)}${model.boundary ? " · 乗換不要" : ""}</p></div>${statusPill(model.confidence)}</div>
    <div class="next-station-hero" role="img" aria-label="${esc(spoken)}">
      <div class="next-state-label">${esc(model.label)}</div><div class="next-station-title"><strong class="journey-next-name">${esc(next?.name ?? "確認中")}</strong>${!model.bus && next?.code ? `<span class="station-code">${esc(model.boundary ? model.boundary.codes.join(" / ") : next.code)}</span>` : ""}</div>
      ${next?.en ? `<div class="station-en">${esc(next.en)}</div>` : ""}<p class="next-countdown">${esc(duration)}</p>
      <p class="destination-progress">${model.routeUnavailable ? "停車順を確認中" : model.nextIsDestination ? (model.bus ? "この停留所で降ります" : "この駅で降ります") : `次駅から降車駅「${esc(destination?.name ?? "未設定")}」まであと${model.remainingStops}${model.bus ? "停留所" : "駅"}`}</p>
      <details class="station-overview" open><summary>停車駅の並び</summary><div class="station-strip" aria-hidden="true">${strip.map((s) => `<span class="${s.id === next?.id ? "selected" : ""}"><i></i><b>${esc(s.name)}</b></span>`).join("")}</div></details>
    </div>
    <button class="personal-destination" data-context-action="destination"><span><small>あなたの降車${model.bus ? "停留所" : "駅"}</small><b>${esc(destination?.name ?? "設定する")} ${model.bus ? "" : esc(destination?.code)}</b></span><strong>${estimateTime(model.destinationArrival, model.confidence)}</strong></button>
    ${model.throughNotice ? `<p class="through-notice">${esc(model.throughNotice)}</p>` : ""}${model.boundary ? `<p class="through-notice">${model.boundary.phase === "stopped" ? "竹田に停車中。" : "竹田で"}${model.boundary.nextLine === "B" ? "近鉄京都線" : "地下鉄烏丸線"}へ直通 · ${esc(model.serviceType)} ${esc(model.destination)}行き · 乗換不要</p>` : ""}
    <div class="ride-meta"><span class="position-source journey-location-status">${esc(source)}</span><span class="journey-delay">${model.delayMinutes === null ? "遅れ情報未取得" : `約${model.delayMinutes}分${model.delayMinutes > 0 ? "の遅れ" : "・ほぼ定刻"}（推定）`}</span></div>
    ${model.confidence === "stale" ? `<p class="source-note">${statusPill("stale", null, model.lastUpdated)} · 保存したダイヤの予定時刻を表示</p>` : ""}

  </section>`;
}

export function timelineRow(
  stop,
  { index, progress, minute, shift, bus, ride },
) {
  const planned = [stop.arrival, stop.time, stop.departure].find(
      Number.isFinite,
    ),
    adjusted = Number.isFinite(planned) ? planned + shift : null;
  const passed =
    progress.currentIndex >= 0
      ? index < progress.currentIndex
      : Number.isFinite(adjusted)
        ? adjusted < minute - 0.5
        : index < progress.nextIndex;
  const current = index === progress.currentIndex,
    next = index === progress.nextIndex,
    destination =
      stop.id ===
      (ride.userDestination?.id ?? ride.userDestinationId ?? ride.to),
    boarding = stop.id === ride.from;
  return `<li class="${passed ? "passed" : ""} ${next ? "next" : ""} ${current ? "current" : ""} ${destination ? "destination" : ""} ${boarding ? "boarding" : ""}" ${next ? 'aria-current="step"' : ""}><button class="station-dot-button" data-station-detail="${esc(stop.id)}" aria-label="${esc(stop.name)}の詳細"><span class="rail-dot"></span></button><button class="station-name-button" data-station-detail="${esc(stop.id)}"><b>${esc(stop.name)}</b><small>${current ? "現在地付近" : destination ? "降車予定" : boarding ? "乗車駅" : index === progress.stops.length - 1 ? "終点" : next ? `次の${bus ? "停留所" : "停車駅"}` : ""}</small></button><div class="stop-times">${Number.isFinite(adjusted) ? `<time>${formatMinute(Math.round(adjusted))}</time><small>${stop.estimated ? "推定時刻" : `予定 ${formatMinute(planned)}`}</small><span>${shift > 0 ? `+${Math.round(shift)}分 推定` : "予定"}</span>` : "<small>時刻未取得</small>"}</div></li>`;
}
