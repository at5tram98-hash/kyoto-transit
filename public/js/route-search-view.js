import { esc } from "./vnext-state.js";
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

export function routeHTML(
  route,
  network,
  rides = [],
  routeIndex = 0,
  current,
  detail = false,
) {
  const name = (id) => network.stops.get(id)?.name ?? id;
  const available = route.legs
    .map((leg, i) => ({ leg, i }))
    .filter(({ i }) => rides[i]);
  const first = available[0];
  const line = route.legs
    .filter((l) => l.kind === "ride")
    .map((l) =>
      l.route ? `${l.route}系統` : (operatorLabel[l.operator] ?? l.label),
    )
    .join(" → ");
  const walk = route.legs
    .filter((l) => l.kind === "walk")
    .reduce((sum, l) => sum + l.minutes, 0);
  const legs = route.legs
    .map((leg, legIndex) => {
      if (leg.kind !== "ride")
        return `<div class="planner-leg walk"><time>${formatTime(leg.depart)}</time><span class="planner-line"></span><div><b>${leg.kind === "walk" ? "徒歩" : leg.kind === "dwell" ? "滞在" : "待ち"} ${leg.minutes}分</b><small>${esc(name(leg.from))}${leg.kind === "walk" ? ` → ${esc(name(leg.to))}` : ""}</small></div></div>`;
      const ride = rides[legIndex];
      const intermediate = (leg.path ?? []).slice(1, -1);
      const stops =
        detail && intermediate.length
          ? `<details class="planner-leg-stops"><summary>途中の停車駅 · ${intermediate.length}駅</summary><ol>${intermediate.map((id, j) => `<li><span>${esc(name(id))}</span><time>${Number.isFinite(leg.times?.[j + 1]) ? formatTime(leg.times[j + 1] + (leg.realtime?.delay ?? 0)) : "時刻未取得"}</time></li>`).join("")}</ol></details>`
          : "";
      const actions = `${ride && boardingAvailable(ride, current) ? `<button class="plain-action planner-board" data-board-route="${routeIndex}" data-board-leg="${legIndex}">この便に乗車中 · 案内を開始 ›</button>` : ""}${ride && first?.i !== legIndex ? `<button class="plain-action" data-arm-route="${routeIndex}" data-arm-leg="${legIndex}">この区間で案内を準備 ›</button>` : ""}`;
      return `<div class="planner-leg ride"><time>${formatTime(leg.depart)}</time><span class="planner-line"></span><div><b>${esc(leg.route ? `${leg.route}系統` : (operatorLabel[leg.operator] ?? leg.label))}</b><small>${esc(name(leg.from))} → ${esc(name(leg.to))}</small><small>${esc(leg.destination ?? "行先未確認")}${leg.destination ? "行" : ""} · ${formatTime(leg.arrive)}着${leg.realtime?.delay ? ` · +${leg.realtime.delay}分` : ""}</small>${leg.platform ? `<small>のりば ${esc(leg.platform)} · 時刻表記載</small>` : ""}${stops}${actions ? `<div class="planner-leg-actions">${actions}</div>` : ""}</div></div>`;
    })
    .join("");
  return `<article class="planner-result"><div class="planner-result-head"><span class="planner-badge">${esc(route.optionLabel ?? "候補")}</span><span class="planner-quality">${dot(route.realtimeSource ?? "schedule")}${route.realtimeSource === "live" ? "運行情報反映" : "時刻表"}</span></div><div class="planner-times"><strong>${formatTime(route.start)}</strong><span>→</span><strong>${formatTime(route.time)}</strong><small><b>${route.duration}</b>分</small></div><p class="planner-route-summary">${esc(line)}</p><div class="planner-metrics"><span>乗換 ${route.transfers}回</span><span>徒歩 ${walk}分</span><span>追加 <b>${yen(route.fare.additional)}</b>${route.fare.additional !== route.fare.normal ? `<small>通常 ${yen(route.fare.normal)}</small>` : ""}</span></div><div class="planner-result-actions">${detail ? `<div class="planner-timeline">${legs}</div>` : `<button class="native-row planner-open-route" data-open-route="${routeIndex}"><span>経路詳細</span><span class="chevron">›</span></button>`}</div></article>${detail && first ? `<footer class="screen-bottom-action"><button class="primary-action" data-arm-route="${routeIndex}" data-arm-leg="${first.i}">この経路を使う</button></footer>` : ""}`;
}
