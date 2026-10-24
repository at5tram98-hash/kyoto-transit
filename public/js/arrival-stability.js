import { ui } from "./locale.js";
import { isFresh, LIVE_MAX_AGE } from "./realtime.js";
const railRideOperators = new Set(["kintetsu", "through"]);
export function normalizedBusSources(
  data,
  {
    now = Date.now(),
    maxAge = LIVE_MAX_AGE,
    online = globalThis.navigator?.onLine !== false,
  } = {},
) {
  return (data?.results ?? []).map((row) => {
    const fresh =
        online &&
        !data.stale &&
        data.source !== "prediction" &&
        isFresh(row.asOf ?? data.asOf, maxAge, now),
      source =
        row.source === "live" && !fresh
          ? "prediction"
          : (row.source ?? "schedule");
    return {
      ...row,
      source,
      asOf: Number.isFinite(row.scheduledDeparture)
        ? (row.asOf ?? null)
        : (row.asOf ?? data.asOf),
    };
  });
}
export function busPreviewRows(data, limit = 3, options = {}) {
  return normalizedBusSources(data, options)
    .filter(
      (row) =>
        Number.isFinite(row.minutes) ||
        Number.isFinite(row.stopsAway) ||
        Number.isFinite(row.scheduledDeparture),
    )
    .sort(
      (a, b) =>
        (a.source === "live" ? 0 : 1) - (b.source === "live" ? 0 : 1) ||
        (Number.isFinite(a.minutes) ? a.minutes : Infinity) -
          (Number.isFinite(b.minutes) ? b.minutes : Infinity) ||
        (Number.isFinite(a.stopsAway) ? a.stopsAway : Infinity) -
          (Number.isFinite(b.stopsAway) ? b.stopsAway : Infinity) ||
        String(a.route).localeCompare(String(b.route), "ja"),
    )
    .slice(0, limit);
}
const routeNumber = (value) => {
  const n = Number(String(value ?? "").match(/\d+/)?.[0]);
  return Number.isFinite(n) ? n : 9999;
};
export function busDirectionLabel(route, dest = "") {
  const text = String(dest)
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/方面$/, "");
  if (String(route) === "204") {
    if (/銀閣寺|高野/.test(text)) return ui("bus_direction", ["高野・銀閣寺"]);
    if (/金閣寺|円町/.test(text)) return ui("bus_direction", ["金閣寺"]);
  }
  if (!text) return ui("bus_direction_unknown");
  return ui("bus_direction", [text]);
}
export function busServiceLabel(row) {
  const board = String(row?.boarding ?? "").trim();
  return `${row.route}（${busDirectionLabel(row.route, row.dest)}）${board ? ` ${board}` : ""}`;
}
const effectiveBusSource = (row) => row.source ?? "schedule";
const congestionRank = (value) =>
  ({ 満員: 5, 大変混雑: 4, 混雑: 3, ゆったり立てる: 2, 空席あり: 1 })[value] ??
  0;
export function normalizeCongestion(value) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .trim();
  if (/満員/.test(text)) return "満員";
  if (/大変混雑|たいへん混雑/.test(text)) return "大変混雑";
  if (/ゆったり立て/.test(text)) return "ゆったり立てる";
  if (/混雑/.test(text)) return "混雑";
  if (/空席|すいて|空いて|通常|普通/.test(text)) return "空席あり";
  return "";
}
export const busServiceKey = (row) =>
  `${row.route}|${String(row.dest ?? "").normalize("NFKC")}|${String(row.boarding ?? "").normalize("NFKC")}`;
export function groupCityBusRows(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = busServiceKey(row);
    if (!groups.has(key))
      groups.set(key, {
        ...row,
        key,
        arrivals: [],
        source: "schedule",
        congestion: "",
      });
    const group = groups.get(key),
      source = effectiveBusSource(row);
    group.arrivals.push({ ...row, source });
    if (source === "live") group.source = "live";
    else if (group.source !== "live" && source === "prediction")
      group.source = "prediction";
    if (
      Number.isFinite(row.delay) &&
      (group.delay == null || Math.abs(row.delay) > Math.abs(group.delay))
    )
      group.delay = row.delay;
    const c = normalizeCongestion(row.congestion);
    if (congestionRank(c) > congestionRank(group.congestion))
      group.congestion = c;
  }
  const sourceRank = (row) =>
    row.source === "live" ? 0 : row.source === "prediction" ? 1 : 2;
  const imminent = (row) =>
    row.source === "live" &&
    ((Number.isFinite(row.minutes) && row.minutes <= 1) ||
      (Number.isFinite(row.stopsAway) && row.stopsAway <= 1));
  for (const group of groups.values())
    group.arrivals.sort((a, b) => {
      const priority =
        sourceRank(a) - sourceRank(b) ||
        Number(imminent(b)) - Number(imminent(a));
      if (priority) return priority;
      const am = Number.isFinite(a.minutes) ? a.minutes : Infinity,
        bm = Number.isFinite(b.minutes) ? b.minutes : Infinity;
      if (am !== bm) return am - bm;
      const as = Number.isFinite(a.stopsAway) ? a.stopsAway : Infinity,
        bs = Number.isFinite(b.stopsAway) ? b.stopsAway : Infinity;
      return as - bs || String(a.key).localeCompare(String(b.key));
    });
  return [...groups.values()].sort(
    (a, b) =>
      routeNumber(a.route) - routeNumber(b.route) ||
      busDirectionLabel(a.route, a.dest).localeCompare(
        busDirectionLabel(b.route, b.dest),
        "ja",
      ) ||
      String(a.boarding ?? "").localeCompare(String(b.boarding ?? ""), "ja"),
  );
}
function arrivalLabel(row) {
  if (Number.isFinite(row?.minutes))
    return ui("arrival_in_minutes", [Math.max(0, Math.round(row.minutes))]);
  if (Number.isFinite(row?.stopsAway))
    return ui("arrival_stops_away", [Math.max(0, Math.round(row.stopsAway))]);
  if (Number.isFinite(row?.scheduledDeparture))
    return `${ui("arrival_next_scheduled")} ${String(Math.floor(row.scheduledDeparture / 60) % 24).padStart(2, "0")}:${String(row.scheduledDeparture % 60).padStart(2, "0")}`;
  return row?.status ?? "";
}
// Absolute ETA must stay anchored to the observation, even if a cached row
// is rendered again later. A stop count is never a time estimate.
export function busArrivalEpoch(row) {
  const epoch = value => typeof value === "number" ? value : Date.parse(value);
  const eta = epoch(row?.eta);
  if (Number.isFinite(eta)) return eta;
  const observed = epoch(row?.asOf);
  return Number.isFinite(row?.minutes) && Number.isFinite(observed)
    ? observed + Math.max(0, row.minutes) * 60000 : null;
}
export function busArrivalText(row) {
  const labels = (row.arrivals ?? [row])
    .map(arrivalLabel)
    .filter(Boolean)
    .slice(0, 2);
  return labels.length ? labels.join("・") : "—";
}
export function busCongestionText(row) {
  const first = (row.arrivals ?? [row]).find((x) =>
    normalizeCongestion(x.congestion),
  );
  return normalizeCongestion(first?.congestion ?? row?.congestion) || "—";
}
export function shouldShowKintetsuArrival({
  locationStatus,
  rideOperator,
  kintetsuMeters = Infinity,
} = {}) {
  if (railRideOperators.has(rideOperator)) return true;
  return (
    locationStatus === "rail" &&
    Number.isFinite(kintetsuMeters) &&
    kintetsuMeters <= 500
  );
}
export function relevantMissingOperators(
  missing = [],
  planned = [],
  fromType = "",
  toType = "",
  fromId = "",
  toId = "",
) {
  const used = new Set(
    planned.flatMap((route) =>
      (route.legs ?? [])
        .filter((l) => l.kind === "ride")
        .map((l) => l.operator),
    ),
  );
  if (used.size) return missing.filter((item) => used.has(item.operator));
  const needed = new Set();
  const addType = (type) => {
    if (type === "subway") needed.add("subway");
    else if (type === "kintetsu") needed.add("kintetsu");
    else if (type === "citybus") needed.add("citybus");
    else if (type === "kyotobus") needed.add("kyotobus");
  };
  addType(fromType);
  addType(toType);
  if (fromId === "ksu" || toId === "ksu") needed.add("kyotobus");
  return missing.filter((item) => needed.has(item.operator));
}
