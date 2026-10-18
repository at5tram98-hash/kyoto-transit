import { ui } from "./locale.js";
import { stabilizeRailObservation } from "./rail-location-continuity.js";
import { selectedAlightingStop } from "./ride-destination.js";
import { stationEnglish } from "./station-names.js";
import { stopTime } from "./journey-core.js";
import { freshFix } from "./riding.js";
import { distance } from "./mobility.js";

export const TRAIN_STATES = Object.freeze({
  DEPARTED: "DEPARTED",
  APPROACHING: "APPROACHING",
  STOPPED: "STOPPED",
  LINE_BOUNDARY: "LINE_BOUNDARY",
});

export function stationModel(stop) {
  return stop
    ? {
        ...stop,
        code: stop.id ?? "",
        en: stop.en ?? stationEnglish[stop.id] ?? "",
      }
    : null;
}
export function nearbyDirection(fix, point) {
  if (!fix || !point) return "";
  const angle =
    ((Math.atan2(
      (point.lng - fix.lng) * Math.cos((fix.lat * Math.PI) / 180),
      point.lat - fix.lat,
    ) *
      180) /
      Math.PI +
      360) %
    360;
  return [
    ui("now_model_001"),
    ui("now_model_002"),
    ui("now_model_003"),
    ui("now_model_004"),
    ui("now_model_005"),
    ui("now_model_006"),
    ui("now_model_007"),
    ui("now_model_008"),
  ][Math.round(angle / 45) % 8];
}
const lineOf = (stop) => (stop?.id?.startsWith("K") ? "K" : "B");

// A small reducer owns arrival retention and forward progress. A noisy fix
// cannot undo an arrival or advance several stations in one render.
export function reduceTrainState(previous, observation, at) {
  if (!previous || previous.key !== observation.key)
    return { ...observation, since: at };
  if (observation.index < previous.index) return previous;
  if (
    previous.state === TRAIN_STATES.STOPPED &&
    observation.state !== TRAIN_STATES.STOPPED &&
    observation.positionSource !== "schedule" &&
    at - previous.since < 4000
  )
    return previous;
  return {
    ...observation,
    since:
      previous.state === observation.state &&
      previous.index === observation.index
        ? previous.since
        : at,
  };
}

// Adapter for existing official journeys; data acquisition stays unchanged.
export function heroModel(
  ride,
  progress,
  {
    minute,
    shift = 0,
    shiftKnown = false,
    fix,
    geo,
    locationStatus,
    feed,
    previous,
    motionSpeed,
    at = Date.now(),
  } = {},
) {
  const stops = progress.stops,
    bus = ["citybus", "kyotobus"].includes(ride.operator);
  const routeUnavailable = Boolean(
    ride.routeVariant &&
    (ride.routeVariant.suspended || ride.routeVariant.verified !== true),
  );
  const validFix =
    !routeUnavailable && locationStatus === "active" && freshFix(fix, at);
  const scheduleIndex = stops.findIndex(
    (s) =>
      Number.isFinite(stopTime(s)) &&
      minute >= stopTime(s) + shift &&
      minute < (s.departure ?? stopTime(s)) + shift + 0.35,
  );
  const currentIndex =
    progress.currentIndex >= 0 ? progress.currentIndex : scheduleIndex;
  const current = stops[currentIndex],
    point = geo?.stops?.find((s) => s.id === current?.id);
  const scheduled = stopTime(current),
    hasStopTime = Number.isFinite(scheduled);
  const measuredSpeed = Number.isFinite(fix?.speed) ? fix.speed : motionSpeed;
  const speedUnknown = !Number.isFinite(measuredSpeed);
  const stationary =
    validFix &&
    !speedUnknown &&
    measuredSpeed < 1.2 &&
    point &&
    distance(fix, point) <= Math.max(35, Math.min(75, fix.accuracy ?? 35));
  const departure = current?.departure ?? scheduled;
  const stopped =
    current &&
    ((stationary &&
      (!hasStopTime || Math.abs(scheduled + shift - minute) <= 4)) ||
      (bus &&
        !validFix &&
        hasStopTime &&
        minute >= scheduled + shift &&
        minute < departure + shift + 0.35));
  let trainState = stopped
    ? TRAIN_STATES.STOPPED
    : (bus || validFix) &&
      Number.isFinite(progress.arrival) &&
        progress.arrival - minute <= 1.2 &&
        progress.arrival - minute >= -0.5
      ? TRAIN_STATES.APPROACHING
      : TRAIN_STATES.DEPARTED;
  const approachingCurrent =
    validFix &&
    current &&
    !stopped &&
    currentIndex > 0 &&
    hasStopTime &&
    Math.abs(scheduled + shift - minute) <= 1.2 &&
    (previous?.index ?? currentIndex) <= currentIndex &&
    previous?.state !== TRAIN_STATES.STOPPED;
  if (approachingCurrent) trainState = TRAIN_STATES.APPROACHING;
  const observation = {
    key: JSON.stringify([
      ride.operator,
      ride.from,
      ride.route,
      ride.to,
      ride.tripId,
      ride.depart,
      ride.serviceId,
    ]),
    state: trainState,
    index: stopped || approachingCurrent ? currentIndex : progress.nextIndex,
  };
  const safeObservation = bus
    ? observation
    : stabilizeRailObservation(previous, observation, {
        at,
        hasFreshFix: validFix,
        fixTimestamp: validFix ? fix.timestamp : null,
      });
  const observed = reduceTrainState(previous, safeObservation, at);
  trainState = observed.state;
  const displayIndex = observed.index,
    display = stops[displayIndex] ?? progress.next;
  const boundaryIndex = stops.findIndex((s) => s.id === "K15"),
    before = stops[boundaryIndex - 1],
    after = stops[boundaryIndex + 1];
  const through =
    !bus &&
    boundaryIndex >= 0 &&
    before &&
    after &&
    lineOf(before) !== lineOf(after);
  const approachingBoundary = through && displayIndex === boundaryIndex;
  const boundary = approachingBoundary
    ? {
        codes: lineOf(before) === "B" ? ["B05", "K15"] : ["K15", "B05"],
        phase: trainState === TRAIN_STATES.STOPPED ? "stopped" : "approaching",
        nextLine: lineOf(after),
      }
    : null;
  const lineId = bus
    ? "bus"
    : boundary
      ? lineOf(before)
      : through && displayIndex > boundaryIndex
        ? lineOf(after)
        : ride.operator === "kintetsu"
          ? "B"
          : lineOf(display);
  const userDestination = stationModel(selectedAlightingStop(ride, stops));
  const destinationIndex = stops.findIndex((s) => s.id === userDestination?.id);
  const remainingStops = Math.max(0, destinationIndex - displayIndex);
  const stale =
    ride.dataConfidence === "stale" ||
    feed?.stale ||
    feed?.meta?.stale ||
    (feed?.asOf && at - Date.parse(feed.asOf) > 240000);
  const unavailable = routeUnavailable || !Number.isFinite(stopTime(display));
  const confidence = unavailable
    ? "unavailable"
    : stale
      ? "stale"
      : stationary && trainState === TRAIN_STATES.STOPPED && !display?.estimated
        ? "confirmed"
        : "estimated";
  const heldLocation =
    observed.positionSource === "gps_dropout_hold" ||
    observed.positionSource === "recovering";
  const arrivalEstimate =
    !routeUnavailable && !heldLocation && Number.isFinite(stopTime(display))
      ? stopTime(display) + (stale ? 0 : shift)
      : null;
  const destinationArrival =
    !routeUnavailable && Number.isFinite(stopTime(userDestination))
      ? stopTime(userDestination) + (stale ? 0 : shift)
      : null;
  const nextStation = routeUnavailable ? null : stationModel(display),
    nextNext = stationModel(stops[displayIndex + 1]);
  if (nextStation?.id === "K15" && lineId === "B" && !boundary)
    nextStation.code = "B05";
  if (userDestination?.id === "K15" && ride.operator === "kintetsu")
    userDestination.code = "B05";
  const nextIsDestination = Boolean(
    nextStation && userDestination && nextStation.id === userDestination.id,
  );
  const label = routeUnavailable
    ? ui("now_model_009")
    : trainState === TRAIN_STATES.STOPPED
      ? ui("now_model_010")
      : nextIsDestination && (bus || (validFix && !heldLocation))
        ? ui("now_model_011")
        : trainState === TRAIN_STATES.APPROACHING
          ? ui("now_model_012")
          : bus
            ? ui("now_model_013")
            : ui("now_model_014");
  const minutes = Number.isFinite(arrivalEstimate)
    ? Math.max(0, Math.ceil(arrivalEstimate - minute))
    : null;
  return {
    lineId,
    lineColor: lineId === "K" ? "green" : lineId === "B" ? "orange" : "blue",
    serviceType:
      ride.category === "express"
        ? ui("now_model_015")
        : ride.category === "local"
          ? ui("now_model_016")
          : bus
            ? ui("now_model_017")
            : ui("now_model_018"),
    destination: ride.destination,
    nextStation,
    nextNext,
    userDestination,
    remainingStops,
    trainState: boundary ? TRAIN_STATES.LINE_BOUNDARY : trainState,
    phase: trainState,
    boundary,
    through,
    throughNotice:
      through &&
      !boundary &&
      displayIndex >= boundaryIndex - 2 &&
      displayIndex < boundaryIndex
        ? ui("now_model_029", [
            lineOf(after) === "B" ? ui("now_model_019") : ui("now_model_020"),
          ])
        : "",
    confidence,
    dataSources: [
      ui("now_model_021"),
      ui("now_model_022"),
      ...(validFix ? [ui("now_model_023")] : []),
      ...(feed && !stale && !routeUnavailable ? [ui("now_model_024")] : []),
    ],
    delayMinutes: shiftKnown && !stale ? Math.round(shift) : null,
    arrivalEstimate,
    destinationArrival,
    minutes,
    label,
    nextIsDestination,
    locationConfidence: validFix && !heldLocation ? "available" : "unavailable",
    estimatedWithoutGps: !bus && (!validFix || heldLocation),
    locationRecovering: !bus && observed.positionSource === "recovering",
    routeUnavailable,
    lastUpdated: stale
      ? (feed?.asOf ??
        feed?.capturedAt ??
        ride.sourceUpdatedAt ??
        feed?.lastUpdated)
      : null,
    observed,
    index: displayIndex,
    bus,
  };
}

export function delayAnalysis(model, observations = []) {
  const known = Number.isFinite(model.delayMinutes),
    recent = observations.filter((x) => Number.isFinite(x.shift)).slice(-8);
  const trend =
    recent.length >= 2 ? recent.at(-1).shift - recent[0].shift : null;
  const conclusion = !known
    ? ui("now_model_025")
    : model.delayMinutes <= 0
      ? ui("now_model_026")
      : trend < -0.5
        ? ui("now_model_027")
        : ui("now_model_028", [model.delayMinutes]);
  return {
    conclusion,
    trend,
    samples: recent,
    sources: model.dataSources,
    estimated: true,
  };
}
