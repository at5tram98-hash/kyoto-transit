import { normalize } from "./network.js";
// A scheduled fallback needs a known direction or matching destination. Route
// number alone is insufficient: opposite directions must never share an ETA.
export function scheduledArrivalFallbacks(
  network,
  stopId,
  rows,
  { date, minute } = {},
) {
  return rows.map((row) => {
    if (Number.isFinite(row.minutes) || Number.isFinite(row.stopsAway))
      return row;
    const candidates = [];
    for (const service of network.services ?? []) {
      if (
        service.operator !== "citybus" ||
        String(service.route) !== String(row.route)
      )
        continue;
      const index = service.stops.indexOf(stopId);
      if (index < 0 || index === service.stops.length - 1) continue;
      for (const trip of service.trips ?? []) {
        if (
          trip.date !== date ||
          trip.variantUnverified ||
          trip.operatingConditions?.schoolDayRequired
        )
          continue;
        const destination =
          trip.destination ??
          trip.headsign ??
          service.destination ??
          network.stops.get(service.stops.at(-1))?.name;
        const directionMatch =
          row.direction &&
          service.direction &&
          row.direction === service.direction;
        if (
          !directionMatch &&
          (!destination || normalize(destination) !== normalize(row.dest))
        )
          continue;
        const depart = trip.departures?.[index] ?? trip.arrivals?.[index];
        if (!Number.isFinite(depart) || depart < minute) continue;
        candidates.push({
          depart,
          destination,
          direction: service.direction,
          serviceId: service.id,
          tripId: trip.id,
        });
      }
    }
    if (
      !candidates.length ||
      new Set(
        candidates.map(
          (c) => `${c.direction ?? ""}:${normalize(c.destination)}`,
        ),
      ).size > 1
    )
      return row;
    const next = candidates.sort((a, b) => a.depart - b.depart)[0];
    const scheduled = {
      scheduledDeparture: next.depart,
      source: "schedule",
      asOf: network.sourceUpdatedAt ?? null,
      scheduleStale:
        network.feedMeta?.some((m) => m.operator === "citybus" && m.stale) ??
        false,
    };
    return {
      ...row,
      ...scheduled,
      ...(row.arrivals
        ? {
            arrivals: [
              { ...row.arrivals[0], ...scheduled },
              ...row.arrivals.slice(1),
            ],
          }
        : {}),
    };
  });
}
