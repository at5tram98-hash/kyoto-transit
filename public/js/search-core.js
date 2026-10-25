import { normalize } from "./network.js";
import { planRoutes, walkingMinutes, allowedService } from "./router.js";
import { replaceJourneyLeg, tripChoiceKey } from "./journey-plan.js";
import { isFresh } from "./realtime.js";
import { cityBusLegRealtime } from "./bus-live-leg.js";

const aliases = (s) =>
  [s.name, s.fullName, ...(s.aliases ?? [])].filter(Boolean).map(normalize);
export function mergeTimetableFeeds(base, feeds, { date } = {}) {
  const index = new Map();
  for (const s of base.stops.values())
    for (const n of aliases(s)) {
      if (!index.has(n)) index.set(n, []);
      index.get(n).push(s);
    }
  const services = [];
  const sourceMeta = [];
  for (const feed of feeds.filter(Boolean)) {
    const map = new Map();
    for (const s of feed.stops ?? []) {
      const native = base.stops.get(s.id),
        matches = index.get(normalize(s.name)) ?? [],
        typed = matches.filter((x) => x.type === feed.meta?.operator),
        compatible = typed.length ? typed : matches;
      const id =
        native && aliases(native).includes(normalize(s.name))
          ? s.id
          : compatible.length === 1
            ? compatible[0].id
            : null;
      if (id) map.set(s.id, id);
    }
    for (const service of feed.services ?? []) {
      const mapped = [];
      for (let i = 0; i < service.stops.length; i++) {
        const id = map.get(service.stops[i]);
        if (!id) continue;
        if (mapped.at(-1)?.id === id) continue;
        mapped.push({ id, index: i });
      }
      if (mapped.length < 2) continue;
      const positions = mapped.map((x) => x.index),
        dedup = mapped.map((x) => x.id);
      const valid = (times) =>
        times.every(
          (t, i) =>
            Number.isFinite(t) ||
            (service.terminalArrivalUnavailable &&
              i === times.length - 1 &&
              t == null),
        );
      const trips = (service.trips ?? [])
        .map((t) => {
          const offset = date
            ? Math.round(
                (Date.parse(`${t.date}T00:00:00Z`) -
                  Date.parse(`${date}T00:00:00Z`)) /
                  60000,
              )
            : 0;
          return {
            ...t,
            serviceDate: t.serviceDate ?? t.date,
            date: date ?? t.date,
            timeOffset: offset,
            arrivals: positions.map((i) =>
              Number.isFinite(t.arrivals[i])
                ? t.arrivals[i] + offset
                : t.arrivals[i],
            ),
            departures: positions.map((i) =>
              Number.isFinite(t.departures[i])
                ? t.departures[i] + offset
                : t.departures[i],
            ),
            ...(t.platforms
              ? { platforms: positions.map((i) => t.platforms[i]) }
              : {}),
          };
        })
        .filter(
          (t) =>
            t.arrivals.length === dedup.length &&
            valid(t.arrivals) &&
            valid(t.departures),
        );
      if (!trips.length) continue;
      services.push({
        ...service,
        stops: dedup,
        platforms: service.platforms
          ? positions.map((i) => service.platforms[i])
          : undefined,
        trips,
        prototype: false,
        sourceConfidence: feed.meta?.stale ? "stale" : "estimated",
        sourceUpdatedAt: feed.lastUpdated ?? feed.meta?.lastUpdated,
      });
    }
    if (feed.meta) sourceMeta.push(feed.meta);
  }
  return {
    ...base,
    services,
    mode: "timetable",
    source: "静的時刻表",
    validDates: [...new Set(feeds.flatMap((f) => f?.validDates ?? []))],
    feedMeta: sourceMeta,
  };
}
const sig = (r) =>
  r.legs
    .map(
      (l) =>
        `${l.kind}:${l.from}:${l.to}:${l.depart}:${l.serviceId ?? ""}:${l.tripId ?? ""}:${l.serviceDate ?? ""}`,
    )
    .join("|");
export function selectThree(routes, { timeMode = "departure" } = {}) {
  if (!routes.length) return [];
  const unique = [...new Map(routes.map((r) => [sig(r), r])).values()],
    pool = unique.map((r) => ({ ...r, key: sig(r) })),
    chosen = [];
  const pick = (label, sorter) => {
    const r = [...pool]
      .filter((x) => !chosen.some((c) => c.key === x.key))
      .sort(sorter)[0];
    if (r) chosen.push({ ...r, optionLabel: label });
  };
  pick(
    "早い",
    timeMode === "arrival"
      ? (a, b) => a.duration - b.duration || b.start - a.start
      : (a, b) => a.time - b.time || a.transfers - b.transfers,
  );
  pick(
    "安い",
    (a, b) =>
      (a.fare.additional ?? Infinity) - (b.fare.additional ?? Infinity) ||
      (a.fare.normal ?? Infinity) - (b.fare.normal ?? Infinity) ||
      a.time - b.time,
  );
  pick(
    "乗換少",
    (a, b) =>
      a.transfers - b.transfers ||
      (timeMode === "arrival" ? b.start - a.start : a.time - b.time),
  );
  while (chosen.length < 3 && chosen.length < pool.length)
    pick(`候補${chosen.length + 1}`, (a, b) =>
      timeMode === "arrival" ? b.start - a.start : a.time - b.time,
    );
  return chosen;
}
function firstDepartureCandidates(network, request, window = 360, limit = 64) {
  const values = new Set(),
    min = request.start - window,
    max = request.start;
  const addAt = (stop, offset = 0) => {
    for (const service of network.services) {
      if (!allowedService(service, request)) continue;
      const i = service.stops.indexOf(stop);
      if (i < 0) continue;
      for (const trip of service.trips ?? []) {
        if (trip.date !== request.date) continue;
        const d = trip.departures[i] - offset;
        if (d >= min && d <= max) values.add(Math.max(0, d));
      }
    }
  };
  const walking = new Map([[request.from, 0]]),
    pending = [request.from];
  while (pending.length) {
    const id = pending.shift(),
      minutes = walking.get(id);
    addAt(id, minutes);
    for (const walk of network.walks.filter((w) => w.from === id)) {
      const total = minutes + walkingMinutes(walk, request);
      if (
        total <= (request.maxWalk ?? 30) &&
        total < (walking.get(walk.to) ?? Infinity)
      ) {
        walking.set(walk.to, total);
        pending.push(walk.to);
      }
    }
  }
  return [...values].sort((a, b) => b - a).slice(0, limit);
}
function actualJourneyStart(route, fallback) {
  const first = route.legs?.[0];
  return Number.isFinite(first?.depart) ? first.depart : fallback;
}
export function searchTimetable(network, request, passes) {
  if (["first", "last"].includes(request.timeMode)) {
    const first = request.timeMode === "first";
    const starts = firstDepartureCandidates(
      network,
      { ...request, start: 2880 },
      2880,
      2881,
    ).sort((a, b) => (first ? a - b : b - a));
    let found = [],
      boundary = first ? Infinity : -Infinity;
    for (const start of starts) {
      if (first && start > boundary) break;
      const routes = planRoutes(
        network,
        { ...request, start, timeMode: "departure", firstDepartureAt: start },
        passes,
      );
      for (const route of routes) {
        if (!route.legs.some((l) => l.kind === "ride")) continue;
        const actual = actualJourneyStart(route, start);
        if (first ? actual < boundary : actual > boundary) {
          boundary = actual;
          found = [];
        }
        if (actual === boundary)
          found.push({
            ...route,
            start: actual,
            duration: Math.ceil(route.time - actual),
          });
      }
      if (!first && found.length) break;
    }
    return selectThree(found, { timeMode: first ? "departure" : "arrival" });
  }
  if (request.previousDeparture) {
    const found = [];
    for (const start of firstDepartureCandidates(network, {
      ...request,
      start: request.start + 1,
    })) {
      for (const r of planRoutes(
        network,
        { ...request, start, timeMode: "departure" },
        passes,
      )) {
        const actualStart = actualJourneyStart(r, start);
        if (actualStart <= request.start)
          found.push({
            ...r,
            start: actualStart,
            duration: Math.ceil(r.time - actualStart),
          });
      }
    }
    const latest = Math.max(...found.map((r) => r.start));
    return selectThree(found.filter((r) => r.start === latest));
  }
  if (request.timeMode !== "arrival")
    return selectThree(planRoutes(network, request, passes), {
      timeMode: "departure",
    });
  const target = request.start,
    found = [];
  for (const start of firstDepartureCandidates(network, request)) {
    const routes = planRoutes(
      network,
      { ...request, start, timeMode: "departure" },
      passes,
    );
    for (const r of routes)
      if (r.time <= target) {
        const actualStart = actualJourneyStart(r, start);
        found.push({
          ...r,
          start: actualStart,
          duration: Math.ceil(r.time - actualStart),
        });
      }
  }
  return selectThree(found, { timeMode: "arrival" });
}
const clampDelay = (n) =>
  Number.isFinite(n) ? Math.max(-5, Math.min(60, n)) : null;
export function realtimeDelayForLeg(
  leg,
  realtime,
  { nowMinute, nowEpoch = Date.now(), network = null } = {},
) {
  // City bus: the approach data of this leg's own boarding stop.
  if (leg.operator === "citybus" && realtime?.citybusByStop)
    return cityBusLegRealtime(leg, realtime.citybusByStop[leg.from], {
      network,
      nowMinute,
      nowEpoch,
      isFresh,
    });
  const feed = ["kintetsu", "through"].includes(leg.operator)
      ? realtime?.rail
      : realtime?.[leg.operator],
    rows = feed?.trains ?? feed?.vehicles ?? feed?.results ?? [],
    exactRows =
      typeof leg.tripId === "string" && leg.serviceDate
        ? rows.filter(
            (row) =>
              row.tripId === leg.tripId &&
              row.serviceDate === leg.serviceDate &&
              (!row.serviceId || row.serviceId === leg.serviceId),
          )
        : [],
    matched = exactRows.length
      ? exactRows
      : rows.filter((row) => {
          if (leg.operator === "citybus" || leg.operator === "kyotobus")
            return (
              String(row.route) === String(leg.route) &&
              (!leg.destination ||
                normalize(row.dest ?? row.destination ?? "") ===
                  normalize(leg.destination))
            );
          return (
            (!leg.category || row.category === leg.category) &&
            Boolean(leg.destination) &&
            normalize(row.dest ?? row.destination ?? "") ===
              normalize(leg.destination)
          );
        });
  // A route number/category alone cannot identify a particular scheduled trip.
  if (
    matched.length !== 1 ||
    !Number.isFinite(nowMinute) ||
    leg.depart < nowMinute - 10 ||
    leg.depart > nowMinute + 30
  )
    return null;
  const row = matched[0],
    asOf = row.asOf ?? feed.asOf,
    fresh =
      !feed.stale &&
      !row.predicted &&
      row.fresh !== false &&
      feed.source !== "prediction" &&
      row.source !== "prediction" &&
      isFresh(asOf, 90000, nowEpoch),
    exact = exactRows.length === 1 && fresh,
    delay = Number.isFinite(row.delay)
      ? clampDelay(row.delay)
      : leg.operator === "citybus" && Number.isFinite(row.minutes)
        ? clampDelay(nowMinute + row.minutes - leg.depart)
        : null;
  return delay === null
    ? null
    : { delay, source: exact ? "live" : "prediction", exact, asOf };
}
export function applyRealtime(route, realtime, context = {}) {
  const legs = route.legs.map((leg) =>
      leg.kind === "ride"
        ? { ...leg, realtime: realtimeDelayForLeg(leg, realtime, context) }
        : { ...leg },
    ),
    observations = legs.filter((leg) => leg.realtime),
    last = legs.at(-1),
    connectionRisk = legs.some((leg, i) => {
      if (!leg.realtime?.delay) return false;
      const next = legs.slice(i + 1).findIndex((l) => l.kind === "ride");
      if (next < 0) return false;
      const following = legs.slice(i + 1, i + next + 1),
        nextRide = legs[i + next + 1];
      return (
        leg.arrive +
          (leg.realtimeApplied ? 0 : Math.max(0, leg.realtime.delay)) +
          following.reduce((sum, l) => sum + (l.minutes ?? 0), 0) +
          (context.buffer ?? 0) >
        nextRide.depart
      );
    });
  return {
    ...route,
    legs,
    realtimeSource: observations.length
      ? observations.some((l) => l.realtime.source === "live")
        ? "live"
        : "prediction"
      : "schedule",
    realtimeDelay: Math.max(0, ...observations.map((l) => l.realtime.delay)),
    estimatedTime: last?.realtime
      ? last.arrive + (last.realtimeApplied ? 0 : last.realtime.delay)
      : null,
    connectionRisk,
  };
}
export function networkWithObservations(
  network,
  journey,
  nowEpoch = Date.now(),
) {
  // Exact trip observations, and city-bus positions (the leg's bus as seen
  // in its stop's approach data): both move that trip's times.
  const observations = journey.legs.filter(
    (l) =>
      (l.realtime?.exact || Number.isFinite(l.realtime?.eta)) &&
      isFresh(l.realtime.asOf, 90000, nowEpoch),
  );
  if (!observations.length) return network;
  return {
    ...network,
    services: network.services.map((service) => ({
      ...service,
      trips: (service.trips ?? []).map((trip) => {
        const leg = observations.find(
          (l) =>
            l.serviceId === service.id &&
            l.tripId === trip.id &&
            l.serviceDate === (trip.serviceDate ?? trip.date),
        );
        if (!leg) return trip;
        const shift = leg.realtime.delay;
        return {
          ...trip,
          arrivals: trip.arrivals.map((t) =>
            Number.isFinite(t) ? t + shift : t,
          ),
          departures: trip.departures.map((t) =>
            Number.isFinite(t) ? t + shift : t,
          ),
          realtime: leg.realtime,
          realtimeApplied: true,
        };
      }),
    })),
  };
}
export function reconcileRealtime(
  network,
  request,
  passes,
  journey,
  realtime,
  context,
) {
  const annotated = applyRealtime(journey, realtime, {
      ...context,
      network,
      buffer: request.buffer,
    }),
    first = annotated.legs.findIndex(
      (l) => l.realtime?.exact || (Number.isFinite(l.realtime?.eta) && l.realtime.delay !== 0),
    ),
    adjusted = networkWithObservations(network, annotated, context.nowEpoch);
  if (first < 0) return annotated;
  try {
    return replaceJourneyLeg(
      adjusted,
      request,
      passes,
      annotated,
      first,
      tripChoiceKey(annotated.legs[first]),
    );
  } catch {
    return { ...annotated, connectionUnavailable: true };
  }
}
export function staleWarnings(network) {
  return [
    ...new Set(
      (network.feedMeta ?? [])
        .filter((m) => m.stale || m.warning)
        .map(
          (m) => m.warning ?? `${m.operator}の時刻データを確認してください。`,
        ),
    ),
  ];
}
export function dayKind(date, { holidays = new Set() } = {}) {
  if (holidays.has(date)) return "holiday";
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? "holiday" : d === 6 ? "saturday" : "weekday";
}
