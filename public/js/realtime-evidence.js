import { transitCandidateKey } from "./transit-evidence.js";
const value = (v) =>
  String(v ?? "")
    .normalize("NFKC")
    .replace(/[\s・]/g, "");
const epoch = (v) =>
  typeof v === "number"
    ? v < 100000000000
      ? v * 1000
      : v
    : Date.parse(v ?? "");

// Native GTFS direction 0/1 has no geographic meaning. Compare it only with
// another native ID, and never treat 0 as a missing value.
function directions(row, ride) {
  const actual = value(row.directionId ?? row.direction);
  const expected = value(ride.directionId ?? ride.direction);
  const domain = (v) =>
    /^[01]$/.test(v)
      ? "gtfs"
      : /^(north|south|east|west)$/.test(v)
        ? "compass"
        : null;
  return actual &&
    expected &&
    domain(actual) &&
    domain(actual) === domain(expected)
    ? { actual, expected, matches: actual === expected }
    : null;
}

// A missing provider/vehicle is unavailable, never evidence of a wrong ride.
// Contradictions require an exact trip or already-bound vehicle identity.
export function realtimeRideEvidence(
  ride,
  feed,
  {
    provider = ride?.operator,
    now = Date.now(),
    vehicleId = null,
    online = true,
  } = {},
) {
  const result = {
    provider,
    candidate: ride ? transitCandidateKey(ride) : null,
    status: "unavailable",
    observedAt: null,
    confidence: 0,
    directionVerified: false,
  };
  if (!ride || !feed || !online || feed.stale || feed.source === "prediction")
    return result;
  const rows = feed.vehicles ?? feed.trains ?? feed.results ?? feed.buses ?? [];
  const observedAt = epoch(
    feed.sourceUpdatedAt ?? feed.capturedAt ?? feed.asOf,
  );
  const fresh = rows.filter((r) => {
    const at = epoch(r.timestamp ?? r.sourceUpdatedAt ?? r.asOf) || observedAt;
    return (
      Number.isFinite(at) &&
      at <= now + 5000 &&
      now - at <= 90000 &&
      r.source !== "prediction" &&
      r.source !== "schedule"
    );
  });
  const sameInstance = (r) =>
    (!r.serviceDate || r.serviceDate === ride.serviceDate) &&
    (!r.startTime || r.startTime === (ride.startTime ?? ride.tripStartTime));
  const exact = fresh.filter(
    (r) =>
      sameInstance(r) &&
      ((ride.tripId && (r.tripId ?? r.trip) === ride.tripId) ||
        (vehicleId && (r.vehicleId ?? r.id) === vehicleId)),
  );
  const matching = exact.length
    ? exact
    : fresh.filter((r) => {
        if (!sameInstance(r)) return false;
        const rail = ["kintetsu", "through"].includes(provider);
        if (
          rail
            ? r.category !== ride.category
            : !ride.route || value(r.route) !== value(ride.route)
        )
          return false;
        return (
          directions(r, ride)?.matches &&
          value(r.destination ?? r.headsign ?? r.dest) ===
            value(ride.destination)
        );
      });
  if (!matching.length)
    return { ...result, status: fresh.length ? "neutral" : "unavailable" };
  const row = matching[0],
    at = epoch(row.timestamp ?? row.sourceUpdatedAt ?? row.asOf) || observedAt;
  const direction = value(row.directionId ?? row.direction),
    pair = directions(row, ride);
  const contradicts = exact.length && pair && !pair.matches;
  return {
    ...result,
    status: contradicts ? "contradictory" : "supportive",
    observedAt: at,
    confidence: exact.length ? 0.92 : 0.65,
    directionVerified: Boolean(pair?.matches),
    signature: `${provider}:${at}:${direction ?? ""}`,
  };
}
