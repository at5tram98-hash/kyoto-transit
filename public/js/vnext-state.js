import { subwayIds, kintetsuIds } from "./network.js";
import { setAppLocale, ui } from "./locale.js";
import { distance } from "./mobility.js";
import { trajectory, freshFix } from "./riding.js";
import { getRailLocation, CAPTURE_API } from "./live.js";
import { officialData } from "./timetable-ui.js";
import { mergeTimetableFeeds } from "./search-core.js";
import { getCached, putCached } from "./realtime.js";
import { readJourney, writeJourney, journeyKey } from "./journey-session.js";
import {
  readItinerary,
  writeItinerary,
  samePlannedRide,
} from "./journey-plan.js";

export const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const minuteOf = (time) => {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + m;
};
const tokyoFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export const tokyoNow = () => {
  const p = tokyoFormatter.format(new Date()).split(" ");
  return { date: p[0], time: p[1], minute: minuteOf(p[1]) };
};
const icons = {
  swap: '<path d="M8 3v18m-4-4 4 4 4-4M16 21V3m-4 4 4-4 4 4"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7Z"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16"/>',
  ticket:
    '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 9h5m-5 4h10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  walk: '<circle cx="14" cy="4" r="2"/><path d="m7 12 4-5 4 2 3 1M11 7l-1 7-4 6m4-6 5 2 2 5"/>',
  bookmark: '<path d="M6 3h12v19l-6-4-6 4Z"/>',
  share: '<path d="M12 15V2m-4 4 4-4 4 4M7 9H4v12h16V9h-3"/>',
  camera:
    '<rect x="3" y="6" width="18" height="15" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M8 6l2-3h4l2 3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  now: '<path d="M4 12a8 8 0 1 0 16 0A8 8 0 0 0 4 12Z"/><path d="M12 7v5l3 2"/>',
  timetable:
    '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4m8-4v4M4 10h16M8 14h3m2 0h3m-8 3h3m2 0h3"/>',
  operations: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a8 8 0 0 0-1.7 1l-2.4-1-2 3.4L5.1 11a7 7 0 0 0 0 2L3 14.5 5 18l2.4-1a8 8 0 0 0 1.7 1l.4 3h5l.4-3a8 8 0 0 0 1.7 1l2.4 1 2-3.5-2.1-1.5a7 7 0 0 0 .1-1Z"/>',
  location: '<path d="m12 3 7 18-7-5-7 5Z"/>',
  train:
    '<rect x="5" y="3" width="14" height="16" rx="4"/><path d="M5 11h14M12 3v8M8 22l2-3m6 3-2-3M8 15h.01M16 15h.01"/>',
  bus: '<rect x="4" y="4" width="16" height="15" rx="3"/><path d="M4 11h16M12 4v7M7 19v3m10-3v3M7 15h.01M17 15h.01"/>',
  refresh:
    '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.2 7.7A8 8 0 0 1 19 9m-1.2 7.3A8 8 0 0 1 5 15"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  fold: '<path d="M5 17V9a5 5 0 0 1 10 0v10m-4-4 4 4 4-4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] ?? icons.info}</svg>`;
function storedSettings() {
  try {
    const value = JSON.parse(
      localStorage.getItem("mymap-vnext-settings") || "{}",
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}
export const settings = Object.assign(
  {
    autoDetect: true,
    haptics: true,
    showConfidence: false,
    railGuideDistance: 350,
    passCityBus: false,
    passKyotoBus: false,
    passSubway: false,
    passSubwayFrom: "K01",
    passSubwayTo: "K11",
    passExpires: "",
  },
  storedSettings(),
);
export const saveSettings = () => {
  try {
    localStorage.setItem("mymap-vnext-settings", JSON.stringify(settings));
  } catch {}
};
setAppLocale(settings.locale);
export const state = {
  network: null,
  geo: null,
  fix: null,
  location: null,
  samples: [],
  tab: "now",
  ride: null,
  rideSource: null,
  rideConfidence: 0,
  rideShift: 0,
  rideShiftKnown: false,
  rideStartedAt: 0,
  rideObservation: null,
  rideCandidates: [],
  rideConsensusCount: 0,
  railFeed: null,
  railFeedAt: 0,
  subwayFeed: null,
  subwayFeedDate: null,
  subwayFeedAt: 0,
  kyotoBusFeed: null,
  kyotoBusFeedAt: 0,
  busLive: null,
  busLiveAt: 0,
  busTrail: [],
  detectBusy: false,
  lastDetectAt: 0,
  lastNearbyId: null,
  locationStatus: "loading",
  locationSession: null,
  lastRideSeenAt: 0,
  foldbackRide: null,
  foldbackPlan: null,
  heroObservation: null,
  delayHistory: [],
  armedJourney: null,
  itinerary: null,
  north3Snapshot: null,
};
export const haptic = () => {
  if (settings.haptics && navigator.vibrate) navigator.vibrate(8);
};
export function toast(message) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
}
let nearestCache = null;
export function nearest() {
  const { fix, geo, network } = state;
  if (!fix || !geo || !network || !freshFix(fix))
    return { rail: null, bus: null, kyotoBus: null, all: [] };
  if (
    nearestCache?.fix === fix &&
    nearestCache.geo === geo &&
    nearestCache.network === network &&
    nearestCache.count === geo.stops.length
  )
    return nearestCache.result;
  const all = geo.stops
      .filter((s) => network.stops.has(s.id))
      .map((s) => ({
        ...s,
        meters: distance(fix, s),
        stop: network.stops.get(s.id),
      }))
      .sort((a, b) => a.meters - b.meters),
    result = {
      all,
      rail: all.find((s) => ["subway", "kintetsu"].includes(s.stop.type)),
      bus: all.find((s) => ["citybus", "kyotobus"].includes(s.stop.type)),
      kyotoBus: all.find((s) => s.stop.type === "kyotobus"),
    };
  nearestCache = { fix, geo, network, count: geo.stops.length, result };
  return result;
}
export function speed() {
  const m = trajectory(state.samples);
  return Number.isFinite(m.speed) ? m.speed : 0;
}
export function augmentKyotoBusGeometry() {
  for (const [id, name] of [
    ["kyotobus-karasuma-marutamachi", "烏丸丸太町"],
    ["kyotobus-senbon-marutamachi", "千本丸太町"],
  ]) {
    if (state.geo.stops.some((s) => s.id === id)) continue;
    const city = [...state.network.stops.values()].find(
        (s) => s.type === "citybus" && s.name === name,
      ),
      point = city && state.geo.stops.find((s) => s.id === city.id);
    if (point) state.geo.stops.push({ id, lat: point.lat, lng: point.lng });
  }
}
export const rideKey = journeyKey;
let lastJourneyWrite = "";
export function persistJourney(force = false) {
  const signature = JSON.stringify([
    state.ride,
    state.rideShift,
    state.rideSource,
    state.foldbackPlan,
    state.itinerary,
  ]);
  if (!force && signature === lastJourneyWrite) return;
  try {
    writeJourney(localStorage, state, { now: tokyoNow() });
    writeItinerary(localStorage, state.itinerary);
    lastJourneyWrite = signature;
  } catch {}
}
export function restoreJourney() {
  try {
    const saved = readJourney(localStorage, {
      now: tokyoNow(),
      network: state.network,
    });
    if (saved) {
      Object.assign(state, saved);
      toast(ui("ride_restored"));
    } else localStorage.removeItem("mymap-active-journey-v1");
    state.itinerary = readItinerary(localStorage, state.network);
    if (state.itinerary) {
      const plan = state.itinerary,
        ride = plan.rides[plan.legIndex];
      if (state.ride && samePlannedRide(state.ride, ride))
        plan.phase = "riding";
      else if (["armed", "transfer", "riding"].includes(plan.phase)) {
        if (plan.phase === "riding") plan.phase = "armed";
        state.armedJourney = { ride, selectedAt: plan.savedAt };
      }
    }
  } catch {}
}
export function serviceName(ride) {
  if (!ride) return "";
  if (ride.operator === "subway") return "地下鉄烏丸線";
  if (ride.operator === "kintetsu")
    return `近鉄京都線${ride.category === "express" ? "・急行" : "・普通"}`;
  if (ride.operator === "through") {
    const first = ride.officialStops?.find(
        (s) => s.id !== "K15" && state.network?.stops.has(s.id),
      ),
      start = state.network?.stops.get(first?.id)?.type;
    return `${start === "kintetsu" ? "近鉄→烏丸線直通" : start === "subway" ? "烏丸線→近鉄直通" : "烏丸線・近鉄直通"}${ride.category === "express" ? "・急行" : ""}`;
  }
  if (ride.operator === "citybus") return `京都市バス ${ride.route}系統`;
  if (ride.operator === "kyotobus") return `京都バス ${ride.route}系統`;
  return ride.label ?? "乗車中";
}
export const modeClass = (ride) =>
  ["citybus", "kyotobus"].includes(ride?.operator)
    ? "bus"
    : ride?.operator === "subway"
      ? "subway"
      : "rail";
export const official = (path, params = {}) => officialData(path, params);
let railJob = null,
  subwayJob = null;
export function ensureRailFeed(force = false) {
  if (railJob) return railJob;
  if (!force && state.railFeed && Date.now() - state.railFeedAt < 45000)
    return Promise.resolve(state.railFeed);
  railJob = (async () => {
    try {
      state.railFeed = await getRailLocation(AbortSignal.timeout(45000));
      state.railFeedAt = Date.now();
      return state.railFeed;
    } catch (error) {
      if (force) toast(error.message);
      return state.railFeed;
    }
  })().finally(() => {
    railJob = null;
  });
  return railJob;
}
export function ensureSubwayFeed(force = false) {
  const now = tokyoNow();
  if (subwayJob?.date === now.date) return subwayJob.promise;
  if (
    !force &&
    state.subwayFeed &&
    state.subwayFeedDate === now.date &&
    Date.now() - state.subwayFeedAt < 15 * 60 * 1000
  )
    return Promise.resolve(state.subwayFeed);
  const job = { date: now.date, promise: null };
  job.promise = (async () => {
    try {
      let raw,
        cached = false;
      const key = `static:subway:${now.date}`;
      try {
        raw = await official("/api/static/feed", {
          operator: "subway",
          date: now.date,
        });
        await putCached(key, { data: raw, savedAt: Date.now() });
      } catch (error) {
        raw = (await getCached(key))?.data;
        cached = true;
        if (!raw) throw error;
      }
      const mapped = mergeTimetableFeeds({ ...state.network, services: [] }, [
        raw,
      ]);
      if (tokyoNow().date !== now.date) return null;
      state.subwayFeed = { ...raw, cached, services: mapped.services };
      state.subwayFeedDate = now.date;
      state.subwayFeedAt = Date.now();
      return state.subwayFeed;
    } catch (error) {
      if (force) toast(error.message);
      else console.warn("subway static feed", error);
      return state.subwayFeedDate === now.date ? state.subwayFeed : null;
    }
  })().finally(() => {
    if (subwayJob === job) subwayJob = null;
  });
  subwayJob = job;
  return job.promise;
}
export function inferRailDirection(fromId, operator = "auto") {
  const ids =
      operator === "subway"
        ? subwayIds
        : operator === "kintetsu"
          ? kintetsuIds
          : state.network.stops.get(fromId)?.type === "subway"
            ? subwayIds
            : kintetsuIds,
    i = ids.indexOf(fromId);
  if (i < 0 || state.samples.length < 2) return null;
  const first = state.samples[0],
    last = state.samples.at(-1),
    get = (id) => state.geo.stops.find((s) => s.id === id),
    south = get(ids[i + 1]),
    north = get(ids[i - 1]),
    ds = south ? distance(first, south) - distance(last, south) : -Infinity,
    dn = north ? distance(first, north) - distance(last, north) : -Infinity;
  if (Math.max(ds, dn) < 20) return null;
  return ds > dn ? "south" : "north";
}
export { CAPTURE_API };
