import { normalize } from "./network.js";
const holidays = new Set([
  "2026-09-21",
  "2026-09-22",
  "2026-09-23",
  "2026-10-12",
  "2026-11-03",
  "2026-11-23",
  "2027-01-01",
  "2027-01-11",
  "2027-02-11",
  "2027-02-23",
  "2027-03-22",
]);
export const north3Day = (date) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    date < "2026-09-20" ||
    date > "2027-03-31"
  )
    return null;
  const d = new Date(`${date}T00:00:00Z`);
  if (d.toISOString().slice(0, 10) !== date) return null;
  return holidays.has(date) ||
    d.getUTCDay() === 0 ||
    (date >= "2026-12-29" && date <= "2027-01-03")
    ? "holiday"
    : d.getUTCDay() === 6
      ? "saturday"
      : "weekday";
};
export function north3Board(snapshot, name, direction, day) {
  const row = snapshot?.rows?.find(
    (r) => normalize(r.name) === normalize(name),
  );
  const board = row?.boards.find((b) =>
    direction === "north" ? /京都産大/.test(b.label) : /北大路/.test(b.label),
  );
  if (!board) return null;
  return {
    ...board,
    entries: (board.days[day] ?? []).map(([depart, joint]) => ({
      depart,
      category: "local",
      route: "北3",
      destination:
        direction === "north" ? "京都産大前" : "北大路バスターミナル",
      operatingCompany: joint ? "kyotobus" : "citybus",
      operatingConditions: joint
        ? { schoolDayRequired: true, status: "unverified" }
        : null,
      note: joint ? "京都バス運行・大学休校日は運休（要確認）" : "",
    })),
    day,
    sourceURL: board.sourceURL,
    fetchedAt: snapshot.capturedAt,
    cached: true,
    stale: true,
  };
}
export function north3Feed(
  snapshot,
  network,
  date,
  { day = north3Day(date), schoolDay = null } = {},
) {
  if (!snapshot || !day || date < snapshot.effectiveFrom) return null;
  const ids = snapshot.rows.map(
    (row) =>
      [...network.stops.values()].find(
        (s) => normalize(s.fullName ?? s.name) === normalize(row.name),
      )?.id,
  );
  if (ids.some((id) => !id)) return null;
  const services = [];
  for (const reverse of [false, true]) {
    const stops = reverse ? [...ids].reverse() : ids,
      rows = reverse ? [...snapshot.rows].reverse() : snapshot.rows,
      direction = reverse ? "south" : "north";
    const boards = rows
      .slice(0, -1)
      .map((r) => north3Board(snapshot, r.name, direction, day));
    if (boards.some((b) => !b)) continue;
    const anchors = boards[0].entries;
    const reverseDirection = reverse ? "north" : "south";
    const terminalBoard = north3Board(
      snapshot,
      rows.at(-1).name,
      reverseDirection,
      day,
    );
    const reverseNext = north3Board(
      snapshot,
      rows.at(-2).name,
      reverseDirection,
      day,
    );
    const intervals =
      terminalBoard?.entries.flatMap((e, i) => {
        const other = reverseNext?.entries[i];
        const diff = other?.depart - e.depart;
        return Number.isFinite(diff) && diff >= 1 && diff <= 10 ? [diff] : [];
      }) ?? [];
    const finalSegment = intervals.length
      ? [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)]
      : null;
    // All nine departure boards must have the same ordered trips; mismatched
    // counts indicate a changed route and must not invent an alignment.
    if (boards.some((b) => b.entries.length !== anchors.length)) continue;
    const trips = anchors.flatMap((entry, i) => {
      if (entry.operatingConditions && schoolDay !== true) return [];
      const times = boards.map((b) => b.entries[i].depart);
      if (
        times.some((t, j) => j && t < times[j - 1]) ||
        boards.some(
          (b) => b.entries[i].operatingCompany !== entry.operatingCompany,
        )
      )
        return [];
      // Terminus arrival is explicitly estimated from the reverse direction's
      // published segment duration. Missing segment evidence stays unknown.
      times.push(finalSegment === null ? null : times.at(-1) + finalSegment);
      return [
        {
          id: `north3:${date}:${direction}:${i}`,
          date,
          arrivals: times,
          departures: times,
          headsign: rows.at(-1).name,
          operatingCompany: entry.operatingCompany,
          operatingConditions: entry.operatingConditions,
        },
      ];
    });
    services.push({
      id: `north3-${direction}`,
      operator: "citybus",
      operatingCompany: "mixed",
      label: "北3 / North 3",
      route: "北3",
      category: "local",
      stops,
      trips,
      sourceURL: snapshot.source,
      terminalArrivalUnavailable: finalSegment === null,
      terminalArrivalDerived: finalSegment !== null,
    });
  }
  return {
    schemaVersion: 1,
    validDates: [date],
    source: "京都市交通局 北3公式停留所時刻表（保存値）",
    lastUpdated: snapshot.capturedAt,
    stops: ids.map((id) => network.stops.get(id)),
    services,
    meta: {
      operator: "citybus",
      stale: true,
      warning:
        "保存した公式時刻表です。終点到着は逆方向の公式区間時分から推定。ダイヤ変更・大学休校日は要確認。",
      schoolCalendarVerified: schoolDay !== null,
    },
  };
}
let pending;
export function loadNorth3Snapshot() {
  return (pending ??= fetch(
    Object.assign(new URL("../data/north3-timetables.json", import.meta.url), {
      search: new URL(import.meta.url).search,
    }),
    { signal: AbortSignal.timeout(5000) },
  )
    .then((r) => {
      if (!r.ok) throw Error("北3の時刻表を読み込めません");
      return r.json();
    })
    .catch((e) => {
      pending = null;
      throw e;
    }));
}
