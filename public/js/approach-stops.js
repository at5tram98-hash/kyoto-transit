// The stops a bus passes on its way to the selected stop, from the planner's
// route network. The live source only says "n stops away"; naming those stops
// needs the route's stop order and direction, resolved here from the service
// whose onward stops match the destination text. Ambiguity returns null so the
// screen never names the wrong stops.
const tokens = (text) =>
  String(text ?? "")
    .normalize("NFKC")
    .split(/[・、,\s/（）()]+/)
    .map((t) => t.replace(/(?:行き?|方面)$/, ""))
    .filter((t) => t.length >= 2);

export function approachStops(network, stopId, route, destination, count = 6) {
  if (!network || !stopId || route == null) return null;
  const wanted = String(route).normalize("NFKC"),
    candidates = network.services.filter(
      (s) =>
        /bus/.test(s.operator) &&
        String(s.route ?? "").normalize("NFKC") === wanted &&
        s.stops.indexOf(stopId) > 0,
    );
  if (!candidates.length) return null;
  const words = tokens(destination),
    name = (id) => network.stops.get(id)?.name ?? "",
    matching = candidates.filter((s) => {
      const onward = s.stops.slice(s.stops.indexOf(stopId)).map(name);
      return words.some((w) => onward.some((n) => n.includes(w) || w.includes(n)));
    });
  const unique = (list) =>
    new Set(list.map((s) => s.stops.slice(0, s.stops.indexOf(stopId)).join())).size === 1;
  const chosen = matching.length && unique(matching)
    ? matching[0]
    : !words.length && unique(candidates)
      ? candidates[0]
      : null;
  if (!chosen) return null;
  const index = chosen.stops.indexOf(stopId),
    ids = chosen.stops.slice(Math.max(0, index - count), index + 1);
  return ids.map((id, i) => ({ id, name: name(id), away: ids.length - 1 - i }));
}
