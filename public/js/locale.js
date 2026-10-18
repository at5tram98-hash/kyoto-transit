// Locale and time zone have a single owner. Transit service dates stay in Japan.
import japaneseUI from "./locale-ui-ja.js";
import englishUI from "./locale-ui-en.js";
// Initialize before any screen's module-level labels are evaluated. The
// persisted settings remain the only preference store.
let activeLocale = (() => {
  try {
    return JSON.parse(
      globalThis.localStorage?.getItem("mymap-vnext-settings") ?? "{}",
    ).locale === "en"
      ? "en"
      : "ja";
  } catch {
    return "ja";
  }
})();
export function setAppLocale(value) {
  activeLocale = value === "en" ? "en" : "ja";
  if (typeof document !== "undefined") {
    document.documentElement.lang = activeLocale;
    for (const node of document.querySelectorAll("[data-ui]"))
      node.textContent = ui(node.dataset.ui);
    for (const node of document.querySelectorAll("[data-ui-aria]"))
      node.setAttribute("aria-label", ui(node.dataset.uiAria));
  }
}
export function ui(key, values = []) {
  const pattern =
    (activeLocale === "en" ? englishUI[key] : null) ?? japaneseUI[key];
  if (pattern === undefined) throw Error(`Unknown UI message: ${key}`);
  return pattern.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)]));
}
export const displayStopName = (stop) =>
  activeLocale === "en" ? (stop?.en ?? stop?.name ?? "") : (stop?.name ?? "");
export const transitTimeZone = "Asia/Tokyo";
export function serviceDateLabel(date) {
  return new Intl.DateTimeFormat(activeLocale === "en" ? "en-GB" : "ja-JP", {
    timeZone: transitTimeZone,
    year: "numeric",
    month: activeLocale === "en" ? "short" : "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00+09:00`));
}
const messages = {
  ja: {
    live: "Live",
    quick: "Quick Select",
    searchStop: "駅・停留所を検索",
    nearby: "付近の交通",
    refresh: "交通情報を更新",
    saved: "保存した場所",
    more: "その他の操作",
    locationMissing: "現在地を取得できません",
    locationLoading: "現在地を確認中",
    nearbyUnknown: "現在地を取得すると付近の交通を表示します",
    schedule: "予定",
    liveSource: "実測",
    prediction: "予測",
    offline: "オフライン",
    map: "地図を大きく表示",
    unknownDay: "ダイヤ未確認",
    weekdays: "平日ダイヤ",
    saturday: "土曜ダイヤ",
    holiday: "休日ダイヤ",
  },
  en: {
    live: "Live",
    quick: "Quick Select",
    searchStop: "Search stations and stops",
    nearby: "Nearby transit",
    refresh: "Refresh transit",
    saved: "Saved places",
    more: "More actions",
    locationMissing: "Location unavailable",
    locationLoading: "Finding your location",
    nearbyUnknown: "Enable location to see nearby transit",
    schedule: "Scheduled",
    liveSource: "Live",
    prediction: "Estimated",
    offline: "Offline",
    map: "Open full map",
    unknownDay: "Service calendar unavailable",
    weekdays: "Weekday service",
    saturday: "Saturday service",
    holiday: "Holiday service",
  },
};
export const appLocale = (settings = {}) =>
  settings.locale === "en" ? "en" : "ja";
export const message = (key, settings) =>
  messages[appLocale(settings)][key] ?? messages.ja[key] ?? key;
export function liveClock(date, { locale = "ja", hour12 = false } = {}) {
  const parts = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ja-JP", {
    timeZone: transitTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12,
  }).formatToParts(date);
  return {
    time: parts
      .filter((p) => ["hour", "minute", "second", "literal"].includes(p.type))
      .map((p) => p.value)
      .join("")
      .trim(),
    period: parts.find((p) => p.type === "dayPeriod")?.value ?? "24h",
  };
}

// Durations are elapsed minutes, independent of service-date clock formatting.
export function durationLabel(value) {
  if (!Number.isFinite(value) || value < 0) return "—";
  const minutes = Math.round(value),
    hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  if (activeLocale === "en")
    return hours ? `${hours} hr ${rest} min` : `${minutes} min`;
  return hours ? `${hours}時間${rest}分` : `${minutes}分`;
}
