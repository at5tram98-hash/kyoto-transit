import { distance } from "./mobility.js";
// A user-selected reference point is not a GPS fix and MUST NOT feed into
// riding, evidence consensus or automatic boarding logic.
export function manualNearbyRows(stopId, network, geo, limit = 80) {
  const target = geo?.stops?.find(p => p.id === stopId);
  if (!target || !network?.stops?.has(stopId)) return [];
  return (geo.stops ?? [])
    .filter(point => network.stops.has(point.id))
    .map(point => ({
      ...point,
      meters: distance(target, point),
      stop: network.stops.get(point.id),
      manualReference: true,
    }))
    .sort((a,b) => a.meters - b.meters)
    .slice(0,limit);
}
export function manualReferenceOptions(network, geo, query = "", limit = 20) {
  const available = new Set((geo?.stops ?? []).map(p => p.id));
  const normalized = String(query).normalize("NFKC").trim().toLowerCase();
  if (!normalized) return [];
  return [...(network?.stops?.values() ?? [])]
    .filter(stop => available.has(stop.id) &&
      (stop.name.toLowerCase().includes(normalized) ||
        stop.id.toLowerCase().includes(normalized)))
    .slice(0,limit).map(stop => ({ id: stop.id, name: stop.name, type: stop.type }));
}
