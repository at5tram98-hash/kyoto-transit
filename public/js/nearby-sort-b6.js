export const NEARBY_SORTS = ["distance", "departure", "operator"];
export function orderNearbyPlaces(places, mode = "distance", { nextDeparture } = {}) {
  const rows = [...(places ?? [])];
  const modes = new Set(NEARBY_SORTS);
  const selected = modes.has(mode) ? mode : "distance";
  const departure = (place) => {
    const times = place.rows.map(row => nextDeparture?.(row)).filter(Number.isFinite);
    return times.length ? Math.min(...times) : Infinity;
  };
  const rank = (place) => Math.min(...place.rows.map(row => ({
    subway: 0, kintetsu: 1, citybus: 2, kyotobus: 3,
  }[row.stop.type] ?? 4)));
  return rows.sort((a, b) => {
    const compare = selected === "departure" ? departure(a) - departure(b)
      : selected === "operator" ? rank(a) - rank(b) : 0;
    return compare || a.meters - b.meters ||
      a.name.localeCompare(b.name, "ja");
  });
}
