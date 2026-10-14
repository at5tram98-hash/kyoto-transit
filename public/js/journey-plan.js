import { planRoutes } from "./router.js";

export const ITINERARY_KEY = "mymap-itinerary-v1";
export function shiftServiceDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export const tripChoiceKey = (leg) =>
  JSON.stringify([
    leg.serviceId,
    leg.tripId,
    leg.serviceDate,
    leg.from,
    leg.to,
  ]);
const isRide = (leg) => leg.kind === "ride";
const minutes = (leg) => leg.arrive - leg.depart;
const clone = (value) => structuredClone(value);

// Times are absolute minutes from the search date; the transport service date
// remains separate, including a previous service day's 24:xx departure.
export function tripOptions(network, request, journey, legIndex) {
  const original = journey.legs[legIndex];
  if (!isRide(original ?? {})) throw Error("乗車区間を選択してください。");
  const prefix = journey.legs.slice(0, legIndex),
    priorRides = prefix.filter(isRide).length,
    ready = priorRides
      ? (prefix.at(-1)?.arrive ?? journey.start) + request.buffer
      : -Infinity,
    pendingVia = (request.via ?? []).slice(
      prefix.filter((l) => l.kind === "dwell").length,
    ),
    options = new Map();
  for (const service of network.services) {
    if (
      service.operator !== original.operator ||
      (original.route && String(service.route) !== String(original.route)) ||
      (request.trainType !== "all" &&
        ["kintetsu", "through"].includes(service.operator) &&
        service.category !== request.trainType)
    )
      continue;
    const from = service.stops.indexOf(original.from),
      to = service.stops.indexOf(original.to);
    if (from < 0 || to <= from) continue;
    for (const trip of service.trips ?? []) {
      if (trip.date !== request.date || typeof trip.id !== "string" || !trip.id)
        continue;
      const depart = trip.departures[from],
        arrive = trip.arrivals[to],
        path = service.stops.slice(from, to + 1),
        variant = service.routeVariants?.[trip.shapeId];
      if (
        !Number.isFinite(depart) ||
        depart < 0 ||
        depart > 2880 ||
        Math.abs(depart - original.depart) > 360
      )
        continue;
      const times = trip.arrivals.slice(from, to + 1),
        departureTimes = trip.departures.slice(from, to + 1),
        known =
          Number.isFinite(arrive) &&
          arrive > depart &&
          arrive <= 2880 &&
          times.every(Number.isFinite),
        viaSkipped =
          pendingVia[0] &&
          pendingVia[0].stop !== original.to &&
          path.slice(1, -1).includes(pendingVia[0].stop),
        reason = !known
          ? "到着時刻を取得できません"
          : variant && (variant.suspended || variant.verified !== true)
            ? "この便の運行区間を確認できません"
            : depart < ready
              ? "前の区間から乗換に間に合いません"
              : viaSkipped
                ? "経由地での滞在を保てません"
                : "";
      const leg = {
        kind: "ride",
        from: original.from,
        to: original.to,
        depart,
        arrive,
        serviceId: service.id,
        tripId: trip.id,
        serviceDate: trip.serviceDate ?? trip.date,
        timeOffset: trip.timeOffset ?? 0,
        operator: service.operator,
        label: service.label,
        category: service.category,
        route: service.route,
        destination: trip.headsign ?? null,
        through: service.through,
        path,
        times,
        departureTimes,
        direction: service.stops.at(-1),
        platform: trip.platforms?.[from] ?? service.platforms?.[from] ?? null,
        arrivalPlatform:
          trip.platforms?.[to] ?? service.platforms?.[to] ?? null,
        platformSource:
          trip.platforms?.[from] || service.platforms?.[from]
            ? "imported"
            : null,
        dataConfidence: service.sourceConfidence ?? "estimated",
        sourceUpdatedAt: service.sourceUpdatedAt,
        ...(trip.realtime
          ? { realtime: trip.realtime, realtimeApplied: trip.realtimeApplied }
          : {}),
      };
      const key = tripChoiceKey(leg);
      options.set(key, {
        key,
        leg,
        available: !reason,
        reason,
        selected:
          service.id === original.serviceId &&
          trip.id === original.tripId &&
          leg.serviceDate === (original.serviceDate ?? request.date),
      });
    }
  }
  return [...options.values()].sort(
    (a, b) => a.leg.depart - b.leg.depart || a.key.localeCompare(b.key),
  );
}

export function replaceJourneyLeg(
  network,
  request,
  passes,
  journey,
  legIndex,
  key,
) {
  const chosen = tripOptions(network, request, journey, legIndex).find(
    (x) => x.key === key,
  );
  if (!chosen)
    throw Error("便の情報が更新されています。候補を開き直してください。");
  if (!chosen.available) throw Error(chosen.reason);
  const leg = clone(chosen.leg),
    prefix = clone(journey.legs.slice(0, legIndex)),
    priorRides = prefix.filter(isRide).length;
  let start = journey.start;
  if (!priorRides) {
    // Choosing an earlier first departure moves only the preceding walk/dwell;
    // choosing a later one keeps the original departure and adds station wait.
    const previousEnd = prefix.at(-1)?.arrive ?? start,
      shift = Math.min(0, leg.depart - previousEnd);
    start += shift;
    for (const item of prefix) {
      item.depart += shift;
      item.arrive += shift;
    }
    if (start < 0)
      throw Error(
        "前日の徒歩・滞在を含む便です。出発日を変更して検索してください。",
      );
  }
  const legs = [...prefix, leg],
    usedWalk = prefix
      .filter((l) => l.kind === "walk")
      .reduce((n, l) => n + l.minutes, 0),
    spent = prefix.reduce((n, l) => n + minutes(l), 0),
    seed = {
      stop: leg.to,
      stage: 0,
      time: leg.arrive,
      boardings: priorRides + 1,
      wait: Math.max(0, leg.depart - start - spent),
      walk: usedWalk,
      legs,
      lastTrip: JSON.stringify([leg.serviceId, leg.serviceDate, leg.tripId]),
    },
    remainingVia = (request.via ?? []).slice(
      prefix.filter((l) => l.kind === "dwell").length,
    ),
    candidates = planRoutes(
      network,
      { ...request, start, via: remainingVia, timeMode: "departure" },
      passes,
      seed,
    ),
    updated = candidates[0];
  if (!updated)
    throw Error("この便から先の接続がありません。別の便を選んでください。");
  return {
    ...updated,
    optionLabel: journey.optionLabel ?? "選択便",
    realtimeSource: updated.legs.some((l) => l.realtime?.source === "live")
      ? "live"
      : updated.legs.some((l) => l.realtime)
        ? "prediction"
        : "schedule",
    changedLeg: legIndex,
    arrivalDeadlineExceeded:
      request.timeMode === "arrival" && updated.time > request.start
        ? updated.time - request.start
        : 0,
  };
}

export function journeyChange(before, after) {
  const oldRides = before.legs.filter(isRide),
    newRides = after.legs.filter(isRide);
  return {
    arrival: after.time - before.time,
    duration: after.duration - before.duration,
    transfers: after.transfers - before.transfers,
    fare:
      Number.isFinite(before.fare?.additional) &&
      Number.isFinite(after.fare?.additional)
        ? after.fare.additional - before.fare.additional
        : null,
    changedTrips: newRides.filter(
      (l, i) => !oldRides[i] || tripChoiceKey(l) !== tripChoiceKey(oldRides[i]),
    ).length,
    deadline: after.arrivalDeadlineExceeded ?? 0,
  };
}

export function samePlannedRide(a, b) {
  return Boolean(
    a &&
      b &&
      a.operator === b.operator &&
      a.serviceId &&
      a.serviceId === b.serviceId &&
      a.tripId &&
      a.tripId === b.tripId &&
      a.serviceDate === b.serviceDate,
  );
}
export function makeItinerary(
  route,
  rides,
  input,
  legIndex,
  { at = Date.now() } = {},
) {
  return {
    version: 1,
    id: `journey:${at}`,
    route: clone(route),
    rides: clone(rides),
    input: clone(input),
    legIndex,
    phase: "armed",
    savedAt: at,
  };
}
export function itineraryDestinationChanged(plan, ride) {
  const destination = ride?.userDestination?.id;
  return Boolean(
    plan?.phase === "riding" &&
      destination &&
      destination !== plan.route.legs[plan.legIndex]?.to,
  );
}
export function nextItineraryLeg(plan) {
  return (
    plan?.route.legs.findIndex((l, i) => i > plan.legIndex && isRide(l)) ?? -1
  );
}
export function itineraryAction(plan) {
  if (!plan) return null;
  const current = plan.route.legs[plan.legIndex],
    next = nextItineraryLeg(plan),
    following = plan.route.legs.slice(
      plan.legIndex + 1,
      next >= 0 ? next : undefined,
    ),
    walk = following
      .filter((l) => l.kind === "walk")
      .reduce((n, l) => n + l.minutes, 0),
    dwell = following
      .filter((l) => l.kind === "dwell")
      .reduce((n, l) => n + l.minutes, 0);
  return {
    current,
    next: next >= 0 ? plan.route.legs[next] : null,
    nextIndex: next,
    walk,
    dwell,
    destination: plan.route.legs.at(-1)?.to,
    final: next < 0,
  };
}
export function advanceItinerary(plan) {
  const next = nextItineraryLeg(plan);
  const walking = plan.route.legs
    .slice(plan.legIndex + 1)
    .some((l) => l.kind === "walk" || l.kind === "dwell");
  return {
    ...plan,
    legIndex: next < 0 ? plan.legIndex : next,
    phase: next < 0 ? (walking ? "walking" : "arrived") : "transfer",
  };
}
function validItinerary(plan, network, at) {
  return (
    plan?.version === 1 &&
    typeof plan.id === "string" &&
    plan.id.length < 100 &&
    ["armed", "riding", "transfer", "walking", "arrived"].includes(
      plan.phase,
    ) &&
    Number.isFinite(plan.savedAt) &&
    plan.savedAt <= at + 60000 &&
    at - plan.savedAt <= 4 * 3600000 &&
    /^\d{4}-\d{2}-\d{2}$/.test(plan.route?.date ?? "") &&
    Array.isArray(plan.route.legs) &&
    plan.route.legs.length > 0 &&
    plan.route.legs.length <= 40 &&
    plan.route.legs.every(
      (l) =>
        [l.depart, l.arrive].every(Number.isFinite) &&
        l.depart >= 0 &&
        l.arrive >= l.depart &&
        l.arrive <= 2880 &&
        network.stops.has(l.from) &&
        network.stops.has(l.to),
    ) &&
    Number.isInteger(plan.legIndex) &&
    isRide(plan.route.legs[plan.legIndex] ?? {}) &&
    Array.isArray(plan.rides) &&
    plan.rides.length === plan.route.legs.length &&
    plan.rides
      .filter(Boolean)
      .every(
        (r) =>
          Array.isArray(r.officialStops) &&
          r.officialStops.length >= 2 &&
          r.officialStops.length <= 250 &&
          typeof r.tripId === "string" &&
          r.tripId.length <= 250 &&
          (!r.fullOfficialStops ||
            (Array.isArray(r.fullOfficialStops) &&
              r.fullOfficialStops.length <= 250 &&
              r.fullOfficialStops.every(
                (s) =>
                  network.stops.has(s.id) &&
                  typeof s.name === "string" &&
                  s.name.length <= 180 &&
                  [s.arrival, s.departure, s.time].every(
                    (t) => t == null || Number.isFinite(t),
                  ),
              ))) &&
          /^\d{4}-\d{2}-\d{2}$/.test(r.serviceDate ?? "") &&
          r.officialStops.every(
            (s) =>
              network.stops.has(s.id) &&
              typeof s.name === "string" &&
              s.name.length <= 180 &&
              [s.arrival, s.departure, s.time].every(
                (t) => t == null || Number.isFinite(t),
              ),
          ),
      ) &&
    Boolean(plan.rides[plan.legIndex])
  );
}
export function readItinerary(storage, network, at = Date.now()) {
  try {
    const raw = storage.getItem(ITINERARY_KEY);
    if (!raw || raw.length > 500000) return null;
    const plan = JSON.parse(raw);
    return validItinerary(plan, network, at) ? plan : null;
  } catch {
    return null;
  }
}
export function writeItinerary(storage, plan, at = Date.now()) {
  try {
    if (!plan) {
      storage.removeItem(ITINERARY_KEY);
      return;
    }
    const raw = JSON.stringify({ ...plan, savedAt: at });
    if (raw.length <= 500000) storage.setItem(ITINERARY_KEY, raw);
    else storage.removeItem(ITINERARY_KEY);
  } catch {
    /* Current navigation still works without browser storage. */
  }
}
