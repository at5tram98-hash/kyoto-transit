import { stopTime } from "./journey-core.js";
import { selectedAlightingStop } from "./ride-destination.js";

// View-only priorities. A match score is NOT a probability of boarding.
// Avoid accidentally presenting an inferred terminal as the rider's stop.
export function rideConfirmationFacts(candidate, support = {}) {
  const ride = candidate?.ride ?? {};
  const stops = ride.officialStops ?? [];
  const boarding = stops.find((stop) => stop.id === ride.from);
  const alighting = selectedAlightingStop(ride, stops);
  const score = Number.isFinite(candidate?.score)
    ? Math.round(Math.max(0, Math.min(100, candidate.score))) : null;
  return {
    destination: ride.destination ?? null,
    boarding: boarding?.name ?? null,
    departure: Number.isFinite(ride.depart) ? ride.depart :
      stopTime(boarding),
    alighting: alighting?.name ?? null,
    alightingId: alighting?.id ?? null,
    stage: support.routeProgress && support.vehicleMoving
      ? "route-verified" : support.vehicleMoving
        ? "motion" : "not-verified",
    score,
    source: candidate?.source ?? "",
    manualRequired: true,
  };
}
