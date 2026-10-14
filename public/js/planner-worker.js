import {
  mergeTimetableFeeds,
  searchTimetable,
  reconcileRealtime,
  applyRealtime,
  networkWithObservations,
} from "./search-core.js";
import { tripOptions, replaceJourneyLeg } from "./journey-plan.js";

export function planWorkerJob({
  base,
  feeds,
  request,
  passes,
  action,
  journey,
  legIndex,
  choiceKey,
  realtime,
  realtimeContext,
  nowEpoch,
}) {
  const merged = mergeTimetableFeeds(base, feeds, { date: request.date }),
    network =
      journey && action !== "realtime"
        ? networkWithObservations(merged, journey, nowEpoch)
        : merged;
  if (action === "realtime")
    return {
      planned: journey.map((route) =>
        reconcileRealtime(
          network,
          request,
          passes,
          route,
          realtime,
          realtimeContext,
        ),
      ),
      feedMeta: network.feedMeta ?? [],
    };
  if (action === "trip-options")
    return {
      options: tripOptions(network, request, journey, legIndex),
      feedMeta: network.feedMeta ?? [],
    };
  if (action === "replace-leg") {
    let updated = replaceJourneyLeg(
      network,
      request,
      passes,
      journey,
      legIndex,
      choiceKey,
    );
    if (realtime) {
      const annotated = applyRealtime(updated, realtime, {
        ...realtimeContext,
        buffer: request.buffer,
      });
      const observed = networkWithObservations(merged, annotated, nowEpoch);
      updated = replaceJourneyLeg(
        observed,
        request,
        passes,
        updated,
        legIndex,
        choiceKey,
      );
      updated = applyRealtime(updated, realtime, {
        ...realtimeContext,
        buffer: request.buffer,
      });
    }
    return { journey: updated, feedMeta: network.feedMeta ?? [] };
  }
  return {
    planned: searchTimetable(network, request, passes),
    feedMeta: network.feedMeta ?? [],
  };
}

if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.onmessage = (event) => {
    const id = event.data?.id;
    try {
      self.postMessage({ id, ok: true, ...planWorkerJob(event.data) });
    } catch (error) {
      self.postMessage({
        id,
        ok: false,
        error: String(error?.message ?? error),
      });
    }
  };
}
