// "Current location" and "Home" as journey ends. Each is a point, not a
// stop: it joins the network as a place with walks to the stops and
// stations around it, so the planner starts (or ends) with a real walk.
// The point is refreshed every time it is chosen or searched.
import { ui } from "./locale.js";

export const HERE_ID = "@here";
export const HOME_ID = "@home";
export const PLACE_RADIUS = 1200;
export const PLACE_STOPS = 16;
const WALK_METRES_PER_MINUTE = 80;
// Streets are not straight lines: walking distance is about 1.3× the crow-fly.
const DETOUR = 1.3;

const metres = (a, b) => {
  const r = Math.PI / 180,
    x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) * r) / 2),
    y = (b.lat - a.lat) * r;
  return 6371000 * Math.hypot(x, y);
};
export const isVirtualPlace = (id) => id === HERE_ID || id === HOME_ID;

// Walks both ways between the point and the nearest stops in reach.
export function placeWalks(id, point, geoStops = [], network = null) {
  return geoStops
    .filter((s) => !network || network.stops.has(s.id))
    .map((s) => ({ id: s.id, m: metres(point, s) }))
    .filter((s) => s.m <= PLACE_RADIUS)
    .sort((a, b) => a.m - b.m)
    .slice(0, PLACE_STOPS)
    .flatMap(({ id: stop, m }) => {
      const minutes = Math.max(1, Math.ceil((m * DETOUR) / WALK_METRES_PER_MINUTE));
      return [
        { from: id, to: stop, minutes, virtual: true },
        { from: stop, to: id, minutes, virtual: true },
      ];
    });
}

// Puts the place into the network (or takes it out when the point is
// unknown), replacing its previous walks. Returns the stop, or null.
export function setVirtualPlace(network, id, point, geoStops) {
  network.walks = (network.walks ?? []).filter((w) => w.from !== id && w.to !== id);
  if (!point || ![point.lat, point.lng].every(Number.isFinite)) {
    network.stops.delete(id);
    return null;
  }
  const walks = placeWalks(id, point, geoStops, network);
  if (!walks.length) {
    network.stops.delete(id);
    return null;
  }
  const stop = {
    id,
    name: ui(id === HERE_ID ? "place_here" : "place_home"),
    en: id === HERE_ID ? "Current location" : "Home",
    type: "place",
    virtual: true,
    lines: [],
    lat: point.lat,
    lng: point.lng,
  };
  network.stops.set(id, stop);
  network.walks.push(...walks);
  return stop;
}

// Brings both places up to date from the app: the current fix (when fresh
// and reasonably precise) and the home point saved on this device.
export function refreshVirtualPlaces(network, { fix, geo, home, now = Date.now() } = {}) {
  const usable =
    fix && [fix.lat, fix.lng].every(Number.isFinite) && now - fix.timestamp <= 120000 && !(fix.accuracy > 300);
  return {
    here: setVirtualPlace(network, HERE_ID, usable ? fix : null, geo?.stops ?? []),
    home: setVirtualPlace(network, HOME_ID, home, geo?.stops ?? []),
  };
}
