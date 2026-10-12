const KEY = "mymap-search-pairs-v1";
const valid = (pair) =>
  pair &&
  [pair.from, pair.to].every(
    (s) => typeof s === "string" && s.length > 0 && s.length <= 180,
  );
export function readSearchPairs(storage) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw || raw.length > 10000) return { history: [], favorites: [] };
    const value = JSON.parse(raw);
    return {
      history: Array.isArray(value.history)
        ? value.history.filter(valid).slice(0, 5)
        : [],
      favorites: Array.isArray(value.favorites)
        ? value.favorites.filter(valid).slice(0, 5)
        : [],
    };
  } catch {
    return { history: [], favorites: [] };
  }
}
export function saveSearchPair(storage, pair, { favorite = false } = {}) {
  if (!valid(pair)) return readSearchPairs(storage);
  const value = readSearchPairs(storage),
    key = favorite ? "favorites" : "history";
  value[key] = [
    { from: pair.from, to: pair.to },
    ...value[key].filter((p) => p.from !== pair.from || p.to !== pair.to),
  ].slice(0, 5);
  try {
    storage.setItem(KEY, JSON.stringify(value));
  } catch {}
  return value;
}
