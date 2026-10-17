const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s・、。,.:;!！?？\-]/g, "")
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
  if (/烏丸線|からすません|地下鉄烏丸|karasumaline/.test(text))
    result.line = "subway";
  else if (/近鉄|京都線|奈良線|kintetsu/.test(text))
    result.line = "kintetsu";

  const route = text.match(/(?:北|南|西|特)?\d{1,3}(?=(?:系統|号系統|番))/);
  if (route) result.route = route[0];
  if (/(?<!準)急行|きゅうこう|express/.test(text)) result.trainType = "express";
  else if (/普通|各駅停車|ふつう|local/.test(text)) result.trainType = "local";

  const spoken = {
    K01: ["こくさいかいかん"],
    K02: ["まつがさき"],
    K03: ["きたやま"],
    K04: ["きたおおじ"],
    K05: ["くらまぐち"],
    K06: ["いまでがわ"],
    K07: ["まるたまち"],
    K08: ["からすまおいけ"],
    K09: ["しじょう"],
    K10: ["ごじょう"],
    K11: ["きょうと"],
    K12: ["くじょう"],
    K13: ["じゅうじょう"],
    K14: ["くいなばし"],
    K15: ["たけだ"],
    B07: ["丹波橋", "たんばばし"],
  };
  const names = stops
    .flatMap((stop) =>
      [
        stop.name,
        stop.en,
        stop.kana,
        stop.yomi,
        stop.reading,
        ...(stop.aliases ?? []),
        ...(spoken[stop.id] ?? []),
      ]
        .filter(Boolean)
        .map((name) => ({ stop, name: normalize(name).replace(/駅$/, "") })),
    )
    .filter((row) => row.name.length >= 2)
    .sort((a, b) => b.name.length - a.name.length);

  const nextPrefix =
      /(?:次は|つぎは|次の駅は|つぎのえきは|次の停車駅は|次の停車は|次の停留所は|まもなく|この次は|next(?:station|stop)is|nextstop)$/,
    destinationPrefix = /(?:boundfor|行先は|行き先は|ゆきさきは)$/,
    destinationSuffix = /^(?:行|行き|ゆき|方面|bound|boundfor)/;

  for (const { stop, name } of names) {
    let from = 0;
    while (from < text.length) {
      const relative = text.slice(from).indexOf(name);
      if (relative < 0) break;
      const index = from + relative,
        before = text.slice(0, index),
        after = text.slice(index + name.length);
      if (nextPrefix.test(before)) {
        result.nextStop ??= stop.id;
        (result.nextStopIds ??= []).push(stop.id);
      }
      if (destinationSuffix.test(after) || destinationPrefix.test(before)) {
        result.destination ??= stop.id;
        (result.destinationIds ??= []).push(stop.id);
      }
      from = index + Math.max(1, name.length);
    }
  }
  if (result.nextStopIds) result.nextStopIds = [...new Set(result.nextStopIds)];
  if (result.destinationIds)
    result.destinationIds = [...new Set(result.destinationIds)];
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
  const specificity =
    Number(Boolean(parsed.nextStop)) +
    Number(Boolean(parsed.destination)) +
    Number(Boolean(parsed.route)) +
    Number(Boolean(parsed.line)) +
    Number(Boolean(parsed.trainType));
  return {
    confidence: parsed.nextStop
      ? Math.min(0.96, 0.88 + Math.max(0, specificity - 1) * 0.02)
      : Math.min(0.88, 0.72 + Math.max(0, specificity - 1) * 0.025),
    directionVerified: true,
    nextStop: matchedNext ?? null,
  };
}
