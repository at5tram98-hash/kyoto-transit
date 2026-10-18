// C-6: no-route recovery offers explicit edits; never silently relaxes a trip.
export function searchRecoveryOptions(input) {
  if (!input || typeof input !== "object") return [];
  const options = [{ id: "date", label: "date" }, { id: "filters", label: "filters" }];
  if (Array.isArray(input.via) && input.via.length)
    options.push({ id: "via", label: "via" });
  return options;
}
export function recoveryAction(id) {
  return ({
    date: "date",
    filters: "filters",
    via: "search",
  })[id] ?? null;
}
