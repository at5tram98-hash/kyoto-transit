import catalog from '../public/data/bus-catalog.json' with { type: 'json' };
import north3 from '../public/data/north3-timetables.json' with { type: 'json' };
import { shortName } from '../public/js/network.js';

const supported = new Set([
  ...Object.values(catalog).flatMap((route) =>
    route.names.flatMap((name) => [name, shortName(name)]),
  ),
  ...north3.rows.flatMap((row) => [row.name, shortName(row.name)]),
]);

// The official city bus site only resolves stops by their full name, e.g.
// 「四条烏丸（地下鉄四条駅）」. Keep the short name for the app and convert it
// only when building upstream URLs.
const officialNames = new Map();
for (const name of [
  ...Object.values(catalog).flatMap((route) => route.names),
  ...north3.rows.map((row) => row.name),
]) {
  const short = shortName(name);
  if (short !== name && !officialNames.has(short)) officialNames.set(short, name);
}
export function officialBusStopName(stop) {
  return officialNames.get(stop) ?? stop;
}

export function validBusStop(stop, configured) {
  if (typeof stop !== 'string' || !stop) return false;
  if (Array.isArray(configured)) return configured.includes(stop);
  if (typeof configured === 'string') {
    try {
      const names = JSON.parse(configured);
      if (Array.isArray(names)) return names.includes(stop);
    } catch {}
  }
  return supported.has(stop);
}
