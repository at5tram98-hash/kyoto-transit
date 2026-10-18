// Two-stage, in-memory alerts. Only the selected alighting stop may notify.
// Schedule-only proximity is not verified arrival; never alert from it.
export function createAlightingNotifier() {
  const stages = new Map();
  return {
    evaluate({
      key,
      selectedStop,
      displayedStop,
      nextIsDestination = false,
      stopped = false,
      locationConfirmed = false,
      enabled = true,
    } = {}) {
      if (!enabled || !key || !selectedStop || !locationConfirmed ||
          !nextIsDestination || displayedStop !== selectedStop) return null;
      const event = stopped ? "arrived" : "prepare";
      let notified = stages.get(key);
      if (!notified) {
        notified = new Set();
        stages.set(key, notified);
        if (stages.size > 32) stages.delete(stages.keys().next().value);
      }
      if (notified.has(event)) return null;
      notified.add(event);
      return event;
    },
    reset() { stages.clear(); },
  };
}
