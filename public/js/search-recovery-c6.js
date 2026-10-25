// C-6: no-route recovery offers explicit edits; never silently relaxes a trip.
// Late at night (after the last trains and buses) the first services of the
// next morning are offered as one more explicit choice.
export const LATE_FROM = 22 * 60 + 30;
export const EARLY_UNTIL = 4 * 60 + 30;
const minuteOf = (time) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export function lateNight(input) {
  const minute = minuteOf(input?.time);
  return (
    input?.timeMode !== "arrival" &&
    minute !== null &&
    (minute >= LATE_FROM || minute < EARLY_UNTIL)
  );
}
export function searchRecoveryOptions(input) {
  if (!input || typeof input !== "object") return [];
  const options = [{ id: "date", label: "date" }, { id: "filters", label: "filters" }];
  if (lateNight(input)) options.unshift({ id: "first", label: "first" });
  if (Array.isArray(input.via) && input.via.length)
    options.push({ id: "via", label: "via" });
  return options;
}
export function recoveryAction(id) {
  return ({
    first: "first",
    date: "date",
    filters: "filters",
    via: "search",
  })[id] ?? null;
}
// The same search for the first services: the next morning at 05:00 (the
// same morning when it is already after midnight).
export function firstServiceInput(input) {
  const minute = minuteOf(input?.time),
    date = new Date(`${input.date}T00:00:00Z`);
  if (minute !== null && minute >= LATE_FROM) date.setUTCDate(date.getUTCDate() + 1);
  return { ...input, date: date.toISOString().slice(0, 10), time: "05:00", timeMode: "departure" };
}
