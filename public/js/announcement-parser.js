const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s・、。]/g, "");
// Parse named fields, then compare the next stop/destination against a service.
// Merely hearing a route number or an arbitrary stop on its line is insufficient.
export function parseAnnouncement(transcript, stops = []) {
  const text = normalize(transcript),
    result = {
      line: null,
      route: null,
      destination: null,
      nextStop: null,
      trainType: null,
    };
  if (/烏丸線/.test(text)) result.line = "subway";
  else if (/近鉄|京都線|奈良線/.test(text)) result.line = "kintetsu";
  const route = text.match(/(?:北|南|西|特)?\d{1,3}(?=系統)/);
  if (route) result.route = route[0];
  if (/急行/.test(text)) result.trainType = "express";
  else if (/普通|各駅停車/.test(text)) result.trainType = "local";
  const names = [...stops]
    .filter((s) => s?.name)
    .sort((a, b) => b.name.length - a.name.length);
  for (const stop of names) {
    const name = normalize(stop.name).replace(/駅$/, ""),
      index = text.indexOf(name);
    if (index < 0) continue;
    if (
      /(?:次は|つぎは|まもなく)$/.test(
        text.slice(Math.max(0, index - 5), index),
      )
    )
      result.nextStop ??= stop.id;
    const suffix = text.slice(index + name.length);
    if (/^(?:行|ゆき|方面)/.test(suffix)) result.destination ??= stop.id;
  }
  return result;
}
export function announcementMatch(parsed, ride, minute) {
  if (
    parsed.line &&
    parsed.line !== ride.operator &&
    ride.operator !== "through"
  )
    return null;
  if (parsed.route && String(ride.route) !== parsed.route) return null;
  if (parsed.trainType && parsed.trainType !== ride.category) return null;
  const stops = ride.officialStops ?? [];
  const destination = stops.at(-1)?.id;
  if (parsed.destination && destination !== parsed.destination) return null;
  const nextIndex = stops.findIndex(
    (s) =>
      Number.isFinite(s.departure ?? s.time ?? s.arrival) &&
      (s.departure ?? s.time ?? s.arrival) > minute,
  );
  const plausible =
    nextIndex >= 0
      ? stops.slice(Math.max(1, nextIndex - 1), nextIndex + 2).map((s) => s.id)
      : stops.slice(1, 3).map((s) => s.id);
  if (parsed.nextStop && !plausible.includes(parsed.nextStop)) return null;
  if (!parsed.nextStop && !parsed.destination) return null;
  return { confidence: parsed.nextStop ? 0.9 : 0.75, directionVerified: true };
}
