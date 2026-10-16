import { assessFoldback, stopTime } from "./journey-core.js";

// The LCD's nextStation is the station being displayed, including a current
// stop. Use the following station only while stopped, also at the K/B boundary.
export function nextFoldbackStop(items, hero) {
  if (!hero || hero.routeUnavailable) return null;
  const station = hero.phase === "STOPPED" ? hero.nextNext : hero.nextStation;
  return items.find((stop) => stop.id === station?.id) ?? null;
}

// Match an identified reverse train at shared stations. Never extrapolate
// unreported times or turn a stop-level approach into a specific train.
export function foldbackMeetingPoints(
  ride,
  reverseRide,
  { minute, shift = 0, buffer = 3, offset = 0, minIndex = 0 } = {},
) {
  if (!ride || !reverseRide || !Number.isFinite(minute)) return [];
  const opposite =
    reverseRide.fullOfficialStops ?? reverseRide.officialStops ?? [];
  const rows = [];
  for (const stop of (ride.officialStops ?? []).slice(Math.max(0, minIndex))) {
    if (!Number.isFinite(stopTime(stop)) || stopTime(stop) + shift < minute - 1)
      continue;
    const matches = opposite.filter(
      (s) => s.id === stop.id && Number.isFinite(s.departure ?? s.time),
    );
    // Multiple visits of a circular/special pattern need a verified occurrence.
    if (matches.length !== 1) continue;
    const serviceDepart = matches[0].departure ?? matches[0].time,
      depart = serviceDepart + offset;
    const assessment = assessFoldback(stop, depart, {
      shift,
      buffer,
      now: minute,
    });
    if (["possible", "tight"].includes(assessment.status))
      rows.push({
        stopId: stop.id,
        name: stop.name,
        depart,
        serviceDepart,
        assessment,
      });
  }
  return rows.sort((a, b) => a.assessment.arrival - b.assessment.arrival);
}
