// The display phase is derived from verified ride observations, never from
// timetable proximity alone. Timetable ETAs remain estimates even with GPS.
export function railGuidePhase({
  trainState,
  positionSource,
  hasFreshGps = false,
  motionSpeed = null,
  hasNextStation = false,
  routeUnavailable = false,
} = {}) {
  if (routeUnavailable || !hasNextStation) return "unavailable";
  if (
    !hasFreshGps ||
    ["gps_dropout_hold", "recovering", "schedule"].includes(positionSource)
  ) return "estimated";
  if (trainState === "STOPPED") return "stopped";
  // A schedule-only approach cannot say the train is arriving. An actual
  // moving GPS fix and a confirmed ride are needed for the approach label.
  if (
    trainState === "APPROACHING" &&
    Number.isFinite(motionSpeed) &&
    motionSpeed >= 2.8
  ) return "approaching";
  return "departed";
}

export function railGuideInfo({
  trainState,
  positionSource,
  hasFreshGps,
  motionSpeed,
  hasNextStation,
  routeUnavailable,
  minutes,
} = {}) {
  const phase = railGuidePhase({
    trainState, positionSource, hasFreshGps, motionSpeed,
    hasNextStation, routeUnavailable,
  });
  const locationHeld =
    positionSource === "gps_dropout_hold" || positionSource === "recovering";
  return {
    phase,
    // A held location must never produce a fictitious zero-minute countdown.
    showEstimate: !locationHeld && phase !== "stopped" &&
      phase !== "unavailable" &&
      Number.isFinite(minutes) && minutes >= 0,
    source: phase === "estimated" ? "timetable" :
      phase === "unavailable" ? "unavailable" : "gps-assisted",
  };
}
