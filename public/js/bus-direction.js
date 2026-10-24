// Which way a bus service runs, and which side of the road its stop pole is.
//
// Loop routes (202, 204, 205, 206, 208) run both ways round the same loop.
// The operator distinguishes them only by destination text; the internal
// 甲/乙 labels are not published and are defined differently per route, so
// they are not shown. The direction round the loop is computed from the
// stops' positions (signed area): clockwise or counterclockwise.
// Other routes are named by the terminus they head for.
//
// A stop name stands for poles on both sides of the road (and sometimes
// more). Each service leaves the stop towards its next stop; that compass
// heading (north, east, south, west) groups the services that share a pole.

const toRad = (d) => (d * Math.PI) / 180;

export function isLoop(service) {
  const stops = service?.stops ?? [];
  return stops.length > 3 && stops[0] === stops.at(-1);
}

// "cw" or "ccw" for a loop service, from the shoelace sum of its stops.
export function loopRotation(service, located) {
  if (!isLoop(service)) return null;
  const points = service.stops.map((id) => located.get(id)).filter(Boolean);
  if (points.length < 4) return null;
  const lat0 = points[0].lat;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const ax = a.lng * Math.cos(toRad(lat0)),
      bx = b.lng * Math.cos(toRad(lat0));
    area += ax * b.lat - bx * a.lat;
  }
  // x east, y north: a positive area runs counterclockwise.
  return Math.abs(area) < 1e-9 ? null : area > 0 ? "ccw" : "cw";
}

export function serviceDirection(service, network, located) {
  const rotation = loopRotation(service, located);
  if (rotation) return { kind: "loop", rotation };
  const terminal = network?.stops.get(service?.stops?.at(-1));
  return terminal ? { kind: "line", terminal: terminal.name } : null;
}

// Compass heading (degrees, 0 = north) from one point to another.
export function bearing(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat)),
    x =
      Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
      Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}
export const COMPASS = ["north", "east", "south", "west"];
export const compass = (degrees) => COMPASS[Math.round(((degrees % 360) + 360) % 360 / 90) % 4];

const metres = (a, b) => {
  const x = toRad(b.lng - a.lng) * Math.cos(toRad((a.lat + b.lat) / 2)),
    y = toRad(b.lat - a.lat);
  return 6371000 * Math.hypot(x, y);
};

// The heading a service leaves `stopId` with: towards the first following
// stop at least 60 m away (stops on both sides of a junction can be close).
export function departureHeading(service, stopId, located, from = null) {
  const stops = service?.stops ?? [],
    index = from ?? stops.indexOf(stopId);
  if (index < 0 || index >= stops.length - 1) return null;
  const here = located.get(stopId);
  if (!here) return null;
  for (let i = index + 1; i < stops.length; i++) {
    const next = located.get(stops[i]);
    if (next && metres(here, next) >= 60) return bearing(here, next);
  }
  return null;
}

// The poles of a bus stop: the services that leave it grouped by heading.
// Each group lists its routes and the services (with their direction).
export function stopPoles(stopId, network, located) {
  const groups = new Map();
  for (const service of network?.services ?? []) {
    if (!["citybus", "kyotobus"].includes(service.operator) || !service.prototype) continue;
    const stops = service.stops ?? [];
    stops.forEach((id, index) => {
      if (id !== stopId || index === stops.length - 1) return;
      const heading = departureHeading(service, stopId, located, index);
      if (heading === null) return;
      const key = compass(heading);
      if (!groups.has(key)) groups.set(key, { heading: key, degrees: [], services: [] });
      const group = groups.get(key);
      if (group.services.includes(service)) return;
      group.degrees.push(heading);
      group.services.push(service);
    });
  }
  return [...groups.values()]
    .map((group) => ({
      heading: group.heading,
      routes: [...new Set(group.services.map((s) => String(s.route)))],
      services: group.services,
    }))
    .sort((a, b) => COMPASS.indexOf(a.heading) - COMPASS.indexOf(b.heading));
}

// The direction of each approach row at `stopId`: rotation on a loop, and
// the heading its pole faces. Rows that match no service are left as they
// are.
export function annotateRows(rows, stopId, network, located, serviceFor) {
  if (!network || !located?.size) return rows;
  return rows.map((row) => {
    const match = serviceFor(row, stopId, network, located);
    if (!match) return row;
    const rotation = loopRotation(match.service, located),
      degrees = departureHeading(match.service, stopId, located);
    return { ...row, rotation, heading: degrees === null ? null : compass(degrees) };
  });
}
