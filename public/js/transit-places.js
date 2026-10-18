import { distance } from "./mobility.js";

// Group the presentation by actual nearby place, not just name. Each operator
// and stop ID retains its own button and arrival data; physically distant
// names are always kept separate. Select places BEFORE limiting row count.
export function groupNearbyPlaces(
  rows, geo, { maxPlaces = Infinity, mergeWithinMeters = 160 } = {},
) {
  const points = new Map((geo?.stops ?? []).map((p) => [p.id, p]));
  const groups = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row?.id || !row.stop || seen.has(row.id)) continue;
    seen.add(row.id);
    const name = String(row.stop.name ?? "")
      .normalize("NFKC")
      .trim()
      .replace(/(?:駅前|駅)$/u, "")
      .replace(/[　\s]/g, "");
    const point = points.get(row.id);
    const group = groups.find(
      (g) => g.name === name && point && g.point &&
        distance(point, g.point) <= mergeWithinMeters,
    );
    if (group) {
      group.rows.push(row);
      group.meters = Math.min(group.meters, row.meters ?? Infinity);
    } else {
      groups.push({ name: name || row.stop.name, point,
        meters: row.meters ?? Infinity, rows: [row] });
    }
  }
  return groups
    .sort((a, b) => a.meters - b.meters)
    .slice(0, Math.max(0, maxPlaces));
}
