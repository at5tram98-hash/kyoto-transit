import { getStaticFeed } from "./fast-data.js";
import { rideDetectionSession } from "./ride-detection-session.js";
import { subwayIds, kintetsuIds, normalize } from "./network.js";
import { setAppLocale, ui, userError } from "./locale.js";
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
export { icon } from "./icons.js";
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
  kintetsuStaticFeed: null,
  kintetsuStaticDate: null,
  throughTakeda: null,
  throughPrompt: null,
  subwayFeedDate: null,
  subwayFeedAt: 0,
  kyotoBusFeed: null,
  kyotoBusFeedAt: 0,
  kyotoBusNextFetchAt: 0,
  kyotoBusAvailability: "unconfirmed",
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
  kyotoBusPrediction: null,
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
// Kyoto Bus stops share the kerbside of the same-named city bus stop; borrow
// its coordinates. Stops without a located counterpart stay off the map.
export function augmentKyotoBusGeometry() {
  const key = (stop) => normalize(stop.fullName ?? stop.name);
  const located = new Map(state.geo.stops.map((s) => [s.id, s]));
  const cityByName = new Map();
  for (const stop of state.network.stops.values())
    if (stop.type === "citybus" && located.has(stop.id))
      for (const name of [stop.name, stop.fullName].filter(Boolean))
        cityByName.set(normalize(name), located.get(stop.id));
  for (const stop of state.network.stops.values()) {
    if (stop.type !== "kyotobus" || located.has(stop.id)) continue;
    const point = cityByName.get(key(stop)) ?? cityByName.get(normalize(stop.name));
    if (point) state.geo.stops.push({ id: stop.id, lat: point.lat, lng: point.lng });
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
    const session = rideDetectionSession.snapshot();
    writeJourney(
      localStorage,
      session.phase === "rechecking" && session.shell
        ? { ...state, ride: session.shell, rideRechecking: true }
        : state,
      { now: tokyoNow() },
    );
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
      if (saved.rideRechecking) {
        rideDetectionSession.confirm(saved.ride);
        rideDetectionSession.recheck(saved.ride);
        state.rideCandidates = [
          { ride: saved.ride, score: 55, source: ui("smartlive_rechecking") },
        ];
        state.ride = null;
        state.rideRechecking = false;
      } else rideDetectionSession.confirm(saved.ride);
      toast(ui("ride_restored"));
    } else localStorage.removeItem("mymap-active-journey-v1");
    state.itinerary = readItinerary(localStorage, state.network);
    if (state.itinerary) {
      const plan = state.itinerary,
        ride = plan.rides[plan.legIndex];
      if (state.ride && samePlannedRide(state.ride, ride))
        plan.phase = "riding";
      else if (
        rideDetectionSession.snapshot().phase !== "rechecking" &&
        ["armed", "transfer", "riding"].includes(plan.phase)
      ) {
        if (plan.phase === "riding") plan.phase = "armed";
        state.armedJourney = { ride, selectedAt: plan.savedAt };
      }
    }
  } catch {}
}
export function serviceName(ride) {
  if (!ride) return "";
  if (ride.operator === "subway") return ui("service_subway");
  if (ride.operator === "kintetsu")
    return ui(ride.category === "express" ? "service_kintetsu_express" : "service_kintetsu_local");
  if (ride.operator === "through") {
    const first = ride.officialStops?.find(
        (s) => s.id !== "K15" && state.network?.stops.has(s.id),
      ),
      start = state.network?.stops.get(first?.id)?.type;
    return `${ui(start === "kintetsu" ? "service_through_from_kintetsu" : start === "subway" ? "service_through_from_subway" : "service_through")}${ride.category === "express" ? ui("service_express_suffix") : ""}`;
  }
  if (ride.operator === "citybus") return ui("service_citybus", [ride.route]);
  if (ride.operator === "kyotobus") return ui("service_kyotobus", [ride.route]);
  return ride.label ?? ui("service_riding");
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
      if (force) toast(userError(error));
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
        raw = await getStaticFeed("subway", now.date, { force });
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
      if (force) toast(userError(error));
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
