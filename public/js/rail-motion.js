// Underground rail motion from the accelerometer alone. GPS is unavailable
// in the subway, so riding is recognised from the phone's linear
// acceleration: a moving train shows steady low-frequency vibration without
// the ~2 Hz step peaks of walking, and station stops are still periods
// between runs. One-second bins over ten minutes give the runs (station to
// station) completed since the rider left a known station.
const BIN_MS = 1000,
  HISTORY_MS = 10 * 60000;

// samples: [{ at, magnitude }] linear acceleration magnitude in m/s².
export function binMotion(samples = [], now = Date.now()) {
  const bins = new Map();
  for (const s of samples) {
    if (!Number.isFinite(s?.at) || !Number.isFinite(s?.magnitude)) continue;
    if (s.at < now - HISTORY_MS || s.at > now + 1000) continue;
    const key = Math.floor(s.at / BIN_MS);
    const bin = bins.get(key) ?? { at: key * BIN_MS, values: [] };
    bin.values.push(s.magnitude);
    bins.set(key, bin);
  }
  return [...bins.values()]
    .sort((a, b) => a.at - b.at)
    .map(({ at, values }) => {
      const mean = values.reduce((a, b) => a + b, 0) / values.length,
        peak = Math.max(...values);
      return { at, mean, peak, count: values.length };
    });
}

// Each bin is still, vehicle or walking. Walking: strong peaks (> 1.2 m/s²)
// that recur over neighbouring seconds. Vehicle: sustained moderate motion.
export function classifyBins(bins) {
  return bins.map((bin, i) => {
    const near = bins.slice(Math.max(0, i - 2), i + 3),
      steps = near.filter((b) => b.peak >= 1.2).length;
    const kind =
      steps >= 3
        ? "walking"
        : bin.mean < 0.07
          ? "still"
          : bin.mean <= 1.1
            ? "vehicle"
            : "unknown";
    return { ...bin, kind };
  });
}

// Runs: at least `minRun` seconds of mostly-vehicle bins; stops: at least
// `minStop` seconds still between runs. Gaps without data end a segment.
export function railRuns(classified, { minRun = 35, minStop = 12, gapMs = 5000 } = {}) {
  const segments = [];
  let current = null;
  for (const bin of classified) {
    const kind = bin.kind === "unknown" ? current?.kind ?? "unknown" : bin.kind;
    if (current && (kind !== current.kind || bin.at - current.end > gapMs)) {
      segments.push(current);
      current = null;
    }
    if (!current) current = { kind, start: bin.at, end: bin.at };
    else current.end = bin.at;
  }
  if (current) segments.push(current);
  const runs = [],
    stops = [];
  for (const segment of segments) {
    const seconds = (segment.end - segment.start) / 1000 + 1;
    if (segment.kind === "vehicle" && seconds >= minRun) runs.push(segment);
    if (segment.kind === "still" && seconds >= minStop) stops.push(segment);
  }
  return { runs, stops, segments };
}

// Summary for detection: whether the phone is riding now (vehicle motion in
// the last 20 s without walking), the runs completed since `since`, and
// whether the train is stopped at a station now.
export function railMotionSummary(samples, { now = Date.now(), since = now - HISTORY_MS } = {}) {
  const classified = classifyBins(binMotion(samples, now)),
    recent = classified.filter((b) => b.at >= now - 20000),
    vehicleRecent = recent.filter((b) => b.kind === "vehicle").length,
    walkingRecent = recent.filter((b) => b.kind === "walking").length,
    { runs, stops } = railRuns(classified.filter((b) => b.at >= since));
  const lastRun = runs.at(-1),
    lastStop = stops.at(-1);
  return {
    available: classified.length >= 10,
    riding: recent.length >= 10 && vehicleRecent / recent.length >= 0.6 && walkingRecent === 0,
    walking: walkingRecent >= 4,
    // A run still in progress is not yet a completed station hop.
    completedRuns: runs.filter((r) => stops.some((s) => s.start > r.end)).length,
    runs: runs.length,
    stoppedNow: Boolean(lastStop && (!lastRun || lastStop.start > lastRun.end) && now - lastStop.end <= 3000),
    observedAt: classified.at(-1)?.at ?? null,
  };
}
