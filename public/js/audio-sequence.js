import { rideDetectionSession } from "./ride-detection-session.js";
import { transitCandidateKey } from "./transit-evidence.js";
import { state } from "./vnext-state.js";
export function observeAudioSequence(ride, match, at = Date.now()) {
  const result = rideDetectionSession.audio(ride, match.nextStop, at);
  if (result.status === "supportive" && state.ride === ride) {
    state.audioProgress = {
      ...result,
      at,
      candidate: transitCandidateKey(ride),
    };
  }
  return result;
}
