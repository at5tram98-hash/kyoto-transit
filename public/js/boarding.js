import { officialData } from "./timetable-ui.js";
import { getStaticFeed } from "./fast-data.js";
import { staticFoldbackJourney } from "./foldback-static.js";
import { officialTripLeg } from "./vehicle.js";
import { scheduledBoarding } from "./journey-session.js";
import { reverseDirection } from "./journey-core.js";
import { mergeTimetableFeeds } from "./search-core.js";
import { getCached, putCached } from "./realtime.js";

// Subway boards do not expose individual trip pages. Match the selected
// official departure to the full timetable instead of inventing stop times.
export async function foldbackJourney(
  plan,
  { network, subwayFeed, signal } = {},
) {
  if (!plan) return null;
  // A train chosen from the on-device timetables is rebuilt from them.
  if (plan.source === "static") {
    const feeds = await Promise.allSettled(
      ["subway", "kintetsu"].map((operator) =>
        getStaticFeed(operator, plan.date, { signal }),
      ),
    );
    const ride = staticFoldbackJourney(
      feeds.filter((r) => r.status === "fulfilled").map((r) => r.value),
      plan,
      network,
    );
    if (ride) return ride;
  }
  const depart = Number.isFinite(plan.serviceDepart)
    ? plan.serviceDepart
    : ((plan.depart % 1440) + 1440) % 1440;
  if (network.stops.get(plan.stopId)?.type === "subway") {
    if (
      !subwayFeed?.services?.some((s) =>
        s.trips?.some((t) => t.date === plan.date),
      )
    ) {
      const key = `static:subway:${plan.date}`;
      let raw;
      try {
        raw = await officialData(
          "/api/static/feed",
          { operator: "subway", date: plan.date },
          signal,
        );
        await putCached(key, { data: raw, savedAt: Date.now() });
      } catch (error) {
        if (signal?.aborted) throw error;
        raw = (await getCached(key))?.data;
        if (!raw) throw error;
      }
      subwayFeed = mergeTimetableFeeds({ ...network, services: [] }, [raw]);
    }
    const ride = scheduledBoarding(subwayFeed, { ...plan, depart }, network);
    if (ride) return ride;
    throw Error(
      "選んだ折り返し列車の全駅時刻が未取得です。駅時刻表から確認してください。",
    );
  }
  if (!plan.tripId)
    throw Error("この列車の便詳細が未取得です。駅時刻表から確認してください。");
  const trip = await officialData(
    "/timetable/trip",
    {
      stop: plan.stopId,
      direction: plan.direction,
      day: plan.day,
      trip: plan.tripId,
    },
    signal,
  );
  const ride = officialTripLeg(
    { ...trip, date: plan.date, boardStop: plan.stopId },
    network,
  );
  if (!ride) throw Error("折り返し列車の停車時刻を確認できませんでした。");
  const index = ride.officialStops.findIndex((s) => s.id === plan.stopId),
    stop = ride.officialStops[index];
  if (
    index < 0 ||
    index === ride.officialStops.length - 1 ||
    Math.abs((stop.departure ?? stop.time) - depart) > 1 ||
    reverseDirection(ride, plan.stopId) !==
      (plan.direction === "north" ? "south" : "north")
  )
    throw Error(
      "選んだ列車と便詳細が一致しません。駅時刻表から確認してください。",
    );
  return {
    ...ride,
    from: plan.stopId,
    depart: stop.departure ?? stop.time,
    officialStops: ride.officialStops.slice(index),
  };
}
