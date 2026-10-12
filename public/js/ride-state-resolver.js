import { stopTime } from "./journey-core.js";
import { normalize } from "./network.js";
export function resolveNowState(ride) {
  return !ride
    ? "nearby"
    : ["citybus", "kyotobus"].includes(ride.operator)
      ? "bus"
      : "rail";
}
// A selected itinerary is evidence, not proof of boarding. Existing movement
// and distinct-fix consensus still decide whether automatic boarding is safe.
export function matchArmedJourney(candidates, armed, minute, at = Date.now()) {
  if (
    !armed?.ride ||
    !Number.isFinite(armed.ride.depart) ||
    Math.abs(armed.ride.depart - minute) > 45
  )
    return candidates;
  const ride = armed.ride;
  return candidates
    .map((c) => {
      const bus = ["citybus", "kyotobus"].includes(ride.operator),
        index =
          ride.officialStops?.findIndex((s) => s.id === c.ride.from) ?? -1;
      const planned = stopTime(ride.officialStops?.[index]),
        next = ride.officialStops?.[index + 1]?.id;
      const liveAge = at - Date.parse(c.live?.capturedAt ?? c.live?.asOf ?? "");
      const name = (s) =>
        normalize(String(s ?? "").replace(/行き?$|駅$|前$/g, ""));
      const sameBus =
        bus &&
        index >= 0 &&
        next === c.ride.officialStops?.[1]?.id &&
        Number.isFinite(planned) &&
        Math.abs(planned - minute) <= 3 &&
        name(c.live?.destination ?? c.ride.destination) ===
          name(ride.destination);
      const measuredBus =
        sameBus &&
        c.score >= 78 &&
        Number.isFinite(liveAge) &&
        liveAge >= 0 &&
        liveAge <= 120000 &&
        (c.live?.buses ?? []).some(
          (b) => Number.isFinite(b.stopsAway) && b.stopsAway <= 1,
        );
      const same =
        c.ride.operator === ride.operator &&
        String(c.ride.route ?? "") === String(ride.route ?? "") &&
        (sameBus ||
          (ride.tripId && c.ride.tripId === ride.tripId) ||
          (Math.abs(c.ride.depart - ride.depart) <= 2 &&
            c.ride.destination === ride.destination));
      return same
        ? {
            ...c,
            ride: bus
              ? { ...ride }
              : { ...c.ride, userDestination: ride.userDestination },
            score: measuredBus ? Math.min(100, c.score + 12) : c.score,
            armedMatch: true,
            source: `${c.source}＋選択した旅程`,
          }
        : c;
    })
    .sort((a, b) => b.score - a.score);
}
