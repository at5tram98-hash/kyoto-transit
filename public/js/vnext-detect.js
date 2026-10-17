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
import { currentMotionEvidence } from "./motion-assist.js";
import { getBusChoices, getBusData, getKyotoBusRT } from "./live.js";
import { officialTripLeg } from "./vehicle.js";
import {
  subwayRideCandidates,
  cityBusRideCandidates,
  routeIntersection,
} from "./vnext-core.js";
import { journeyClock } from "./journey-core.js";
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
  if (state.kyotoBusFeed && Date.now() - state.kyotoBusFeedAt < 12000)
    return state.kyotoBusFeed;
  try {
    state.kyotoBusFeed = await getKyotoBusRT(AbortSignal.timeout(4000));
    state.kyotoBusFeedAt = Date.now();
    return state.kyotoBusFeed;
  } catch (e) {
    if (e?.code !== "odpt_not_configured") console.warn("kyotobus rt", e);
    return state.kyotoBusFeed;
  }
}

async function detectKyotoBus(stopId) {
  const now = tokyoNow(),
    data = await official("/rider/candidates", {
      stop: stopId,
      date: now.date,
      minute: now.minute,
    }),
    legs = data.trips
      .map((t) => officialTripLeg(t, state.network))
      .filter(Boolean)
      .filter((l) => now.minute >= l.depart - 8 && now.minute <= l.arrive + 5);
  if (!legs.length) return [];
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
  return legs
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
      return asCandidate(
        ride,
        score,
        live
          ? "京都バス車両位置＋公式時刻表＋現在地"
          : "京都バス公式時刻表＋現在地",
        {
          live,
          liveObservedAt: live ? Number(live.timestamp) * 1000 : null,
          livePresence: measured?.score >= 55 && measured?.meters <= 140,
          evidence: [...(base?.evidence ?? []), ...(measured?.evidence ?? [])],
        },
      );
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        Math.abs(a.ride.depart - now.minute) -
          Math.abs(b.ride.depart - now.minute),
    )
    .slice(0, 3);
}

async function detectSubway(stopId) {
  const now = tokyoNow(),
    feed = await ensureSubwayFeed();
  if (!feed?.services?.length) return [];
  const directionHint = inferRailDirection(stopId, "subway"),
    legs = subwayRideCandidates(feed, {
      fromId: stopId,
      direction: directionHint,
      minute: now.minute,
      network: state.network,
      windowBefore: 4,
      windowAfter: 1,
    });
  if (!legs.length) return [];
  const ranked = rankRides(legs, {
    network: state.network,
    geo: state.geo,
    samples: state.samples,
    minute: now.minute,
    railFeed: null,
    busFeed: null,
  });
  return ranked
    .map((r) =>
      asCandidate(r.leg, r.score + 35, "地下鉄公式全駅時刻表＋現在地", {
        evidence: r.evidence,
      }),
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

async function detectCityBus(stopInfo) {
  const now = tokyoNow(),
    trail = state.busTrail.map((x) => x.id),
    routes = routeIntersection(
      trail.length >= 2 ? trail : [stopInfo.id],
      state.network,
    );
  if (!routes.length) return [];
  const stop = state.network.stops.get(stopInfo.id),
    choices = (
      await getBusChoices(stop.fullName ?? stop.name, AbortSignal.timeout(4000))
    ).choices,
    routeChoices = choices
      .filter((c) => routes.includes(String(c.route)))
      .slice(0, 4);
  let bestLive = null;
  for (const choice of routeChoices.slice(0, 3)) {
    try {
      const live = await getBusData(
        stop.fullName ?? stop.name,
        choice,
        AbortSignal.timeout(4000),
      );
      if (
        (live.buses ?? []).some(
          (b) => Number.isFinite(b.stopsAway) && b.stopsAway <= 1,
        )
      ) {
        bestLive = live;
        break;
      }
    } catch {}
    await sleep(40);
  }
  if (bestLive) {
    state.busLive = bestLive;
    state.busLiveAt = Date.now();
  }
  const rows = [];
  for (const route of routes.slice(0, 3)) {
    const live =
      bestLive && String(bestLive.route) === String(route) ? bestLive : null;
    for (const ride of cityBusRideCandidates({
      route,
      currentStopId: stopInfo.id,
      trail,
      network: state.network,
      minute: now.minute,
    })) {
      const score = (live ? 68 : 55) + (ride.orderedTrail ? 15 : 0);
      rows.push(
        asCandidate(
          ride,
          score,
          live ? "市バス接近情報＋停留所の通過順" : "路線の停留所列＋現在地",
          { live },
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
    Date.now() - state.lastDetectAt <
      (rideDetectionSession.snapshot().intensified ? 4000 : 12000)
  )
    return;
  const fixFresh = freshFix(state.fix),
    freshNear = nearest();
  if (fixFresh) consensus.observeStation(freshNear.rail, state.fix);
  const stationContext = consensus.stationContext();
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
    if (railClose && railProbeAllowed) {
      if (near.rail.id === "K15") {
        const [k, s] = await Promise.all([
          detectKintetsu("K15").catch(() => []),
          detectSubway("K15").catch(() => []),
        ]);
        candidates = mergeCandidates(k, s);
      } else
        candidates =
          near.rail.stop.type === "kintetsu"
            ? await detectKintetsu(near.rail.id).catch(() => [])
            : await detectSubway(near.rail.id).catch(() => []);
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
      (busClose || kyotoClose)
    ) {
      const cityPromise =
          busClose && near.bus.stop.type === "citybus"
            ? detectCityBus(near.bus).catch(() => [])
            : Promise.resolve([]),
        kyotoPromise = kyotoClose
          ? detectKyotoBus(near.kyotoBus.id).catch(() => [])
          : near.bus?.stop.type === "kyotobus" && busClose
            ? detectKyotoBus(near.bus.id).catch(() => [])
            : Promise.resolve([]);
      const [city, kyoto] = await Promise.all([cityPromise, kyotoPromise]);
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
      const direction =
        ordered.matched ||
        candidate.evidence?.some((e) =>
          /次の停車地点へ進行|方位が路線方向と一致/.test(e.reason),
        );
      candidate.directionRejected =
        ordered.rejected ||
        candidate.evidence?.some((e) => /進行方向が逆|方位が逆/.test(e.reason));
      if (fixFresh && (candidate.score >= 55 || ordered.matched))
        add("gps", 0.65, state.fix.timestamp, {
          directionVerified: direction,
          orderedStops: ordered.matched ? ordered.steps.length : 0,
          walkingLikely:
            motion.span >= 15 && motion.speed >= 0.6 && motion.speed < 2.5,
          rejected: candidate.directionRejected,
        });
      const motionEvidence = currentMotionEvidence(state.samples, observedAt);
      if (
        motionEvidence.sensorSamples >= 6 &&
        motionEvidence.activeRatio >= 0.35 &&
        motionEvidence.rms >= 0.12
      )
        add("motion", 0.55, motionEvidence.sensorObservedAt, {
          phase: motionEvidence.phase,
          pattern: motionEvidence.pattern,
          acceleration: motionEvidence.acceleration,
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

export function updateRideAnchor() {
  const ride = state.ride;
  if (!ride) return;
  const now = journeyClock(ride, tokyoNow()),
    observation = observeJourney(state.rideObservation, ride, {
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
    toast(ui("ride_arrival_confirmed"));
  }
  persistJourney();
}
