import { shiftServiceDate } from "./journey-plan.js";
import { operationIds } from "./operation-status.js";

// Build new search conditions from the actual remaining journey. This never
// changes its active ride or guesses a GPS-based alighting event.
export function recoveryInput({
  plan,
  input = plan?.input,
  ride,
  stopId,
  now,
  network,
  avoid = [],
  delay = 0,
}) {
  if (!input || !now || !network) return null;
  const current = plan?.route.legs[plan.legIndex],
    fromId =
      stopId ??
      (plan?.phase === "riding"
        ? (ride?.userDestination?.id ?? current?.to)
        : current?.from) ??
      input.fromId,
    toId = plan?.route.legs.at(-1)?.to ?? input.toId,
    from = network.stops.get(fromId),
    to = network.stops.get(toId);
  if (!from || !to || from.id === to.id) return null;
  const consumed = plan
      ? plan.route.legs
          .slice(0, plan.legIndex + 1)
          .filter((l) => l.kind === "dwell").length
      : 0,
    via = (input.via ?? []).slice(consumed).filter((v) => v.id !== fromId),
    excluded = new Set(operationIds(avoid)),
    operators = operationIds(
      (input.operators ?? "subway,kintetsu,citybus,kyotobus").split(","),
    ).filter((id) => !excluded.has(id));
  if (!operators.length)
    throw Error(
      "利用できる交通機関がありません。回避する路線か検索条件を変更してください。",
    );
  const stop = ride?.officialStops?.find((s) => s.id === fromId),
    serviceOffset =
      (Date.parse(`${ride?.serviceDate}T00:00:00Z`) -
        Date.parse(`${now.date}T00:00:00Z`)) /
      60000,
    arrival = stop?.arrival ?? stop?.time ?? stop?.departure,
    ready =
      stop && Number.isFinite(arrival) && Number.isFinite(serviceOffset)
        ? Math.max(
            now.minute,
            serviceOffset +
              arrival +
              (Number.isFinite(delay) ? delay : 0) +
              Number(input.buffer ?? 3),
          )
        : now.minute,
    rounded = Math.ceil(ready),
    day = Math.floor(rounded / 1440),
    minute = ((rounded % 1440) + 1440) % 1440;
  return {
    ...input,
    from: from.name,
    fromId: from.id,
    to: to.name,
    toId: to.id,
    via,
    date: shiftServiceDate(now.date, day),
    time: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
    timeMode: "departure",
    operators: operators.join(","),
    trainType: input.trainType ?? "all",
    buffer: input.buffer ?? "3",
    maxWalk: input.maxWalk ?? "20",
    walkSpeed: input.walkSpeed ?? "standard",
  };
}

export function missedConnection(plan, now) {
  if (!plan || !["armed", "transfer"].includes(plan.phase)) return false;
  const leg = plan.route.legs[plan.legIndex],
    dayOffset =
      (Date.parse(`${now.date}T00:00:00Z`) -
        Date.parse(`${plan.route.date}T00:00:00Z`)) /
      60000;
  // A scheduled departure alone cannot prove boarding or alighting. It can
  // only make a replacement proposal eligible after a small grace period.
  return (
    Number.isFinite(leg?.depart) && dayOffset + now.minute > leg.depart + 2
  );
}

export function nextDaySearch(date, start, timeMode) {
  return start >= 1260 && !["first", "last"].includes(timeMode)
    ? shiftServiceDate(date, 1)
    : null;
}
