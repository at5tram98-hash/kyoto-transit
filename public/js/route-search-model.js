import { ui } from "./locale.js";
import { normalize } from "./network.js";
import { stationModel } from "./now-model.js";
import { isFresh } from "./realtime.js";

// A persisted observation keeps its historic estimate, never its Live status.
export function routeObservationState(
  observations,
  { now = Date.now(), online = globalThis.navigator?.onLine !== false } = {},
) {
  const rows = observations.filter(Boolean);
  if (!rows.length)
    return { source: "schedule", label: ui("route_search_model_001") };
  if (!online)
    return { source: "prediction", label: ui("route_search_model_002") };
  if (
    rows.some((row) => row.source === "live" && isFresh(row.asOf, 90000, now))
  )
    return { source: "live", label: ui("route_search_model_003") };
  if (rows.every((row) => !isFresh(row.asOf, 90000, now)))
    return { source: "prediction", label: ui("route_search_model_004") };
  return { source: "prediction", label: ui("route_search_model_005") };
}

const fold = (value) => normalize(String(value)).toLocaleLowerCase("en");
export const stopTypeLabel = (stop) =>
  ({
    subway: ui("route_search_model_006"),
    kintetsu: ui("route_search_model_007"),
    citybus: ui("route_search_model_008"),
    kyotobus: ui("route_search_model_009"),
  })[stop.type] ?? ui("route_search_model_010");
const terms = (stop) =>
  [
    stop.name,
    stop.fullName,
    stop.id,
    stationModel(stop)?.en,
    ...(stop.aliases ?? []),
    ...(stop.lines ?? []),
  ]
    .filter(Boolean)
    .map(fold);
export function stopSuggestions(network, query, limit = 8) {
  const q = fold(String(query ?? "").trim());
  if (!q) return [];
  return [...network.stops.values()]
    .map((stop) => {
      const values = terms(stop);
      const rank = values.includes(q)
        ? 0
        : values.some((n) => n.startsWith(q))
          ? 1
          : values.some((n) => n.includes(q))
            ? 2
            : 3;
      return { stop, rank };
    })
    .filter((x) => x.rank < 3)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.stop.name.localeCompare(b.stop.name, "ja") ||
        a.stop.id.localeCompare(b.stop.id),
    )
    .slice(0, limit)
    .map((x) => x.stop);
}
export function resolveStop(network, value, selectedId) {
  const q = fold(String(value ?? "").trim()),
    selected = network.stops.get(selectedId);
  if (
    selected &&
    [
      selected.name,
      selected.fullName,
      ...(selected.aliases ?? []),
      selected.id,
      stationModel(selected)?.en,
    ]
      .filter(Boolean)
      .some((n) => fold(n) === q)
  )
    return { stop: selected };
  const matches = [...network.stops.values()].filter((s) =>
    [s.name, s.fullName, ...(s.aliases ?? []), s.id, stationModel(s)?.en]
      .filter(Boolean)
      .some((n) => fold(n) === q),
  );
  return matches.length === 1
    ? { stop: matches[0] }
    : { stop: null, ambiguous: matches.length > 1, matches };
}
export function sortedRouteIndexes(routes, order = "arrival") {
  const fare = (r) =>
    Number.isFinite(r.fare?.additional) ? r.fare.additional : Infinity;
  return routes
    .map((_, i) => i)
    .sort((a, b) => {
      const x = routes[a],
        y = routes[b];
      return (
        (order === "fare"
          ? fare(x) - fare(y) || x.time - y.time
          : order === "transfers"
            ? x.transfers - y.transfers || x.time - y.time
            : x.time - y.time || x.transfers - y.transfers) || a - b
      );
    });
}
export function nextDepartureInput(input, routes, direction = 1) {
  const first = routes
    .map((r) => {
      const i = r.legs.findIndex((l) => l.kind === "ride");
      return i < 0
        ? null
        : r.legs[i].depart -
            r.legs.slice(0, i).reduce((sum, l) => sum + (l.minutes ?? 0), 0);
    })
    .filter(Number.isFinite);
  if (!first.length || !validSearchInput(input)) return null;
  const minute = Math.min(...first) + (direction < 0 ? -1 : 1),
    days = Math.floor(minute / 1440),
    d = new Date(`${input.date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return {
    ...input,
    date: d.toISOString().slice(0, 10),
    time: `${String(Math.floor((((minute % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((minute % 60) + 60) % 60).padStart(2, "0")}`,
    timeMode: "departure",
  };
}
const string = (x) => typeof x === "string" && x.length > 0 && x.length <= 180;
export function validSearchInput(input) {
  if (
    !input ||
    !string(input.from) ||
    !string(input.to) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ||
    !["arrival", "departure", "first", "last"].includes(input.timeMode)
  )
    return false;
  const d = new Date(`${input.date}T00:00:00Z`);
  if (
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== input.date
  )
    return false;
  return (
    Array.isArray(input.via) &&
    input.via.length <= 3 &&
    input.via.every(
      (v) =>
        v &&
        string(v.name) &&
        typeof v.id === "string" &&
        v.id.length <= 100 &&
        Number.isFinite(v.dwell) &&
        v.dwell >= 0 &&
        v.dwell <= 180,
    ) &&
    (!input.walkSpeed ||
      ["slow", "standard", "fast"].includes(input.walkSpeed)) &&
    (!input.operators ||
      (typeof input.operators === "string" &&
        input.operators
          .split(",")
          .every((op) =>
            ["subway", "kintetsu", "citybus", "kyotobus"].includes(op),
          ))) &&
    ["all", "local", "express"].includes(input.trainType) &&
    [1, 3, 5, 10].includes(Number(input.buffer)) &&
    [10, 20, 30].includes(Number(input.maxWalk))
  );
}
export function searchShareURL(base, input) {
  if (!validSearchInput(input)) return null;
  const url = new URL(base);
  url.search = "";
  url.hash = "#/now/search";
  const safe = { ...input };
  delete safe.sort;
  url.searchParams.set("routeSearch", JSON.stringify(safe));
  return url.href;
}
export function readSharedSearch(url, network) {
  try {
    const text = new URL(url).searchParams.get("routeSearch");
    if (!text || text.length > 2500) return null;
    const raw = JSON.parse(text);
    const input = Object.fromEntries(
      [
        "from",
        "to",
        "fromId",
        "toId",
        "date",
        "time",
        "timeMode",
        "operators",
        "walkSpeed",
        "trainType",
        "buffer",
        "maxWalk",
        "via",
      ]
        .filter((k) => raw[k] !== undefined)
        .map((k) => [k, raw[k]]),
    );
    if (!validSearchInput(input)) return null;
    if (
      !resolveStop(network, input.from, input.fromId).stop ||
      !resolveStop(network, input.to, input.toId).stop ||
      input.via.some((v) => !resolveStop(network, v.name, v.id).stop)
    )
      return null;
    return input;
  } catch {
    return null;
  }
}

export const previousDepartureInput = (input, routes) =>
  nextDepartureInput(input, routes, -1);
