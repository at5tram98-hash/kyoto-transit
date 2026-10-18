// Source of truth for the idle SmartLive status. Status reflects capability
// and candidate evidence, not an invented assertion that a train was boarded.
export function detectionDisplayState({
  phase = "idle",
  locationStatus = "loading",
  autoDetect = true,
  hidden = false,
  candidates = 0,
  moving = false,
} = {}) {
  if (!autoDetect) return "disabled";
  if (hidden) return "paused";
  if (locationStatus === "denied" || locationStatus === "disabled" ||
      locationStatus === "unsupported") return "permission";
  if (locationStatus !== "active") return "locating";
  if (phase === "rechecking" || phase === "contradicting") return "rechecking";
  if (candidates > 0)
    return phase === "confirming" ? "confirming" : "candidate";
  return moving ? "moving" : "searching";
}
