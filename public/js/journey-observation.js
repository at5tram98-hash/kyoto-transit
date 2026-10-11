import { journeyProgress, stopTime } from "./journey-core.js";
import { freshFix } from "./riding.js";

export function observeJourney(
  previous,
  ride,
  { minute, shift = 0, fix, geo, trail = [], speed = 0, at = Date.now() } = {},
) {
  if (!freshFix(fix, at) || !geo)
    return { ...previous, shift, arrived: false, progress: null };
  if (previous?.lastFix === fix.timestamp)
    return { ...previous, shift, arrived: false, progress: null };
  const progress = journeyProgress(ride, {
      minute,
      shift,
      fix,
      geo,
      trail,
      at,
    }),
    index = progress.currentIndex,
    scheduled = stopTime(progress.stops[index]);
  const next = {
    ...previous,
    lastFix: fix.timestamp,
    shift,
    arrived: false,
    progress,
  };
  // One arrival observation per stop. Repeated fixes while waiting on a
  // platform must not grow the delay or continually move the arrival target.
  if (
    progress.source === "location" &&
    index >= 0 &&
    index !== previous?.anchorIndex &&
    Number.isFinite(scheduled) &&
    minute >= scheduled - 1 &&
    Math.abs(minute - scheduled - shift) <= 20
  ) {
    next.shift = minute - scheduled;
    next.anchorIndex = index;
  }
  const end =
    index === progress.stops.length - 1 &&
    progress.source === "location" &&
    speed < 1.2 &&
    (!Number.isFinite(scheduled) || minute >= scheduled + next.shift - 1);
  if (end) {
    const continuous =
      previous?.endLastFix && fix.timestamp - previous.endLastFix <= 45000;
    next.endSince = continuous ? previous.endSince : fix.timestamp;
    next.endLastFix = fix.timestamp;
    next.arrived = fix.timestamp - next.endSince >= 90000;
  } else {
    next.endSince = null;
    next.endLastFix = null;
  }
  return next;
}
