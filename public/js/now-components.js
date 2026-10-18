import { displayStopName, ui } from "./locale.js";
import { selectedAlightingStop } from "./ride-destination.js";
import { esc } from "./vnext-state.js";
import { formatMinute } from "./vnext-core.js";
import { stationModel } from "./now-model.js";
import {
  itineraryAction,
  itineraryDestinationChanged,
} from "./journey-plan.js";
import { formatTime } from "./router.js";

export function itinerarySummary(plan, network, shift = null, ride = null) {
  if (!plan) return "";
  const a = itineraryAction(plan),
    changed = itineraryDestinationChanged(plan, ride),
    name = (id) => displayStopName(network.stops.get(id)) || "",
    service = (leg) =>
      leg.route
        ? ui("now_components_001", [leg.route])
        : leg.operator === "subway"
          ? ui("now_components_002")
          : leg.operator === "through"
            ? ui("now_components_003")
            : leg.operator === "kintetsu"
              ? ui("now_components_004")
              : ui("now_components_005"),
    title = changed
      ? ui("now_components_006", [name(ride.userDestination.id)])
      : plan.phase === "arrived"
        ? ui("now_components_007")
        : plan.phase === "walking"
          ? ui("now_components_008", [name(a.destination), a.walk])
          : plan.phase === "riding"
            ? ui("now_components_084", [
                name(a.current.to),
                a.next ? ui("now_components_009") : ui("now_components_010"),
              ])
            : ui("now_components_011", [name(a.current.from)]),
    detail =
      plan.phase === "riding"
        ? a.next
          ? ui("now_components_085", [
              a.walk ? ui("now_components_012", [a.walk]) : "",
              a.dwell ? ui("now_components_013", [a.dwell]) : "",
              service(a.next),
              formatTime(a.next.depart),
              a.next.platform
                ? ui("now_components_014", [a.next.platform])
                : "",
            ])
          : a.walk
            ? ui("now_components_015", [name(a.destination), a.walk])
            : ui("now_components_016", [name(a.destination)])
        : plan.phase === "walking" || plan.phase === "arrived"
          ? ui("now_components_017")
          : ui("now_components_086", [
              service(a.current),
              formatTime(a.current.depart),
              a.current.platform
                ? ui("now_components_018", [a.current.platform])
                : "",
              name(a.current.to),
            ]),
    risky =
      plan.phase === "riding" &&
      a.next &&
      Number.isFinite(shift) &&
      a.current.arrive +
        (a.current.realtimeApplied
          ? Math.max(0, shift - a.current.realtime.delay)
          : shift) +
        a.walk +
        a.dwell +
        Number(plan.input?.buffer ?? 3) >
        a.next.depart;
  return ui("now_components_087", [
    esc(a.current.serviceDate ?? plan.route.date),
    esc(title),
    esc(detail),
    changed ? ui("now_components_019") : "",
    risky ? ui("now_components_020") : "",
  ]);
}

export function routeBadge(model, { small = false } = {}) {
  const badges = model.boundary?.codes ?? [
    model.bus ? (model.route ?? ui("now_components_021")) : model.lineId,
  ];
  return `<span class="route-tokens ${model.boundary ? "boundary" : ""}">${[
    0, 1,
  ]
    .map((index) => {
      const code = badges[index] ?? "";
      return `<span class="route-token ${small ? "small" : ""} ${code.startsWith("K") ? "line-k" : code.startsWith("B") ? "line-b" : "line-bus"}" ${code ? "" : "hidden"}>${esc(code)}</span>`;
    })
    .join("")}</span>`;
}
export function statusPill(confidence, text, updated) {
  const labels = {
    confirmed: ui("now_components_022"),
    estimated: ui("now_components_023"),
    stale: ui("now_components_024"),
    unavailable: ui("now_components_025"),
  };
  return `<span class="status-pill ${confidence}">${esc(text ?? labels[confidence])}${confidence === "stale" && updated ? ui("now_components_026", [esc(new Date(updated).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }))]) : ""}</span>`;
}
export function estimateTime(value, confidence) {
  return Number.isFinite(value)
    ? `${formatMinute(Math.round(value))}<small>${confidence === "confirmed" ? ui("now_components_027") : ui("now_components_028")}</small>`
    : ui("now_components_029");
}
// Kept separate from ride status: the LCD must never treat a timetable ETA
// as confirmed stopping or approaching when tunnel GPS has disappeared.
export function railHeroCopy(model) {
  if (model.bus) return null;
  const phase = model.railGuide?.phase ?? "estimated";
  const label = ui({
    stopped: "rail_hero_stopped",
    departed: "rail_hero_departed",
    approaching: "rail_hero_approaching",
    estimated: "rail_hero_estimated",
    unavailable: "rail_hero_unavailable",
  }[phase] ?? "rail_hero_estimated");
  let duration;
  if (phase === "unavailable") duration = ui("now_components_030");
  else if (phase === "stopped")
    duration = model.nextNext
      ? ui("rail_hero_after", [displayStopName(model.nextNext)])
      : ui("rail_hero_terminal");
  else if (model.locationRecovering ||
    model.observed?.positionSource === "gps_dropout_hold")
    duration = ui("rail_hero_location_hold");
  else if (!model.railGuide?.showEstimate)
    duration = ui("rail_hero_time_unknown");
  else if (model.minutes === 0)
    duration = ui(phase === "approaching"
      ? "rail_hero_eta_soon" : "rail_hero_eta_now");
  else duration = ui("rail_hero_time", [model.minutes]);
  return { phase, label, duration };
}

export function nextStationHero(model, ride, progress) {
  const next = model.nextStation,
    destination = model.userDestination,
    nextName = displayStopName(next) || ui("now_components_054"),
    destinationName = displayStopName(destination) || ui("alighting_unselected"),
    railCopy = railHeroCopy(model);
  const duration = railCopy?.duration ?? (model.routeUnavailable
    ? ui("now_components_030")
    : model.phase === "STOPPED"
      ? ui("now_components_088", [
          model.nextNext
            ? ui("now_components_031", [displayStopName(model.nextNext)])
            : ui("now_components_032"),
        ])
      : model.minutes === null
        ? ui("now_components_033")
        : model.minutes === 0
          ? ui("now_components_034")
          : ui("now_components_089", [
              model.minutes,
              model.confidence === "confirmed"
                ? ui("now_components_035")
                : ui("now_components_036"),
            ]));
  const heading = railCopy?.label ??
    (model.label === ui("now_model_010") ? ui("now_components_053") : model.label);
  const spoken = ui("now_components_090", [
    heading,
    displayStopName(next) || ui("now_components_037"),
    next?.code ?? "",
    duration,
    displayStopName(destination) || ui("alighting_unselected"),
    model.remainingStops,
    model.bus ? ui("now_components_039") : ui("now_components_040"),
  ]);
  const start = Math.max(0, model.index - 1),
    end = Math.min(
      progress.stops.length,
      Math.max(start + 4, Math.min(progress.stops.length, start + 4)),
    );
  const strip = progress.stops.slice(start, end).map((s) => stationModel(s));
  return `<section class="hero-card aboard journey-display ${model.bus ? "bus" : model.lineId === "B" ? "rail" : "subway"}" data-operator="${esc(model.bus ? (ride.operatingCompany ?? ride.operator) : ride.operator)}" data-train-state="${model.trainState}" data-phase="${model.phase}" data-line="${model.lineId}" data-rail-phase="${railCopy?.phase ?? ""}">
    ${model.routeUnavailable || (model.delayMinutes ?? 0) >= 10 ? `<p class="journey-warning" role="status">${model.routeUnavailable ? ui("now_components_041") : ui("now_components_042", [model.delayMinutes])}</p>` : ""}
    <div class="route-header">${routeBadge({ ...model, route: ride.route })}<div><h2>${esc(model.bus ? `${ride.route ?? ""}${ride.route === "北3" ? " · North 3" : ui("now_components_043")}` : model.lineId === "K" ? ui("now_components_044") : ui("now_components_045"))} <span>${esc(model.destination ?? ui("now_components_046"))}行き</span></h2><p>${esc(model.bus ? (ride.operatingCompany === "kyotobus" ? ui("now_components_047") : ride.operatingCompany === "citybus" ? ui("now_components_048") : (ride.operatingCompany ?? (ride.route === "北3" ? ui("now_components_049") : ride.operator === "kyotobus" ? ui("now_components_050") : ui("now_components_051")))) : model.serviceType)}${model.boundary ? ui("now_components_052") : ""}</p></div></div>
    <div class="next-station-hero" role="img" aria-label="${esc(spoken)}">
      <div class="next-state-label">${esc(heading)}</div><div class="next-station-title"><strong class="journey-next-name">${esc(nextName)}</strong>${!model.bus && next?.code ? `<span class="station-code">${esc(next.code)}</span>` : ""}</div>
      <p class="next-countdown">${esc(duration)}</p>
      <p class="destination-progress">${!destination ? ui("alighting_select_prompt") : model.routeUnavailable ? ui("now_components_055") : model.nextIsDestination ? (model.bus ? ui("now_components_056") : ui("now_components_057")) : ui("now_components_091", [esc(destinationName), model.remainingStops, model.bus ? ui("now_components_059") : ui("now_components_060")])}</p>
      <details class="station-overview" ${model.bus ? "" : "open"}><summary>${model.bus ? ui("now_components_061") : ui("now_components_062")}</summary><div class="station-strip" aria-hidden="true">${strip.map((s) => `<span class="${s.id === next?.id ? "selected" : ""}"><i></i><b>${esc(displayStopName(s))}</b></span>`).join("")}</div></details>
    </div>
    <button class="personal-destination" data-context-action="destination" aria-label="${!destination ? ui("alighting_choose") : esc(destinationName)}"><span><small>あなたの降車${model.bus ? ui("now_components_063") : ui("now_components_064")}</small><b>${esc(destinationName)} ${model.bus || !destination ? "" : esc(destination.code ?? "")}</b></span><strong>${destination ? estimateTime(model.destinationArrival, model.confidence) : ui("alighting_select_action")}</strong></button>
    ${model.throughNotice ? `<p class="through-notice">${esc(model.throughNotice)}</p>` : ""}${model.boundary ? ui("now_components_092", [model.boundary.phase === "stopped" ? ui("now_components_066") : ui("now_components_067"), model.boundary.nextLine === "B" ? ui("now_components_068") : ui("now_components_069"), esc(model.serviceType), esc(model.destination)]) : ""}
    ${model.estimatedWithoutGps && !model.routeUnavailable ? `<p class="source-note rail-estimate-note" role="status">${ui(model.locationRecovering ? "rail_location_rechecking" : "rail_location_estimate")}</p>` : ""}
    ${model.delayMinutes > 0 ? ui("now_components_070", [model.delayMinutes]) : ""}
    ${model.confidence === "stale" ? ui("now_components_071", [statusPill("stale", null, model.lastUpdated)]) : ""}

  </section>`;
}

export function timelineRow(
  stop,
  { index, progress, minute, shift, bus, ride },
) {
  const planned = [stop.arrival, stop.time, stop.departure].find(
      Number.isFinite,
    ),
    adjusted = Number.isFinite(planned) ? planned + shift : null;
  const passed =
    progress.currentIndex >= 0
      ? index < progress.currentIndex
      : Number.isFinite(adjusted)
        ? adjusted < minute - 0.5
        : index < progress.nextIndex;
  const current = index === progress.currentIndex,
    next = index === progress.nextIndex,
    destination =
      stop.id === selectedAlightingStop(ride, progress.stops)?.id,
    boarding = stop.id === ride.from;
  return ui("now_components_094", [
    passed ? "passed" : "",
    next ? "next" : "",
    current ? "current" : "",
    destination ? "destination" : "",
    boarding ? "boarding" : "",
    next ? 'aria-current="step"' : "",
    esc(stop.id),
    esc(displayStopName(stop)),
    esc(stop.id),
    esc(displayStopName(stop)),
    current
      ? ui("now_components_072")
      : passed
        ? ui("now_components_073")
        : destination
          ? ui("now_components_074")
          : boarding
            ? ui("now_components_075")
            : index === progress.stops.length - 1
              ? ui("now_components_076")
              : next
                ? ui("now_components_093", [
                    bus ? ui("now_components_077") : ui("now_components_078"),
                  ])
                : "",
    Number.isFinite(adjusted)
      ? `<time>${formatMinute(Math.round(adjusted))}</time><small>${stop.estimated ? ui("now_components_079") : ui("now_components_080", [formatMinute(planned)])}</small><span>${shift > 0 ? ui("now_components_081", [Math.round(shift)]) : ui("now_components_082")}</span>`
      : ui("now_components_083"),
  ]);
}
