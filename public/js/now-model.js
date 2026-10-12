import { stopTime } from "./journey-core.js";
import { freshFix } from "./riding.js";
import { distance } from "./mobility.js";

export const TRAIN_STATES = Object.freeze({
  DEPARTED: "DEPARTED",
  APPROACHING: "APPROACHING",
  STOPPED: "STOPPED",
  LINE_BOUNDARY: "LINE_BOUNDARY",
});
const english = {
  K01: "Kokusaikaikan",
  K02: "Matsugasaki",
  K03: "Kitayama",
  K04: "Kitaoji",
  K05: "Kuramaguchi",
  K06: "Imadegawa",
  K07: "Marutamachi",
  K08: "Karasuma Oike",
  K09: "Shijo",
  K10: "Gojo",
  K11: "Kyoto",
  K12: "Kujo",
  K13: "Jujo",
  K14: "Kuinabashi",
  K15: "Takeda",
  B01: "Kyoto",
  B02: "Toji",
  B03: "Jujo",
  B04: "Kamitobaguchi",
  B06: "Fushimi",
  B07: "Kintetsu-Tambabashi",
  B08: "Momoyamagoryomae",
  B09: "Mukaijima",
  B10: "Ogura",
  B11: "Iseda",
  B12: "Okubo",
  B13: "Kutsukawa",
  B14: "Terada",
  B15: "Tonosho",
  B16: "Shin-Tanabe",
  B17: "Kodo",
  B18: "Miyamaki",
  B19: "Kintetsu-Miyazu",
  B20: "Komada",
  B21: "Shin-Hosono",
  B22: "Kizugawadai",
  B23: "Yamadagawa",
  B24: "Takanohara",
  B25: "Heijo",
  B26: "Yamato-Saidaiji",
  A27: "Shin-Omiya",
  A28: "Kintetsu-Nara",
};
export function stationModel(stop) {
  return stop
    ? { ...stop, code: stop.id ?? "", en: stop.en ?? english[stop.id] ?? "" }
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
  return ["北", "北東", "東", "南東", "南", "南西", "西", "北西"][
    Math.round(angle / 45) % 8
  ];
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
      ((!validFix || speedUnknown) &&
        hasStopTime &&
        minute >= scheduled + shift &&
        minute < departure + shift + 0.35));
  let trainState = stopped
    ? TRAIN_STATES.STOPPED
    : Number.isFinite(progress.arrival) &&
        progress.arrival - minute <= 1.2 &&
        progress.arrival - minute >= -0.5
      ? TRAIN_STATES.APPROACHING
      : TRAIN_STATES.DEPARTED;
  const observed = reduceTrainState(
    previous,
    {
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
      index: stopped ? currentIndex : progress.nextIndex,
    },
    at,
  );
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
  const userDestination = stationModel(
    stops.find(
      (s) =>
        s.id === ride.userDestination?.id || s.id === ride.userDestinationId,
    ) ?? stops.at(-1),
  );
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
  const arrivalEstimate =
    !routeUnavailable && Number.isFinite(stopTime(display))
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
  const nextIsDestination = nextStation?.id === userDestination?.id;
  const label = routeUnavailable
    ? "運行状況を確認中"
    : trainState === TRAIN_STATES.STOPPED
      ? "に到着"
      : nextIsDestination
        ? "次で降ります"
        : trainState === TRAIN_STATES.APPROACHING
          ? "まもなく"
          : bus
            ? "次の停留所"
            : "次は";
  const minutes = Number.isFinite(arrivalEstimate)
    ? Math.max(0, Math.ceil(arrivalEstimate - minute))
    : null;
  return {
    lineId,
    lineColor: lineId === "K" ? "green" : lineId === "B" ? "orange" : "blue",
    serviceType:
      ride.category === "express"
        ? "急行"
        : ride.category === "local"
          ? "普通"
          : bus
            ? "バス"
            : "種別未確認",
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
        ? `この電車は${lineOf(after) === "B" ? "近鉄京都線" : "地下鉄烏丸線"}へ直通`
        : "",
    confidence,
    dataSources: [
      "時刻表",
      "旅程",
      ...(validFix ? ["位置"] : []),
      ...(feed && !stale && !routeUnavailable ? ["接近"] : []),
    ],
    delayMinutes: shiftKnown && !stale ? Math.round(shift) : null,
    arrivalEstimate,
    destinationArrival,
    minutes,
    label,
    nextIsDestination,
    locationConfidence: validFix ? "available" : "unavailable",
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
    ? "遅れの実測情報を確認できません"
    : model.delayMinutes <= 0
      ? "時刻表に近いペースで進んでいます"
      : trend < -0.5
        ? "遅れは回復傾向です"
        : `このままなら降車駅で約${model.delayMinutes}分の遅れ（推定）`;
  return {
    conclusion,
    trend,
    samples: recent,
    sources: model.dataSources,
    estimated: true,
  };
}
