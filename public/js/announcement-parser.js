const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s・、。,.:;!！?？\-]/g, "")
    .toLowerCase();

// Parse named fields, then compare the next stop/destination against a service.
// Merely hearing a route number or an arbitrary stop on its line is insufficient.
//
// On-train announcements on the Karasuma line and the Kintetsu Kyoto line
// (automatic, Japanese then English) follow fixed forms:
//   次駅   「次は四条、四条です。阪急線はお乗り換えです。」
//          「この電車は国際会館行きです。」「この電車は地下鉄線を通り国際会館行きです。」
//          "The next stop is Shijo, station number K09."
//          "This train is bound for Kokusaikaikan via the subway line."
//   到着   「四条、四条です。」「まもなく竹田です。」 "This is Takeda, station number B05."
// A station said twice and followed by です is the station being arrived at.
export function parseAnnouncement(transcript, stops = []) {
  const text = normalize(transcript),
    result = {
      line: null,
      route: null,
      destination: null,
      nextStop: null,
      trainType: null,
    };
  if (/烏丸線|からすません|地下鉄烏丸|karasumaline|地下鉄をご利用|地下鉄線をご利用/.test(text))
    result.line = "subway";
  else if (/近鉄|きんてつ|京都線|奈良線|kintetsu/.test(text))
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
    B02: ["とうじ"],
    B03: ["じゅうじょう"],
    B04: ["かみとばぐち"],
    B06: ["ふしみ"],
    B07: ["丹波橋", "たんばばし", "きんてつたんばばし"],
    B08: ["ももやまごりょうまえ"],
    B09: ["むかいじま"],
    B10: ["おぐら"],
    B11: ["いせだ"],
    B12: ["おおくぼ"],
    B13: ["くつかわ"],
    B14: ["てらだ"],
    B15: ["とのしょう"],
    B16: ["しんたなべ"],
    B26: ["やまとさいだいじ"],
    A28: ["きんてつなら"],
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
      // 「四条、四条です」 / "This is Takeda": the train is arriving here.
      if (
        (after.startsWith(name) && /^(?:です|でございます|に到着)/.test(after.slice(name.length))) ||
        /thisis$/.test(before)
      ) {
        result.arrival ??= stop.id;
        (result.nextStopIds ??= []).push(stop.id);
        result.nextStop ??= stop.id;
      }
      if (destinationSuffix.test(after) || destinationPrefix.test(before)) {
        result.destination ??= stop.id;
        (result.destinationIds ??= []).push(stop.id);
      }
      from = index + Math.max(1, name.length);
    }
  }
  // "station number K zero-nine" / 「駅番号K09」: the code names the station.
  const code = text.match(/(?:stationnumber|駅番号)([kab])(\d{1,2}|zero\w+|\w+)/);
  if (code) {
    const digits = toDigits(code[2]),
      spokenId = digits === null ? null : `${code[1].toUpperCase()}${String(digits).padStart(2, "0")}`,
      // Kintetsu numbers Takeda B05; the app keeps it as the subway's K15.
      id = spokenId === "B05" ? "K15" : spokenId;
    if (id && stops.some((stop) => stop.id === id)) {
      result.nextStop ??= id;
      (result.nextStopIds ??= []).push(id);
    }
  }
  if (result.nextStopIds) result.nextStopIds = [...new Set(result.nextStopIds)];
  if (result.destinationIds)
    result.destinationIds = [...new Set(result.destinationIds)];
  return result;
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
// "09", "zeronine", "eleven", "twentysix" → a number (or null).
function toDigits(value) {
  if (/^\d+$/.test(value)) return Number(value);
  let rest = value.replace(/^zero/, ""),
    total = 0;
  for (const [word, n] of Object.entries(TEENS).sort((a, b) => b[0].length - a[0].length))
    if (rest.startsWith(word)) {
      total = n;
      rest = rest.slice(word.length);
      break;
    }
  const unit = WORDS.findIndex((word) => rest.startsWith(word));
  if (unit >= 0) {
    total += unit;
    rest = rest.slice(WORDS[unit].length);
  } else if (!total) return null;
  return total;
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
  // Underground the ride is often found from the heard station itself, so
  // that station may be the ride's first one while the train has not left it.
  const firstTime = stops[0]?.departure ?? stops[0]?.time ?? stops[0]?.arrival,
    fromFirst = nextIndex <= 1 && Number.isFinite(firstTime) && firstTime >= minute - 2 ? 0 : 1;
  const plausible =
    nextIndex >= 0
      ? stops.slice(Math.max(fromFirst, nextIndex - 1), nextIndex + 2).map((s) => s.id)
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
