import { rideDetectionSession } from "./ride-detection-session.js";
import { missedConnection } from "./journey-recovery.js";
import { ui } from "./locale.js";
import {
  transitEvidenceEngine as consensus,
  transitCandidateKey,
  orderedStopEvidence,
} from "./transit-evidence.js";
import { matchArmedJourney } from "./ride-state-resolver.js";
import { kintetsuIds } from "./network.js";
import { distance, segmentDistance } from "./mobility.js";
import {
  trajectory,
  rankRides,
  freshFix,
  matchMeasuredVehicles,
  applyRideMotionEvidence,
} from "./riding.js";
import { currentMotionEvidence, currentRailMotion } from "./motion-assist.js";
import { assessBoardingMovement } from "./auto-boarding-evidence.js";
import {
  findThroughContinuation,
  spansTakeda,
  joinThroughFromFeeds,
  throughContinuations,
  throughDirection,
  applyThroughContinuation,
} from "./through-continuity.js";
import { getKyotoBusRT } from "./live.js";
import { fetchRealtime, getCached } from "./realtime.js";
import { loadNorth3Snapshot, north3Feed } from "./north3-feed.js";
import { officialTripLeg } from "./vehicle.js";
import {
  subwayRideCandidates,
  cityBusRideCandidates,
  north3RideCandidates,
  routeIntersection,
  kyotoBusStaticCandidates,
  formatMinute,
} from "./vnext-core.js";
import { getStaticFeed } from "./fast-data.js";
import { journeyClock, stopTime } from "./journey-core.js";
import { observeJourney } from "./journey-observation.js";
import { boardingAvailable, selectedRideShift } from "./journey-session.js";
import {
  samePlannedRide,
  advanceItinerary,
  itineraryDestinationChanged,
} from "./journey-plan.js";
import {
  state,
  settings,
  tokyoNow,
  nearest,
  speed,
  sleep,
  haptic,
  toast,
  rideKey,
  serviceName,
  official,
  ensureRailFeed,
  ensureSubwayFeed,
  inferRailDirection,
  persistJourney,
} from "./vnext-state.js";

let lastNextAlertKey = null,
  detectionGeneration = 0;
const scoreClamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const asCandidate = (ride, score, source, extra = {}) => ({
  ride,
  score: scoreClamp(score),
  source,
  ...extra,
});
function onRailCorridor(fix, type) {
  if (!fix || !state.geo?.lines) return false;
  const names =
    type === "subway" ? new Set(["烏丸線"]) : new Set(["京都線", "奈良線"]);
  return state.geo.lines
    .filter((l) => names.has(l.line))
    .some((l) =>
      l.points.some(
        (p, i) =>
          i &&
          segmentDistance(
            fix,
            { lng: l.points[i - 1][0], lat: l.points[i - 1][1] },
            { lng: p[0], lat: p[1] },
          ) <= Math.min(140, Math.max(80, fix.accuracy * 1.4)),
      ),
    );
}

async function detectKintetsu(stopId) {
  const now = tokyoNow(),
    feed = await ensureRailFeed(),
    data = await official("/rider/candidates", {
      stop: stopId,
      date: now.date,
      minute: now.minute,
    }),
    legs = data.trips
      .map((t) => officialTripLeg(t, state.network))
      .filter(Boolean);
  if (!legs.length) return [];
  const direction = inferRailDirection(stopId, "kintetsu"),
    ranked = rankRides(legs, {
      network: state.network,
      geo: state.geo,
      samples: state.samples,
      minute: now.minute,
      railFeed: feed,
      busFeed: null,
    });
  return ranked
    .map((r) => {
      let score = r.score;
      if (direction) {
        const a = kintetsuIds.indexOf(r.leg.from),
          b = kintetsuIds.indexOf(r.leg.to),
          legDirection = b > a ? "south" : "north";
        if (legDirection !== direction) score -= 20;
      }
      return asCandidate(r.leg, score, "近鉄公式時刻表＋列車位置＋現在地", {
        live: r.live,
        liveObservedAt: Date.parse(
          feed?.sourceUpdatedAt ?? feed?.capturedAt ?? "",
        ),
        liveDirectionVerified: Boolean(r.live),
        evidence: r.evidence,
      });
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

async function ensureKyotoBusFeed() {
  const now = Date.now();
  // Avoid repeatedly calling an unconfigured provider on every GPS update.
  if (now < (state.kyotoBusNextFetchAt ?? 0))
    return state.kyotoBusAvailability === "live" ? state.kyotoBusFeed : null;
  state.kyotoBusNextFetchAt = now + 20000;
  try {
    const feed = await getKyotoBusRT(AbortSignal.timeout(4000));
    if (!Array.isArray(feed?.vehicles)) throw Error("京都バスの車両情報が不正です。");
    state.kyotoBusFeed = feed;
    state.kyotoBusFeedAt = Date.now();
    state.kyotoBusAvailability =
      feed.source === "live" && !feed.stale ? "live" : "stale";
    state.kyotoBusNextFetchAt = Date.now() + (state.kyotoBusAvailability === "live" ? 12000 : 30000);
    return state.kyotoBusAvailability === "live" ? feed : null;
  } catch (e) {
    state.kyotoBusAvailability =
      e?.code === "odpt_not_configured" ? "unconfigured" : "unavailable";
    state.kyotoBusNextFetchAt =
      Date.now() + (e?.code === "odpt_not_configured" ? 300000 : e?.status === 429 ? 60000 : 30000);
    // Old vehicle locations are not current boarding evidence.
    state.kyotoBusFeed = null;
    if (e?.code !== "odpt_not_configured") console.warn("kyotobus rt", e);
    return null;
  }
}

// Network evidence never holds up a detection cycle. A request is started
// (once per key), awaited briefly, and if it is still in flight the cycle
// continues with what is already known; when it lands, detection re-runs
// immediately through the transit-evidence event.
const SLOW = Symbol("slow"),
  liveJobs = new Map(),
  liveValues = new Map(),
  lateKeys = new Set();
export async function boundedLive(
  key,
  start,
  { wait = 1500, maxAge = 30000, retryAfter = 10000, now = Date.now() } = {},
) {
  const known = liveValues.get(key);
  if (known && now - known.at <= (known.value == null ? retryAfter : maxAge))
    return known.value;
  let job = liveJobs.get(key);
  if (!job) {
    job = Promise.resolve()
      .then(start)
      .then(
        (value) => value ?? null,
        () => null,
      )
      .then((value) => {
        liveValues.set(key, { value, at: Date.now() });
        if (liveValues.size > 40)
          liveValues.delete(liveValues.keys().next().value);
        liveJobs.delete(key);
        if (lateKeys.delete(key) && value != null)
          globalThis.document?.dispatchEvent?.(
            new CustomEvent("mymap-transit-evidence"),
          );
        return value;
      });
    liveJobs.set(key, job);
  }
  const result = await Promise.race([
    job,
    new Promise((resolve) => setTimeout(() => resolve(SLOW), wait)),
  ]);
  if (result !== SLOW) return result;
  lateKeys.add(key);
  return known?.value ?? null;
}
export function resetBoundedLive() {
  liveJobs.clear();
  liveValues.clear();
  lateKeys.clear();
}

// 京都バスナビ: the official scheduled and predicted times for a served pair.
async function kyotoBusNav(fromId, toId) {
  const from = state.network.stops.get(fromId)?.name,
    to = state.network.stops.get(toId)?.name;
  if (!from || !to || from === to) return null;
  return boundedLive(`kyotobus:nav:${from}:${to}`, () =>
    fetchRealtime(
      `kyotobus:nav:${from}:${to}`,
      "/api/kyotobus/approach",
      { from, to },
      { timeout: 8000 },
    ),
  );
}
// The same trip is the one whose official scheduled departure matches.
export function kyotoBusNavTrip(nav, ride) {
  if (!nav?.buses?.length || !Number.isFinite(ride?.depart)) return null;
  const bus = nav.buses.find(
    (b) =>
      b.departure?.scheduled === ride.depart &&
      (!ride.route || String(b.route) === String(ride.route).replace(/^(?:特|直行)/, "")),
  );
  if (!bus) return null;
  const arrival = bus.arrival ?? {},
    delay =
      Number.isFinite(arrival.predicted) && Number.isFinite(arrival.scheduled)
        ? arrival.predicted - arrival.scheduled
        : Number.isFinite(bus.departure.predicted)
          ? bus.departure.predicted - bus.departure.scheduled
          : null;
  return { ...bus, delay, asOf: nav.capturedAt ?? nav.asOf };
}

async function detectKyotoBus(stopId) {
  const now = tokyoNow(),
    staticFeed = await boundedLive(
      `static:kyotobus:${now.date}`,
      () => getStaticFeed("kyotobus", now.date),
      { wait: 2500, maxAge: 30 * 60000, retryAfter: 60000 },
    ),
    staticLegs = kyotoBusStaticCandidates(staticFeed, {
      fromId: stopId,
      minute: now.minute,
      network: state.network,
    });
  // The official per-stop pages are only read when the static feed has no
  // trip here (it is slow and may be rate limited upstream).
  const data = staticLegs.length
      ? null
      : await boundedLive(
          `rider:${stopId}:${now.date}:${Math.floor(now.minute / 5)}`,
          () =>
            official("/rider/candidates", {
              stop: stopId,
              date: now.date,
              minute: now.minute,
            }),
          { wait: 2500, maxAge: 5 * 60000, retryAfter: 30000 },
        ),
    legs = (
      staticLegs.length
        ? staticLegs
        : (data?.trips ?? []).map((t) => officialTripLeg(t, state.network))
    )
      .filter(Boolean)
      .filter((l) => now.minute >= l.depart - 8 && now.minute <= l.arrive + 5);
  if (!legs.length) return [];
  const navByPair = new Map();
  for (const ride of legs) {
    const key = `${ride.from}|${ride.to}`;
    if (!navByPair.has(key)) navByPair.set(key, kyotoBusNav(ride.from, ride.to));
  }
  const feed = await ensureKyotoBusFeed(),
    ranked = rankRides(legs, {
      network: state.network,
      geo: state.geo,
      samples: state.samples,
      minute: now.minute,
      railFeed: null,
      busFeed: null,
    }),
    rankMap = new Map(ranked.map((r) => [rideKey(r.leg), r]));
  const scored = legs
    .map((ride) => {
      const base = rankMap.get(rideKey(ride)),
        measured = matchMeasuredVehicles(ride, feed?.vehicles ?? [], {
          network: state.network,
          samples: state.samples,
          now: Date.now(),
        })[0],
        scheduleScore =
          base?.score ??
          (now.minute >= ride.depart - 2 && now.minute <= ride.arrive + 3
            ? 38
            : 22),
        score = measured
          ? scoreClamp(scheduleScore * 0.62 + measured.score * 0.68)
          : scoreClamp(scheduleScore + 20),
        live = measured?.vehicle ?? null;
      return { ride, base, measured, scheduleScore, score, live };
    });
  const rows = [];
  for (const { ride, base, measured, score, live } of scored) {
    const navTrip = kyotoBusNavTrip(await navByPair.get(`${ride.from}|${ride.to}`), ride),
      navAt = Date.parse(navTrip?.asOf ?? ""),
      // The official prediction says this trip is departing now.
      navPresent =
        Boolean(navTrip) &&
        ((Number.isFinite(navTrip.minutesToDeparture) && navTrip.minutesToDeparture <= 1) ||
          (Number.isFinite(navTrip.departure.predicted) &&
            Math.abs(navTrip.departure.predicted - now.minute) <= 1));
    rows.push(
      asCandidate(
        ride,
        score + (navPresent ? 12 : navTrip ? 4 : 0),
        live
          ? "京都バス車両位置＋公式時刻表＋現在地"
          : navTrip
            ? "京都バスナビ公式予測＋公式時刻表＋現在地"
            : "京都バス公式時刻表＋現在地",
        {
          live: live ?? navTrip,
          liveObservedAt: live
            ? Number(live.timestamp) * 1000
            : Number.isFinite(navAt)
              ? navAt
              : null,
          livePresence:
            (measured?.score >= 55 && measured?.meters <= 140) || navPresent,
          liveDirectionVerified: navPresent,
          evidence: [...(base?.evidence ?? []), ...(measured?.evidence ?? [])],
        },
      ),
    );
  }
  return rows
    .sort(
      (a, b) =>
        b.score - a.score ||
        Math.abs(a.ride.depart - now.minute) -
          Math.abs(b.ride.depart - now.minute),
    )
    .slice(0, 3);
}

async function detectSubway(
  stopId,
  { throughOnly = false, windowBefore = 4, stationsTravelled = null } = {},
) {
  const now = tokyoNow(),
    feed = await ensureSubwayFeed();
  if (!feed?.services?.length) return [];
  const directionHint = inferRailDirection(stopId, "subway"),
    legs = subwayRideCandidates(feed, {
      fromId: stopId,
      direction: directionHint,
      minute: now.minute,
      network: state.network,
      windowBefore,
      windowAfter: 1,
    }).filter((ride) =>
      !throughOnly || (ride.operator === "through" && spansTakeda(ride.officialStops))
    );
  if (!legs.length) return [];
  const ranked = rankRides(legs, {
    network: state.network,
    geo: state.geo,
    samples: state.samples,
    minute: now.minute,
    railFeed: null,
    busFeed: null,
  });
  // Underground: stations travelled (counted from the accelerometer) must
  // agree with where each train should be by its timetable.
  const hops = (leg) =>
    (leg.officialStops ?? [])
      .slice(1)
      .filter((s) => Number.isFinite(s.departure ?? s.time) && (s.departure ?? s.time) <= now.minute)
      .length;
  const runFit = (leg) => {
    if (!Number.isFinite(stationsTravelled)) return 0;
    const diff = Math.abs(hops(leg) - stationsTravelled);
    return diff === 0 ? 15 : diff === 1 ? 4 : -20;
  };
  return ranked
    .map((r) =>
      asCandidate(
        r.leg,
        r.score + 35 + runFit(r.leg),
        Number.isFinite(stationsTravelled)
          ? "地下鉄公式全駅時刻表＋走行・停車の回数"
          : "地下鉄公式全駅時刻表＋現在地",
        {
          evidence: r.evidence,
          stationsTravelled,
        },
      ),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        Math.abs(a.ride.depart - now.minute) -
          Math.abs(b.ride.depart - now.minute),
    )
    .slice(0, 3);
}

export function updateBusTrail(id, meters) {
  if (!id || meters > 130) return;
  const last = state.busTrail.at(-1);
  if (last?.id === id) return;
  state.busTrail.push({ id, at: Date.now() });
  state.busTrail = state.busTrail
    .filter((x) => Date.now() - x.at < 8 * 60 * 1000)
    .slice(-4);
}

// Official destination text such as 「北大路バスターミナル・金閣寺」 names
// places served after this stop. A row supports a direction only when one of
// those places is downstream on that direction's stop list.
export function busRowServesDirection(row, ride) {
  const downstream = (ride.officialStops ?? [])
    .slice(1)
    .map((stop) => normalizeStopText(stop.name));
  return String(row?.dest ?? "")
    .replace(/（[^）]*）|\([^)]*\)/g, "・")
    .split(/[・、,\s]+/)
    .map((part) => normalizeStopText(part.replace(/(?:まで|行き?)$/, "")))
    .filter((part) => part.length >= 2)
    .some((part) => downstream.some((name) => name.includes(part) || part.includes(name)));
}
const normalizeStopText = (value) =>
  String(value ?? "").normalize("NFKC").replace(/[\s・･（）()]/g, "");

let north3Cache = null;
async function north3TimetableFeed(date) {
  if (north3Cache?.date === date) return north3Cache.feed;
  try {
    const feed = north3Feed(await loadNorth3Snapshot(), state.network, date);
    north3Cache = { date, feed };
    return feed;
  } catch {
    return null;
  }
}

// Reuse what the arrivals panel already fetched for this stop (or the
// device cache) so detection never adds a second request per refresh
// interval; fetch only when nothing recent exists.
async function cityArrivals(name) {
  const recent = (data) =>
    Date.now() - Date.parse(data?.asOf ?? "") <= 30000 ? data : null;
  if (state.busLive?.stop === name && Date.now() - state.busLiveAt <= 30000)
    return state.busLive;
  try {
    const cached = recent((await getCached(`citybus:${name}`))?.data);
    if (cached) return cached;
  } catch {}
  return boundedLive(`citybus:${name}`, () =>
    fetchRealtime(
      `citybus:${name}`,
      "/api/citybus/arrivals",
      { stop: name },
      { timeout: 10000 },
    ),
  );
}

async function detectCityBus(stopInfo) {
  const now = tokyoNow(),
    trail = state.busTrail.map((x) => x.id),
    routes = routeIntersection(
      trail.length >= 2 ? trail : [stopInfo.id],
      state.network,
    );
  if (!routes.length) return [];
  const stop = state.network.stops.get(stopInfo.id),
    name = stop.fullName ?? stop.name;
  const arrivals = await cityArrivals(name);
  const observedAt = Date.parse(arrivals?.asOf ?? ""),
    observed =
      arrivals?.source === "live" &&
      !arrivals.stale &&
      Number.isFinite(observedAt) &&
      Date.now() - observedAt <= 90000;
  const rows = [];
  for (const route of routes.slice(0, 3)) {
    const routeRows = observed
      ? (arrivals.results ?? []).filter(
          (row) => String(row.route) === String(route) && row.source === "live",
        )
      : [];
    const timed =
      route === "北3"
        ? north3RideCandidates(await north3TimetableFeed(now.date), {
            fromId: stopInfo.id,
            minute: now.minute,
            network: state.network,
          }).slice(0, 4)
        : [];
    const rides = timed.length
      ? timed
      : cityBusRideCandidates({
          route,
          currentStopId: stopInfo.id,
          trail,
          network: state.network,
          minute: now.minute,
        });
    for (const ride of rides) {
      const directionRows = routeRows.filter((row) =>
          busRowServesDirection(row, ride),
        ),
        // A bus at or one stop before this stop, in this direction.
        present = directionRows.find(
          (row) =>
            (Number.isFinite(row.stopsAway) && row.stopsAway <= 1) ||
            (Number.isFinite(row.minutes) && row.minutes <= 2),
        );
      const score = (present ? 68 : 55) + (ride.orderedTrail ? 15 : 0);
      rows.push(
        asCandidate(
          ride,
          score,
          present ? "市バス接近情報＋停留所の通過順" : "路線の停留所列＋現在地",
          {
            live: present ? { ...present, asOf: arrivals.asOf } : null,
            liveObservedAt: present ? observedAt : null,
            livePresence: Boolean(present),
            liveDirectionVerified: Boolean(present),
          },
        ),
      );
    }
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, 3);
}

function mergeCandidates(...groups) {
  const map = new Map();
  for (const row of groups.flat().filter(Boolean)) {
    const key = transitCandidateKey(row.ride);
    const old = map.get(key);
    if (!old || row.score > old.score) map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.score - a.score).slice(0, 24);
}

function applyRide(candidate) {
  const rechecking = rideDetectionSession.snapshot().phase === "rechecking";
  const corrected = rideDetectionSession.confirm(candidate.ride, Date.now(), {
    manual: candidate.manual === true,
  });
  const changed = rideKey(state.ride) !== rideKey(candidate.ride);
  if (state.itinerary) {
    if (
      samePlannedRide(
        state.itinerary.rides[state.itinerary.legIndex],
        candidate.ride,
      )
    )
      state.itinerary = { ...state.itinerary, phase: "riding" };
    else if (!rechecking) state.itinerary = null;
  }
  consensus.lock(candidate.ride);
  state.ride = candidate.ride;
  if (!rechecking) state.armedJourney = null;
  state.heroObservation = null;
  if (changed) state.delayHistory = [];
  state.rideSource = candidate.source;
  state.rideConfidence = candidate.score;
  state.rideConfidenceBase = candidate.score;
  state.rideManuallyConfirmed = candidate.manual === true;
  state.lastRideSeenAt = Date.now();
  state.rideCandidates = [];
  state.rideConsensusCount = 0;
  if (changed) {
    state.rideShift = Number.isFinite(candidate.live?.delay)
      ? candidate.live.delay
      : 0;
    state.rideShiftKnown = Number.isFinite(candidate.live?.delay);
    state.rideObservation = null;
    state.rideStartedAt = Date.now();
    state.foldbackPlan = null;
    lastNextAlertKey = null;
    haptic();
    toast(
      corrected
        ? ui("smartlive_corrected")
        : ui("ride_started", [serviceName(candidate.ride)]),
    );
  }
  persistJourney();
}
export function finishCurrentRide({ keepItinerary = false } = {}) {
  const changed =
      keepItinerary && itineraryDestinationChanged(state.itinerary, state.ride),
    recoveryPlan = changed ? state.itinerary : null,
    recoveryStop = state.ride?.userDestination?.id;
  if (changed) keepItinerary = false;
  if (keepItinerary && state.itinerary) {
    state.itinerary = advanceItinerary(state.itinerary);
    state.armedJourney =
      state.itinerary.phase === "transfer"
        ? {
            ride: state.itinerary.rides[state.itinerary.legIndex],
            selectedAt: Date.now(),
          }
        : null;
  } else {
    state.itinerary = null;
    state.armedJourney = null;
  }
  state.ride = null;
  state.foldbackPlan = null;
  state.rideShift = 0;
  state.rideShiftKnown = false;
  state.rideObservation = null;
  state.rideSource = null;
  state.rideConfidence = 0;
  resetRideDetection();
  persistJourney(true);
  const missed = keepItinerary && missedConnection(state.itinerary, tokyoNow());
  // Carry straight on to the next leg: say what to take next.
  if (!missed && state.itinerary?.phase === "transfer") {
    const next = state.itinerary.route.legs[state.itinerary.legIndex];
    haptic();
    toast(ui("transfer_next_toast", [serviceName(next), formatMinute(next.depart)]));
  }
  if (recoveryPlan || missed) {
    const plan = recoveryPlan ?? state.itinerary,
      stopId = recoveryStop ?? plan.route.legs[plan.legIndex].from;
    queueMicrotask(() =>
      document.dispatchEvent(
        new CustomEvent("mymap-itinerary-replan", {
          detail: { plan, stopId, atStop: true },
        }),
      ),
    );
  }
}
export function clearFalseRide() {
  state.ride = null;
  state.rideShift = 0;
  state.rideShiftKnown = false;
  state.rideObservation = null;
  state.heroObservation = null;
  state.foldbackPlan = null;
  state.rideSource = null;
  state.rideConfidence = 0;
  resetRideDetection();
  if (state.itinerary) {
    state.itinerary = { ...state.itinerary, phase: "armed" };
    const ride = state.itinerary.rides[state.itinerary.legIndex];
    if (ride) state.armedJourney = { ride, selectedAt: Date.now() };
  }
  persistJourney(true);
}

// Rider-initiated: list services departing from the nearest station or stop
// now, without requiring movement evidence. Nothing is confirmed here; the
// rider still opens and confirms one candidate explicitly.
export async function chooseRideCandidates() {
  if (!state.network || state.ride) return [];
  const near = nearest(),
    rail = near.rail && near.rail.meters <= 400 ? near.rail : null,
    bus = near.bus && near.bus.meters <= 250 ? near.bus : null,
    kyoto = near.kyotoBus && near.kyotoBus.meters <= 250 ? near.kyotoBus : null;
  const jobs = [];
  if (rail) {
    if (rail.id === "K15")
      jobs.push(detectKintetsu("K15"), detectSubway("K15"));
    else if (rail.stop.type === "kintetsu") jobs.push(detectKintetsu(rail.id));
    else jobs.push(detectSubway(rail.id));
  }
  if (bus?.stop.type === "citybus") jobs.push(detectCityBus(bus));
  if (kyoto) jobs.push(detectKyotoBus(kyoto.id));
  else if (bus?.stop.type === "kyotobus") jobs.push(detectKyotoBus(bus.id));
  const groups = await Promise.all(jobs.map((job) => job.catch(() => [])));
  const candidates = mergeCandidates(...groups).slice(0, 5);
  if (!state.ride) state.rideCandidates = candidates;
  return candidates;
}

export function confirmRideCandidate(index) {
  const candidate = state.rideCandidates[Number(index)];
  if (!candidate) return false;
  consensus.reset();
  applyRide({ ...candidate, manual: true });
  return true;
}
export function resetRideDetection() {
  detectionGeneration++;
  rideDetectionSession.reset();
  consensus.reset();
  state.rideCandidates = [];
  state.rideConsensusCount = 0;
  lastNextAlertKey = null;
}

// The rider checked in on a bus they picked from the routes at their stop.
// Bus boarding is hard to sense, so this is taken as a manual confirmation.
export function checkInRide(ride) {
  if (!ride || !Array.isArray(ride.officialStops) || ride.officialStops.length < 2)
    return false;
  resetRideDetection();
  applyRide({
    ride,
    manual: true,
    source: "チェックイン（乗車した系統を選択）",
    score: 90,
    live: null,
  });
  return true;
}

export function startManualRide(ride) {
  if (!boardingAvailable(ride, tokyoNow())) {
    toast(ui("ride_not_boardable"));
    return false;
  }
  resetRideDetection();
  const delay = selectedRideShift(ride);
  applyRide({
    ride,
    manual: true,
    source:
      delay === null
        ? "選択した公式時刻表の便"
        : "選択した公式便・便別実測の遅れを反映",
    score: 0,
    live: delay === null ? null : { delay },
  });
  return true;
}

// Poll quickly while something is happening: a recheck, candidates on screen,
// or the phone moving at vehicle speed. Otherwise stay at the idle cadence.
export function detectionInterval(now = Date.now()) {
  if (rideDetectionSession.snapshot(now).intensified) return 4000;
  if (state.rideCandidates?.length) return 4000;
  const motion = trajectory(state.samples ?? [], now),
    sensors = currentMotionEvidence(state.samples ?? [], now);
  if (
    (Number.isFinite(motion.speed) && motion.speed >= 2.8) ||
    (sensors.sensorSamples >= 6 && sensors.activeRatio >= 0.35 && sensors.rms >= 0.12)
  )
    return 4000;
  return 12000;
}
export async function autoDetectRide(force = false, onChange = () => {}) {
  if (
    !settings.autoDetect ||
    state.detectBusy ||
    !state.network ||
    !state.geo ||
    state.ride
  )
    return;
  if (
    !force &&
    Date.now() - state.lastDetectAt < detectionInterval()
  )
    return;
  const fixFresh = freshFix(state.fix),
    freshNear = nearest();
  if (fixFresh) consensus.observeStation(freshNear.rail, state.fix);
  // Underground: the last fix was at a subway station and GPS is gone. Keep
  // that station for up to 15 minutes (waiting on the platform included).
  const subwayContext = !fixFresh
      ? consensus.stationContext(Date.now(), 15 * 60000)
      : null,
    underground =
      subwayContext?.station?.stop?.type === "subway" ? subwayContext : null,
    stationContext = consensus.stationContext() ?? underground;
  const railMotion = underground
    ? currentRailMotion({ since: underground.at })
    : null;
  const announcement = state.smartLiveAnnouncement;
  const audioStop =
    announcement && Date.now() - announcement.at <= 75000
      ? state.network.stops.get(announcement.parsed.nextStop)
      : null;
  const near = fixFresh
    ? freshNear
    : { ...freshNear, rail: stationContext?.station ?? null };
  if (
    !fixFresh &&
    !stationContext &&
    audioStop &&
    ["subway", "kintetsu"].includes(audioStop.type)
  )
    near.rail = { id: audioStop.id, stop: audioStop, meters: 0 };
  if (
    !fixFresh &&
    !stationContext &&
    !audioStop &&
    !state.rideCandidates.length &&
    !state.armedJourney?.ride
  )
    return;
  if (!fixFresh && audioStop?.type?.includes("bus")) {
    const audioNear = { id: audioStop.id, stop: audioStop, meters: 0 };
    near.bus = audioNear;
    if (audioStop.type === "kyotobus") near.kyotoBus = audioNear;
  }
  const motion = trajectory(state.samples),
    motionEvidence = currentMotionEvidence(state.samples),
    railMovement =
      (motion.span >= 12 && motion.speed >= 2.8) ||
      (motionEvidence.sensorSamples >= 6 &&
        motionEvidence.activeRatio >= 0.35 &&
        motionEvidence.rms >= 0.12);
  if (fixFresh) updateBusTrail(near.bus?.id, near.bus?.meters ?? Infinity);
  state.detectBusy = true;
  const generation = detectionGeneration;
  state.lastDetectAt = Date.now();
  onChange();
  try {
    let candidates = [];
    const stationClose =
        near.rail &&
        near.rail.meters <=
          Math.min(140, Math.max(90, (state.fix?.accuracy ?? 100) * 1.5)),
      railClose =
        near.rail &&
        (stationClose ||
          (fixFresh && onRailCorridor(state.fix, near.rail.stop.type))),
      railProbeAllowed =
        railMovement ||
        Boolean(underground && railMotion?.available && !railMotion.walking) ||
        Boolean(state.armedJourney?.ride) ||
        Boolean(audioStop && ["subway", "kintetsu"].includes(audioStop.type)),
      recentBusTrail = state.busTrail.some((x) => Date.now() - x.at < 180000),
      busClose =
        near.bus &&
        (near.bus.meters <= Math.max(150, (state.fix?.accuracy ?? 100) * 2.1) ||
          (recentBusTrail && near.bus.meters <= 700)),
      kyotoClose =
        near.kyotoBus &&
        near.kyotoBus.meters <=
          Math.max(180, (state.fix?.accuracy ?? 100) * 2.3);
    // Bus probes start alongside the rail probe; their result is used only
    // when the rail probe finds nothing (or while rechecking), as before.
    const busWanted = busClose || kyotoClose,
      busProbe = busWanted
        ? Promise.all([
            busClose && near.bus.stop.type === "citybus"
              ? detectCityBus(near.bus).catch(() => [])
              : [],
            kyotoClose
              ? detectKyotoBus(near.kyotoBus.id).catch(() => [])
              : near.bus?.stop.type === "kyotobus" && busClose
                ? detectKyotoBus(near.bus.id).catch(() => [])
                : [],
          ])
        : Promise.resolve([[], []]);
    if (railClose && railProbeAllowed) {
      if (near.rail.id === "K15") {
        const [k, s] = await Promise.all([
          detectKintetsu("K15").catch(() => []),
          detectSubway("K15").catch(() => []),
        ]);
        candidates = mergeCandidates(k, s);
      } else if (
        near.rail.stop.type === "kintetsu" &&
        ["B06", "B07", "B08"].includes(near.rail.id)
      ) {
        // A through service may enter the subway from Kintetsu. Probe
        // both feeds near Takeda without treating a nearby train as proof.
        const [nearbyKintetsu, enteringSubway] = await Promise.all([
          detectKintetsu(near.rail.id).catch(() => []),
          detectSubway(near.rail.id, { throughOnly: true }).catch(() => []),
        ]);
        candidates = mergeCandidates(nearbyKintetsu, enteringSubway);
      } else
        candidates =
          near.rail.stop.type === "kintetsu"
            ? await detectKintetsu(near.rail.id).catch(() => [])
            : await detectSubway(
                near.rail.id,
                underground
                  ? {
                      // Trains that left since the rider was last seen here.
                      windowBefore: Math.min(
                        16,
                        Math.ceil((Date.now() - underground.at) / 60000) + 1,
                      ),
                      stationsTravelled: railMotion?.available
                        ? railMotion.completedRuns
                        : null,
                    }
                  : {},
              ).catch(() => []);
    }
    if (!fixFresh && !stationContext && audioStop?.type === "subway") {
      const feed = await ensureSubwayFeed();
      const preceding = [
        ...new Set(
          (feed?.services ?? []).flatMap((service) => {
            const i = service.stops.indexOf(audioStop.id);
            return i > 0 ? [service.stops[i - 1]] : [];
          }),
        ),
      ].slice(0, 4);
      const audioCandidates = await Promise.all(
        preceding.map((id) => detectSubway(id).catch(() => [])),
      );
      candidates = mergeCandidates(candidates, ...audioCandidates);
    }
    if (
      (!candidates.length ||
        rideDetectionSession.snapshot().phase === "rechecking") &&
      busWanted
    ) {
      const [city, kyoto] = await busProbe;
      candidates = mergeCandidates(candidates, city, kyoto);
    }
    if (generation !== detectionGeneration || state.ride) return;
    if (!fixFresh && !candidates.length) candidates = state.rideCandidates;
    const session = rideDetectionSession.snapshot();
    if (session.phase === "rechecking" && session.shell) {
      candidates = mergeCandidates(candidates, [
        { ride: session.shell, score: 55, source: ui("smartlive_rechecking") },
      ]);
    }
    if (
      !candidates.length &&
      state.armedJourney?.ride &&
      boardingAvailable(state.armedJourney.ride, tokyoNow())
    )
      candidates = [
        {
          ride: state.armedJourney.ride,
          score: 55,
          armedMatch: true,
          source: ui("smartlive_confirming"),
        },
      ];
    candidates = matchArmedJourney(
      candidates,
      state.armedJourney,
      tokyoNow().minute,
    );
    const observedAt = Date.now();
    candidates = applyRideMotionEvidence(
      candidates,
      currentMotionEvidence(state.samples, observedAt),
      { samples: state.samples, now: observedAt },
    );
    const eligible =
      state.armedJourney && session.phase !== "rechecking"
        ? candidates.filter((candidate) => candidate.armedMatch)
        : candidates;
    for (const candidate of eligible) {
      const ride = candidate.ride,
        candidateKey = transitCandidateKey(ride);
      const add = (type, confidence, observedAt, metadata = {}) =>
        consensus.ingest({
          type,
          candidate: candidateKey,
          direction: ride.directionId ?? ride.direction,
          confidence,
          observedAt,
          metadata,
        });
      if (Number.isFinite(ride.depart)) add("timetable", 0.65, observedAt);
      else if (ride.servicePatternId) add("pattern", 0.6, observedAt);
      if (candidate.armedMatch)
        add("journey", 0.75, state.armedJourney.selectedAt);
      const routePattern = state.network.services.find(
        (service) => service.id === ride.serviceId,
      );
      const ordered = orderedStopEvidence(
        routePattern?.stops ?? ride.officialStops ?? [],
        state.busTrail,
        { circular: routePattern?.stops?.[0] === routePattern?.stops?.at(-1) },
      );
      const movement = assessBoardingMovement(
        state.samples,
        candidate.evidence ?? [],
        observedAt,
      );
      const direction =
        (ordered.matched && movement.moving) || movement.routeTrajectory;
      candidate.directionRejected = Boolean(
        ordered.rejected || movement.reversed ||
        candidate.evidence?.some((e) => /進行方向が逆|方位が逆/.test(e.reason)),
      );
      if (fixFresh && (candidate.score >= 55 || ordered.matched))
        add("gps", 0.65, state.fix.timestamp, {
          directionVerified: direction,
          routeTrajectory: movement.routeTrajectory,
          vehicleMoving: movement.moving,
          orderedStops: ordered.matched ? ordered.steps.length : 0,
          walkingLikely:
            motion.span >= 15 && motion.speed >= 0.6 && motion.speed < 2.5,
          rejected: candidate.directionRejected,
        });
      const motionEvidence = currentMotionEvidence(state.samples, observedAt),
        undergroundRiding =
          Boolean(underground && railMotion?.riding) &&
          ["subway", "through"].includes(ride.operator);
      if (
        (motionEvidence.sensorSamples >= 6 &&
          motionEvidence.activeRatio >= 0.35 &&
          motionEvidence.rms >= 0.12) ||
        undergroundRiding
      )
        add("motion", undergroundRiding ? 0.6 : 0.55, motionEvidence.sensorObservedAt ?? railMotion?.observedAt ?? observedAt, {
          phase: motionEvidence.phase,
          pattern: motionEvidence.pattern,
          acceleration: motionEvidence.acceleration,
          // Underground, the accelerometer's train pattern stands in for GPS.
          vehicleMoving:
            (movement.moving && motionEvidence.speed >= 2.8) || undergroundRiding,
          underground: Boolean(underground),
          stationsTravelled: railMotion?.completedRuns ?? null,
        });
      const live = candidate.live,
        liveAt =
          candidate.liveObservedAt ??
          Date.parse(
            live?.sourceUpdatedAt ?? live?.capturedAt ?? live?.asOf ?? "",
          );
      // A stop-level arrival without a trip or direction is not vehicle identity.
      if (
        Number.isFinite(liveAt) &&
        liveAt <= observedAt + 5000 &&
        observedAt - liveAt <= 90000 &&
        live &&
        (candidate.liveDirectionVerified ||
          candidate.livePresence ||
          (live.tripId === ride.tripId && Boolean(ride.tripId)) ||
          (live.direction && live.direction === ride.direction))
      )
        add("realtime", 0.8, liveAt, {
          directionVerified: Boolean(
            candidate.liveDirectionVerified ||
              (live.tripId && live.tripId === ride.tripId) ||
              (live.direction && live.direction === ride.direction),
          ),
        });
    }
    const decision = consensus.evaluate(eligible, observedAt);
    if (
      decision.confirmed &&
      !rideDetectionSession.canConfirm(
        decision.confirmed,
        decision.sources,
        decision.candidates[0]?.score ?? 0,
        observedAt,
      )
    )
      decision.confirmed = null;
    state.rideConsensusCount = decision.count;
    state.rideCandidates = decision.confirmed
      ? []
      : decision.candidates.length
        ? decision.candidates
        : candidates;
    rideDetectionSession.candidates(state.rideCandidates, observedAt);
    if (decision.confirmed) {
      const selected =
        candidates.find(
          (c) =>
            transitCandidateKey(c.ride) ===
            transitCandidateKey(decision.confirmed),
        ) ?? candidates[0];
      if (selected) applyRide(selected);
    }
  } finally {
    state.detectBusy = false;
    onChange();
  }
}

// While riding a Kyoto Bus trip, refresh the official prediction for it.
// Once the bus has left the boarding stop the navigation may no longer list
// it; the last official delay is then kept (and labelled with its time).
let kyotoPredictionAt = 0;
function refreshKyotoBusPrediction(ride) {
  if (ride?.operator !== "kyotobus" || Date.now() - kyotoPredictionAt < 20000)
    return;
  kyotoPredictionAt = Date.now();
  void kyotoBusNav(ride.from, ride.to).then((nav) => {
    const trip = kyotoBusNavTrip(nav, ride);
    if (!trip || !Number.isFinite(trip.delay) || rideKey(state.ride) !== rideKey(ride))
      return;
    state.kyotoBusPrediction = {
      key: rideKey(ride),
      trip,
      at: Date.parse(trip.asOf) || Date.now(),
    };
    document.dispatchEvent(new CustomEvent("mymap-ride-prediction"));
  });
}
export function kyotoBusPredictionFor(ride, now = Date.now()) {
  const value = state.kyotoBusPrediction;
  return value && value.key === rideKey(ride) && now - value.at <= 20 * 60000
    ? value
    : null;
}

// Through trains between Kintetsu and the Karasuma line. The static feeds
// split them at Takeda; the official Kintetsu train page gives the exact
// Takeda departure of a northbound one.
let throughTripJob = null;
function prefetchThroughEvidence(ride) {
  const date = tokyoNow().date;
  if (!state.kintetsuStaticFeed || state.kintetsuStaticDate !== date) {
    state.kintetsuStaticDate = date;
    void getStaticFeed("kintetsu", date)
      .then((feed) => {
        state.kintetsuStaticFeed = feed;
      })
      .catch(() => {
        state.kintetsuStaticDate = null;
      });
  }
  if (
    throughDirection(ride) === "north" &&
    ride.tripId &&
    !String(ride.tripId).includes(":") &&
    state.throughTakeda?.tripId !== ride.tripId &&
    throughTripJob !== ride.tripId
  ) {
    throughTripJob = ride.tripId;
    void boundedLive(
      `kintetsu-trip:${ride.tripId}:${date}`,
      () =>
        official("/timetable/trip", {
          stop: ride.from,
          direction: "north",
          day: "auto",
          trip: ride.tripId,
        }),
      { wait: 0, maxAge: 6 * 3600000, retryAfter: 60000 },
    ).then((trip) => {
      const takeda = trip?.stops?.find((s) => /竹田/.test(s.name ?? ""));
      if (Number.isFinite(takeda?.departure))
        state.throughTakeda = { tripId: ride.tripId, departure: takeda.departure };
      throughTripJob = null;
    });
  }
}
function heardDestinations() {
  const a = state.smartLiveAnnouncement;
  return a && Date.now() - a.at <= 120000 ? (a.parsed.destinationIds ?? [a.parsed.destination].filter(Boolean)) : [];
}
// Rider's answer to "does this train continue onto the other line?".
export function confirmThroughContinuation(index) {
  const prompt = state.throughPrompt,
    ride = state.ride;
  if (!prompt || !ride || prompt.key !== rideKey(ride)) return false;
  if (index < 0) {
    state.throughPrompt = { ...prompt, dismissed: true };
    return true;
  }
  const continuation = prompt.rows[index];
  const joined = continuation && applyThroughContinuation(ride, continuation, state.network, "rider");
  if (!joined) return false;
  adoptThroughRide(joined);
  return true;
}
function adoptThroughRide(extended) {
  // Same train, same Ride: do not trigger boarding, erase the itinerary,
  // or infer the next station as the rider's alighting stop.
  state.ride = extended;
  state.throughPrompt = null;
  state.rideObservation = null;
  state.heroObservation = null;
  state.audioProgress = null;
  consensus.unlock();
  consensus.lock(extended);
  persistJourney(true);
}
function throughFromFeeds(ride, minute) {
  const direction = throughDirection(ride);
  if (!direction) return null;
  prefetchThroughEvidence(ride);
  const feeds = { subwayFeed: state.subwayFeed, kintetsuFeed: state.kintetsuStaticFeed, network: state.network };
  const joined = joinThroughFromFeeds(ride, {
    ...feeds,
    takedaDeparture:
      ride.tripId && state.throughTakeda?.tripId === ride.tripId
        ? state.throughTakeda.departure
        : null,
    heardDestinations: heardDestinations(),
  });
  if (joined) return joined;
  // Otherwise ask near Takeda, offering the trains that leave there.
  const stops = ride.officialStops ?? [],
    end = stops.at(-1),
    endTime = stopTime(end),
    key = rideKey(ride);
  if (
    Number.isFinite(endTime) &&
    endTime - minute <= 6 &&
    endTime - minute >= -2 &&
    !(state.throughPrompt?.key === key && state.throughPrompt.dismissed)
  ) {
    const rows = throughContinuations(ride, feeds).slice(0, 2);
    state.throughPrompt = rows.length ? { key, direction, rows } : null;
  }
  return null;
}

// Underground there is no GPS: when the accelerometer shows the train
// standing at a station after k station-to-station runs since it left the
// boarding station, that station is officialStops[k] and the schedule
// difference is the train's delay. Recent announcements take precedence.
function anchorUndergroundFromMotion(ride, now) {
  if (
    !["subway", "through"].includes(ride.operator) ||
    freshFix(state.fix) ||
    (state.audioProgress && Date.now() - state.audioProgress.at <= 75000)
  )
    return;
  const stops = ride.officialStops ?? [],
    departed = stopTime(stops[0]);
  if (!Number.isFinite(departed) || departed > now.minute) return;
  const since = Date.now() - (now.minute - departed + 1) * 60000,
    motion = currentRailMotion({ since });
  if (!motion.available || !motion.stoppedNow || motion.completedRuns < 1) return;
  const station = stops[motion.completedRuns],
    scheduled = stopTime(station);
  if (!station || !Number.isFinite(scheduled)) return;
  const shift = Math.round(now.minute - scheduled);
  if (shift < -2 || shift > 15) return;
  state.rideShift = shift;
  state.rideShiftKnown = true;
  state.undergroundAnchor = { stopId: station.id, at: Date.now(), runs: motion.completedRuns };
}

export function updateRideAnchor() {
  let ride = state.ride;
  if (!ride) return;
  const now = journeyClock(ride, tokyoNow());
  const extended =
    findThroughContinuation(
      ride,
      [state.subwayFeed, state.network],
      { minute: now.minute, network: state.network },
    ) ?? throughFromFeeds(ride, now.minute);
  if (extended) {
    ride = extended;
    adoptThroughRide(extended);
  }
  anchorUndergroundFromMotion(ride, now);
  const observation = observeJourney(state.rideObservation, ride, {
      minute: now.minute,
      shift: state.rideShift,
      fix: state.fix,
      geo: state.geo,
      trail: state.busTrail,
      speed: speed(),
    });
  const audio = state.audioProgress;
  if (
    audio &&
    Date.now() - audio.at <= 75000 &&
    audio.candidate === transitCandidateKey(ride) &&
    !freshFix(state.fix)
  ) {
    observation.progress = {
      ...observation.progress,
      stops: ride.officialStops,
      currentIndex: audio.currentIndex,
      nextIndex: audio.nextIndex,
      next: ride.officialStops[audio.nextIndex],
      previous: ride.officialStops[audio.currentIndex],
      source: "audio",
      fraction: audio.currentIndex / Math.max(1, ride.officialStops.length - 1),
      remaining: ride.officialStops.length - audio.nextIndex,
    };
  }
  state.rideObservation = observation;
  const motion = currentMotionEvidence(state.samples);
  const support = consensus.support(ride);
  if (!state.rideManuallyConfirmed)
    state.rideConfidence = Math.round(
      (state.rideConfidenceBase ?? state.rideConfidence) * support.confidence,
    );
  rideDetectionSession.expected(ride, observation, now.minute, state.rideShift);
  rideDetectionSession.observeProgress(
    observation,
    motion,
    Date.now(),
    ride.userDestination?.id ?? ride.to,
  );
  rideDetectionSession.motion(motion);
  state.rideShift = observation.shift;
  if (Number.isInteger(observation.anchorIndex)) state.rideShiftKnown = true;
  refreshKyotoBusPrediction(ride);
  const official = kyotoBusPredictionFor(ride);
  if (official && !Number.isInteger(observation.anchorIndex)) {
    state.rideShift = official.trip.delay;
    state.rideShiftKnown = true;
  }
  const next = observation.progress?.next,
    busMode = ["citybus", "kyotobus"].includes(ride.operator),
    nextGeo = next && state.geo?.stops.find((s) => s.id === next.id),
    alertKey = next ? `${rideKey(ride)}|${next.id}` : null;
  if (
    busMode &&
    freshFix(state.fix) &&
    nextGeo &&
    alertKey !== lastNextAlertKey &&
    distance(state.fix, nextGeo) <= 220
  ) {
    lastNextAlertKey = alertKey;
    haptic();
    toast(ui("ride_next_stop", [next.name ?? ui("now_model_013")]));
  }
  const transfer =
    state.foldbackPlan && state.foldbackPlan.depart >= now.minute - 5;
  if (observation.arrived && !transfer) {
    finishCurrentRide({ keepItinerary: Boolean(state.itinerary) });
    if (state.itinerary?.phase !== "transfer") toast(ui("ride_arrival_confirmed"));
  }
  persistJourney();
}
