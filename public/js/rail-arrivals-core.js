import { railDestinationName } from "./rail-names.js";
import {
  kintetsuIds,
  subwayIds,
  KINTETSU_NAMES,
  normalize,
  SUBWAY_NAMES,
} from "./network.js";
import { railTimetableEta } from "./vnext-core.js";

export function buildRailArrivalRows(predicted, timetable, target, nowMinute) {
  const targetIndex = kintetsuIds.indexOf(target),
    targetCell = targetIndex >= 0 ? targetIndex * 2 + 1 : null;
  if (targetCell === null) return [];
  const rows = [];
  for (const t of predicted?.trains ?? []) {
    const pos = Number(t.position),
      approaching =
        t.direction === "south" ? pos <= targetCell : pos >= targetCell;
    if (
      !["north", "south"].includes(t.direction) ||
      !Number.isFinite(pos) ||
      t.position == null ||
      t.position === "" ||
      !approaching
    )
      continue;
    const destinationToken = (value) =>
      normalize(
        railDestinationName(value).replace(/近鉄|大和|方面|行き?$|駅$/g, ""),
      );
    const destination = destinationToken(t.dest ?? t.destination);
    const terminus = KINTETSU_NAMES.findIndex(
      (name) => destinationToken(name) === destination,
    );
    if (
      terminus >= 0 &&
      (t.direction === "south"
        ? terminus < targetIndex
        : terminus > targetIndex)
    )
      continue;
    const knownPatterns = (timetable?.services ?? []).filter(
      (service) =>
        service.category === t.category &&
        service.trips?.some(
          (trip) => destinationToken(trip.headsign) === destination,
        ),
    );
    if (
      knownPatterns.length &&
      !knownPatterns.some((service) => service.stops.includes(target))
    )
      continue;
    const matched = Number.isFinite(nowMinute)
        ? railTimetableEta(timetable, t, target, nowMinute)
        : null,
      minutes = matched ? Math.max(0, matched.minutes) : null;
    if (Number.isFinite(minutes) && minutes > 30) continue;
    rows.push({
      ...t,
      dest: railDestinationName(t.dest ?? t.destination),
      key: t.key ?? `${t.direction}:${pos}:${t.dest}`,
      minutes,
      status: matched ? null : "時刻未確定",
      etaSource: matched ? "timetable" : null,
      tripId: matched?.tripId,
      serviceId: matched?.serviceId,
      stationsAway: Math.abs(targetIndex - (pos - 1) / 2),
      source: t.predicted ? "prediction" : "live",
      operator: "kintetsu",
      railPosition: (pos - 1) / 2,
    });
  }
  rows.sort(
    (a, b) =>
      (Number.isFinite(a.minutes) ? a.minutes : Infinity) -
        (Number.isFinite(b.minutes) ? b.minutes : Infinity) ||
      String(a.dest).localeCompare(String(b.dest), "ja"),
  );
  return rows.slice(0, 12);
}

// Same official trips used by the planner; no interval-generated services.
export function stationTimetableRows(feed, target, { date, minute }) {
  const axis =
    feed?.meta?.operator === "kintetsu" ||
    feed?.services?.some((s) => ["kintetsu", "through"].includes(s.operator))
      ? kintetsuIds
      : target.startsWith("K")
        ? subwayIds
        : kintetsuIds;
  const result = [];
  for (const service of feed?.services ?? []) {
    const targetIndex = service.stops.indexOf(target);
    if (targetIndex < 0) continue;
    for (const trip of service.trips ?? []) {
      if (trip.date !== date) continue;
      const departure =
        trip.departures?.[targetIndex] ?? trip.arrivals?.[targetIndex];
      if (
        !Number.isFinite(departure) ||
        departure < minute ||
        departure > minute + 60
      )
        continue;
      const points = service.stops
        .slice(0, targetIndex + 1)
        .map((id, i) => ({
          id,
          time: trip.departures?.[i] ?? trip.arrivals?.[i],
          axis: axis.indexOf(id),
        }))
        .filter((p) => Number.isFinite(p.time) && p.axis >= 0);
      let position = null;
      if (points.length > 1 && minute >= points[0].time) {
        for (let i = 0; i < points.length - 1; i++) {
          const a = points[i],
            b = points[i + 1];
          if (minute >= a.time && minute <= b.time && b.time > a.time) {
            position =
              a.axis +
              (b.axis - a.axis) * ((minute - a.time) / (b.time - a.time));
            break;
          }
        }
      }
      const first = service.stops
        .map((id) => axis.indexOf(id))
        .find((i) => i >= 0);
      const last = [...service.stops]
        .reverse()
        .map((id) => axis.indexOf(id))
        .find((i) => i >= 0);
      const rounded = Math.round(departure),
        hour = Math.floor(rounded / 60),
        minutes = String(rounded % 60).padStart(2, "0");
      result.push({
        key: `schedule:${service.id}:${trip.id}`,
        serviceId: service.id,
        tripId: trip.id,
        source: "schedule",
        operator: axis === kintetsuIds ? "kintetsu" : "subway",
        railPosition: position,
        category: service.category,
        direction: last > first ? "south" : "north",
        dest: railDestinationName(trip.headsign),
        minutes: departure - minute,
        scheduledDeparture: departure,
        clock: `${String(hour).padStart(2, "0")}:${minutes}`,
        stationsAway:
          position === null ? null : Math.abs(axis.indexOf(target) - position),
      });
    }
  }
  const ordered = result.sort((a, b) => a.minutes - b.minutes);
  const counts = new Map();
  return ordered.filter((row) => {
    const n = counts.get(row.direction) ?? 0;
    counts.set(row.direction, n + 1);
    return n < 12;
  });
}

// Positions come only from official stop times or an observed position cell.
export function railPositionNames(row) {
  if (!Number.isFinite(row.railPosition)) return null;
  const names = row.operator === "kintetsu" ? KINTETSU_NAMES : SUBWAY_NAMES;
  const p = row.railPosition;
  if (p < 0 || p > names.length - 1) return null;
  const a = Math.floor(p),
    b = Math.ceil(p);
  if (a === b) return [names[a]];
  return row.direction === "north"
    ? [names[b], names[a]]
    : [names[a], names[b]];
}
