import { contradictionDecision } from "./smartlive-evidence.js";
import { rideDetectionSession } from "./ride-detection-session.js";
import { transitEvidenceEngine } from "./transit-evidence.js";
import { state, persistJourney, toast } from "./vnext-state.js";
import { ui } from "./locale.js";

// Both recognition and direction recovery use the same session, shell and lock.
export function beginRideRecheck(reason = "contradiction") {
  const ride = state.ride;
  if (!ride || !rideDetectionSession.recheck(ride)) return false;
  transitEvidenceEngine.unlock();
  state.ride = null;
  state.rideShift = 0;
  state.rideShiftKnown = false;
  state.rideObservation = null;
  state.heroObservation = null;
  state.rideSource = ui("smartlive_rechecking");
  state.rideConfidence = 0;
  state.rideConsensusCount = 0;
  // The current ride returns to the same pool, with its unboosted score.
  state.rideCandidates = [
    { ride, score: 55, source: ui("smartlive_rechecking") },
    ...(state.rideCandidates ?? []),
  ].slice(0, 6);
  persistJourney(true);
  toast(ui("smartlive_rechecking"));
  queueMicrotask(() =>
    document.dispatchEvent(new CustomEvent("mymap-transit-evidence")),
  );
  return true;
}

export function recordRideContradiction(source, confidence, signature) {
  if (!state.ride) return false;
  const now = Date.now();
  if (!rideDetectionSession.contradiction(source, confidence, signature, now))
    return false;
  transitEvidenceEngine.ingest({
    type: source === "direction" ? "gps" : source,
    candidate: state.ride,
    confidence,
    observedAt: now,
    metadata: { rejected: true },
  });
  const decision = contradictionDecision(
    rideDetectionSession.snapshot(now).contradictions,
    now,
  );
  if (decision.release) return beginRideRecheck(decision.reason);
  document.dispatchEvent(new CustomEvent("mymap-transit-evidence"));
  return false;
}
