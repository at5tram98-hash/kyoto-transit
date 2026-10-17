import { distance } from "./mobility.js";
// Presentation grouping only. Every operator's stop ID and boarding action is
// retained; equal names at distant locations never share a place.
export function groupNearbyPlaces(rows, geo) {
  const points = new Map((geo?.stops ?? []).map((p) => [p.id, p]));
  const groups = [];
  for (const row of rows) {
    const name = String(row.stop.name ?? "")
      .normalize("NFKC")
      .replace(/駅前$|駅$/g, "");
    const point = points.get(row.id);
    const group = groups.find(
      (g) =>
        g.name === name && point && g.point && distance(point, g.point) <= 180,
    );
    if (group) group.rows.push(row);
    else groups.push({ name, point, rows: [row] });
  }
  return groups;
}
