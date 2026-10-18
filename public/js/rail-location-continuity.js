// Keep the last trusted next-station indicator steady through short tunnel
// outages. After grace expires, timetable progress is an estimate only.
// A recovered location that would jump multiple stations requires two
// distinct, consistent fixes before changing the displayed station.
export const RAIL_GPS_GRACE_MS = 75000;
export const RAIL_RECOVERY_CONFIRM_MS = 45000;
export function stabilizeRailObservation(
  previous,
  observation,
  { at = Date.now(), hasFreshFix = false, fixTimestamp = null } = {},
) {
  const prev = previous?.key === observation.key ? previous : null;
  const reliableFix =
    hasFreshFix && Number.isFinite(fixTimestamp) &&
    fixTimestamp <= at + 5000 &&
    fixTimestamp >= at - 45000;
  const lastGpsAt = reliableFix ? fixTimestamp : (prev?.lastGpsAt ?? null);
  const lastFixTimestamp = reliableFix
    ? fixTimestamp
    : (prev?.lastFixTimestamp ?? null);
  const result = {
    ...observation,
    lastGpsAt,
    lastFixTimestamp,
    positionSource: reliableFix ? "location" : "schedule",
    pendingIndex: null,
    pendingFixTimestamp: null,
    pendingAt: null,
  };
  if (!prev) {
    if (!reliableFix) result.state = "DEPARTED";
    return result;
  }
  if (!reliableFix) {
    result.state = "DEPARTED";
    if (
      Number.isFinite(lastGpsAt) &&
      at - lastGpsAt < RAIL_GPS_GRACE_MS &&
      observation.index > prev.index
    )
      { result.index = prev.index; result.positionSource = "gps_dropout_hold"; }
    return result;
  }
  if (observation.index > prev.index + 1) {
    const confirmed =
      prev.pendingIndex === observation.index &&
      prev.pendingFixTimestamp !== fixTimestamp &&
      Number.isFinite(prev.pendingAt) &&
      at - prev.pendingAt >= 1000 &&
      at - prev.pendingAt <= RAIL_RECOVERY_CONFIRM_MS;
    if (!confirmed) {
      result.index = prev.index;
      result.state = "DEPARTED";
      result.pendingIndex = observation.index;
      result.pendingFixTimestamp = fixTimestamp;
      result.pendingAt = at;
      result.positionSource = "recovering";
    }
  }
  return result;
}
