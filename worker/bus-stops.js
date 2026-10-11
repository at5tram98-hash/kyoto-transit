import catalog from '../public/data/bus-catalog.json' with { type: 'json' };
import { shortName } from '../public/js/network.js';

const supported = new Set(
  Object.values(catalog).flatMap((route) =>
    route.names.flatMap((name) => [name, shortName(name)]),
  ),
);

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
