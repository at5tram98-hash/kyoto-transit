// D-3: central policy for motion duration and distance. Reduced-motion is
// a true skip rather than an arbitrarily short flash.
export function motionPolicy({ reduced = false, hidden = false, duration = 220 } = {}) {
  return {
    animate: !reduced && !hidden && Number.isFinite(duration) && duration > 0,
    duration: Number.isFinite(duration) ? Math.min(500, Math.max(0, duration)) : 0,
  };
}
export function navigationTravel(width) {
  return Number.isFinite(width) && width > 0 ? Math.min(1600, width) : 390;
}
