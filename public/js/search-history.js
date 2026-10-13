const KEY = "mymap-search-pairs-v1";
const valid = (pair) =>
  pair &&
  [pair.from, pair.to].every(
    (s) => typeof s === "string" && s.length > 0 && s.length <= 180,
  );
function selection(pair) {
  const out = { from: pair.from, to: pair.to };
  for (const key of ["fromId", "toId"])
    if (typeof pair[key] === "string" && pair[key].length <= 100)
      out[key] = pair[key];
  if (Array.isArray(pair.via) && pair.via.length <= 3)
    out.via = pair.via
      .filter(
        (v) =>
          v &&
          typeof v.name === "string" &&
          v.name.length > 0 &&
          v.name.length <= 180 &&
          typeof v.id === "string" &&
          v.id.length <= 100 &&
          Number.isFinite(v.dwell) &&
          v.dwell >= 0 &&
          v.dwell <= 180,
      )
      .map((v) => ({ name: v.name, id: v.id, dwell: v.dwell }));
  return out;
}
const same = (a, b) =>
  a.from === b.from &&
  a.to === b.to &&
  (a.fromId ?? "") === (b.fromId ?? "") &&
  (a.toId ?? "") === (b.toId ?? "") &&
  JSON.stringify(a.via ?? []) === JSON.stringify(b.via ?? []);
export function readSearchPairs(storage) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw || raw.length > 10000) return { history: [], favorites: [] };
    const value = JSON.parse(raw);
    return {
      history: Array.isArray(value.history)
        ? value.history.filter(valid).slice(0, 5).map(selection)
        : [],
      favorites: Array.isArray(value.favorites)
        ? value.favorites.filter(valid).slice(0, 5).map(selection)
        : [],
    };
  } catch {
    return { history: [], favorites: [] };
  }
}
export function saveSearchPair(storage, pair, { favorite = false } = {}) {
  if (!valid(pair)) return readSearchPairs(storage);
  const value = readSearchPairs(storage),
    key = favorite ? "favorites" : "history",
    item = selection(pair);
  value[key] = [item, ...value[key].filter((p) => !same(p, item))].slice(0, 5);
  try {
    storage.setItem(KEY, JSON.stringify(value));
  } catch {}
  return value;
}
export function removeSearchPair(storage, pair, kind = "favorites") {
  const value = readSearchPairs(storage);
  if (!["history", "favorites"].includes(kind) || !valid(pair)) return value;
  value[kind] = value[kind].filter((p) => !same(p, selection(pair)));
  try {
    storage.setItem(KEY, JSON.stringify(value));
  } catch {}
  return value;
}
