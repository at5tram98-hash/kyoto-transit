// Places and route pairs are different records; each has one storage owner.
const KEY = "mymap-saved-places-v1";
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
