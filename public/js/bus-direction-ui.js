// The direction tag for a bus approach row: 甲 or 乙 only, for every bus
// route (loop routes included). Subway and Kintetsu rows carry none.
import { ui } from "./locale.js";
import { esc, state } from "./vnext-state.js";
import { annotateRows, stopPoles, lineSide } from "./bus-direction.js";
import { serviceFor } from "./bus-radar.js";

const located = new WeakMap();
export function locatedStops(geo = state.geo) {
  if (!geo) return new Map();
  if (!located.has(geo)) located.set(geo, new Map((geo.stops ?? []).map((s) => [s.id, s])));
  return located.get(geo);
}

export const withDirections = (rows, stopId) =>
  stopId ? annotateRows(rows, stopId, state.network, locatedStops(), serviceFor) : rows;

export function directionTagsHTML(row) {
  return row?.side
    ? `<span class="bus-dir" data-side="${row.side}">${esc(ui(`bus_side_${row.side}`))}</span>`
    : "";
}

// The poles of a stop for the stop screen, by 甲/乙 (the app names bus
// directions only that way): the next stop that way, its routes, and the
// のりば letters the live data reports for them. Compass words (東行き,
// 北行き …) are not used.
export function polesFor(stopId, liveRows = []) {
  const network = state.network,
    stops = locatedStops();
  const groups = new Map();
  for (const pole of stopPoles(stopId, network, stops))
    for (const service of pole.services) {
      const side = lineSide(service, stops, network);
      if (!side) continue;
      if (!groups.has(side)) groups.set(side, { side, services: [] });
      const group = groups.get(side);
      if (!group.services.includes(service)) group.services.push(service);
    }
  const annotated = withDirections(liveRows, stopId);
  return ["kou", "otsu"]
    .filter((side) => groups.has(side))
    .map((side) => {
      const services = groups.get(side).services,
        service = services[0],
        index = service.stops.indexOf(stopId),
        toward = network.stops.get(service.stops[index + 1])?.name ?? "";
      const boardings = [
        ...new Set(
          annotated
            .filter((r) => r.side === side && r.boarding)
            .map((r) => String(r.boarding).trim()),
        ),
      ];
      return { side, services, routes: [...new Set(services.map((s) => String(s.route)))], toward, boardings };
    });
}
