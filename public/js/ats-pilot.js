// ATS LV.5 (experimental): guidance with no operation. The pilot looks at
// the steadied scene and the ride, and decides the steps a rider would
// otherwise tap themselves. Each step is taken once, announced, and can be
// undone; nothing is taken without evidence already used by LV.3/LV.4.
//
//   destination – riding with no stop to get off at: the stop is predicted
//                 from the rider's own searches and saved places on this
//                 device (most recent first), only among the stops still
//                 ahead on this ride
//   board       – on a vehicle with exactly one candidate service that has
//                 held for PILOT_BOARD_HOLD_MS with supporting evidence:
//                 the ride starts without the confirmation tap
//   approach    – standing at a stop: its live approach is opened (LV.4)
export const PILOT_BOARD_HOLD_MS = 30000;
export const PILOT_BOARD_SCORE = 55;

// The stop to get off at, from history and saved places.
export function predictDestination(ride, { pairs = [], saved = [] } = {}) {
  const stops = ride?.officialStops ?? [];
  if (stops.length < 2) return null;
  const from = stops.findIndex((s) => s.id === ride.from),
    ahead = stops.slice(Math.max(1, from + 1));
  const aheadIds = new Map(ahead.map((s) => [s.id, s]));
  // A search that started at this boarding stop says the most.
  for (const pair of pairs)
    if (pair.fromId === ride.from && aheadIds.has(pair.toId))
      return { id: pair.toId, name: aheadIds.get(pair.toId).name, source: "history" };
  for (const pair of pairs)
    if (aheadIds.has(pair.toId))
      return { id: pair.toId, name: aheadIds.get(pair.toId).name, source: "history" };
  for (const id of saved)
    if (aheadIds.has(id)) return { id, name: aheadIds.get(id).name, source: "saved" };
  return null;
}

// What the pilot does now. Pure: the caller applies the steps it returns
// and remembers their keys so each is taken once.
export function pilotSteps({ level, scene, ride, candidates = [], history = {}, done = new Set(), now = Date.now() }) {
  if (level < 5) return [];
  const steps = [];
  if (ride && !ride.userDestination) {
    const key = `destination:${ride.serviceId ?? ride.route ?? ""}:${ride.from}:${ride.depart ?? ""}`;
    if (!done.has(key)) {
      const predicted = predictDestination(ride, history);
      if (predicted) steps.push({ type: "destination", key, stop: predicted });
    }
  }
  if (!ride && scene?.scene === "vehicle" && candidates.length === 1) {
    const candidate = candidates[0],
      key = `board:${candidate.ride?.serviceId ?? candidate.ride?.route ?? ""}:${candidate.ride?.depart ?? ""}`;
    if (
      !done.has(key) &&
      now - (scene.since ?? now) >= PILOT_BOARD_HOLD_MS &&
      (candidate.score ?? 0) >= PILOT_BOARD_SCORE &&
      !candidate.directionRejected
    )
      steps.push({ type: "board", key, candidate });
  }
  return steps;
}
