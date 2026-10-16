// Places and route pairs are different records; each has one storage owner.
const KEY = "mymap-saved-places-v1";
export const QUICK_SYMBOLS = Object.freeze({
  bolt: "クイック",
  bookmark: "ブックマーク",
  location: "現在地",
  train: "電車",
  bus: "バス",
  clock: "時計",
  map: "地図",
  ticket: "定期券",
});
export function quickPlaceSymbol(settings, id, type) {
  const selected = settings?.quickSymbols?.[id];
  return Object.hasOwn(QUICK_SYMBOLS, selected)
    ? selected
    : type?.includes("bus")
      ? "bus"
      : "train";
}
export function readSavedPlaces(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(KEY) || "[]");
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter((id) => typeof id === "string" && id.length <= 100),
          ),
        ].slice(0, 50)
      : [];
  } catch {
    return [];
  }
}
export function toggleSavedPlace(id, storage = globalThis.localStorage) {
  const current = readSavedPlaces(storage);
  const next = current.includes(id)
    ? current.filter((x) => x !== id)
    : [id, ...current].slice(0, 50);
  try {
    storage.setItem(KEY, JSON.stringify(next));
  } catch {
    return current.includes(id);
  }
  globalThis.document?.dispatchEvent(
    new CustomEvent("mymap-saved-places-change"),
  );
  return next.includes(id);
}
