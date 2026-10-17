const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s・、。,.:\-]/g, "")
    .toLowerCase();
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
  if (/烏丸線|からすません|karasumaline/.test(text)) result.line = "subway";
  else if (/近鉄|京都線|奈良線|kintetsu/.test(text)) result.line = "kintetsu";
  const route = text.match(/(?:北|南|西|特)?\d{1,3}(?=系統)/);
  if (route) result.route = route[0];
  if (/(?<!準)急行|express/.test(text)) result.trainType = "express";
  else if (/普通|各駅停車|local/.test(text)) result.trainType = "local";
  const spoken = {
    K01: ["こくさいかいかん"],
    K04: ["きたおおじ"],
    K05: ["くらまぐち"],
    K06: ["いまでがわ"],
    K07: ["まるたまち"],
    K08: ["からすまおいけ"],
    K09: ["しじょう"],
    K11: ["きょうと"],
    K15: ["たけだ"],
    B07: ["丹波橋", "たんばばし"],
  };
  const names = stops
    .flatMap((stop) =>
      [stop.name, stop.en, ...(stop.aliases ?? []), ...(spoken[stop.id] ?? [])]
        .filter(Boolean)
        .map((name) => ({ stop, name: normalize(name).replace(/駅$/, "") })),
    )
    .sort((a, b) => b.name.length - a.name.length);
  for (const { stop, name } of names) {
    const index = text.indexOf(name);
    if (index < 0) continue;
    if (
      /(?:次は|つぎは|まもなく|次の停車駅は|次の停留所は|next(?:station|stop)is|nextstop)$/.test(
        text.slice(0, index),
      )
    ) {
      result.nextStop ??= stop.id;
      (result.nextStopIds ??= []).push(stop.id);
    }
    if (
      /^(?:行|ゆき|方面|bound)/.test(text.slice(index + name.length)) ||
      /(?:boundfor|行先は)$/.test(text.slice(0, index))
    ) {
      result.destination ??= stop.id;
      (result.destinationIds ??= []).push(stop.id);
    }
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
  if (
    parsed.destination &&
    !(parsed.destinationIds ?? [parsed.destination]).includes(destination)
  )
    return null;
  const nextIndex = stops.findIndex(
    (s) =>
      Number.isFinite(s.departure ?? s.time ?? s.arrival) &&
      (s.departure ?? s.time ?? s.arrival) > minute,
  );
  const plausible =
    nextIndex >= 0
      ? stops.slice(Math.max(1, nextIndex - 1), nextIndex + 2).map((s) => s.id)
      : stops.slice(1, 3).map((s) => s.id);
  const matchedNext = (parsed.nextStopIds ?? [parsed.nextStop]).find((id) =>
    plausible.includes(id),
  );
  if (parsed.nextStop && !matchedNext) return null;
  if (!parsed.nextStop && !parsed.destination) return null;
  return {
    confidence: parsed.nextStop ? 0.9 : 0.75,
    directionVerified: true,
    nextStop: matchedNext ?? null,
  };
}
