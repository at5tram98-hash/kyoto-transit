import { ui, displayStopName, durationLabel, placeName } from "./locale.js";
import { esc, icon } from "./vnext-state.js";
import { formatTime } from "./router.js";
import { boardingAvailable } from "./journey-session.js";
import { routeObservationState } from "./route-search-model.js";
import { lineBadge, lineKind, isLoopRoute } from "./line-badge.js";
const yen = (n) =>
  Number.isFinite(n)
    ? ui("route_search_view_001", [Math.round(n).toLocaleString("ja-JP")])
    : "—";
const dot = (source) =>
  `<i class="source-dot ${source === "live" ? "live" : source === "prediction" ? "prediction" : "schedule"}" aria-hidden="true"></i>`;
function observationHTML(observations, delay) {
  const state = routeObservationState(observations);
  return `${dot(state.source)}${state.label}${Number.isFinite(delay) ? ui("route_search_view_002", [delay > 0 ? "+" : "", delay]) : ""}`;
}
export function refreshRouteObservations(element) {
  for (const node of element.querySelectorAll("[data-route-observations]")) {
    const html = observationHTML(
      JSON.parse(node.dataset.routeObservations),
      node.dataset.delay === undefined ? null : Number(node.dataset.delay),
    );
    if (node.innerHTML !== html) node.innerHTML = html;
  }
}
export const operatorLabel = {
  subway: ui("route_search_view_003"),
  kintetsu: ui("route_search_view_004"),
  through: ui("route_search_view_005"),
  citybus: ui("route_search_view_006"),
  kyotobus: ui("route_search_view_007"),
};
const clock = (minute, label) => {
  const parts = formatTime(minute).split(" ");
  return `${parts.length > 1 ? `<small class="journey-clock-day">${esc(parts[0])}</small>` : ""}<b>${esc(parts.at(-1))}</b><small>${label}</small>`;
};
const isBus = (leg) => /bus/.test(leg.operatingCompany ?? leg.operator ?? "");
const serviceLabel = (leg) =>
  leg.route
    ? ui("route_search_view_008", [leg.route])
    : (operatorLabel[leg.operator] ?? leg.label);

export function routeHTML(
  route,
  network,
  rides = [],
  routeIndex = 0,
  current,
  detail = false,
  {
    readOnly = false,
    hideActions = false,
    position = routeIndex + 1,
    recommendations = [],
    lockedThrough = -1,
  } = {},
) {
  const name = (id) => displayStopName(network.stops.get(id)) || id,
    available = route.legs
      .map((leg, i) => ({ leg, i }))
      .filter(({ i }) => rides[i]),
    first = available[0],
    walk = route.legs
      .filter((l) => l.kind === "walk")
      .reduce((sum, l) => sum + l.minutes, 0),
    passApplied =
      route.fare.details?.some((d) => d.covered) ||
      (Number.isFinite(route.fare.additional) &&
        Number.isFinite(route.fare.normal) &&
        route.fare.additional < route.fare.normal);
  const routeBadges = route.legs
    .filter((leg) => leg.kind === "ride")
    .map(
      (leg) =>
        `<span class="route-mode-badge" data-operator="${esc(leg.operator === "through" ? "through" : (leg.operatingCompany ?? leg.operator))}">${isBus(leg) ? icon("bus") : ""}${lineBadge(leg, { size: "small", label: serviceLabel(leg) })}</span>`,
    )
    .join('<span class="route-mode-transfer" aria-hidden="true">›</span>');
  // Fare per ride block, shown on the leg where the block starts (Yahoo-style).
  const legFare = (leg) => {
    const d = route.fare.details?.find(
      (x) => x.from === leg.from && x.path?.includes(leg.to),
    );
    if (!d) return "";
    return d.covered
      ? ui("route_leg_fare_covered")
      : Number.isFinite(d.additional)
        ? ui("route_leg_fare", [Math.round(d.additional).toLocaleString("ja-JP")])
        : "";
  };
  const startTime =
    route.legs[0]?.kind === "ride" ? route.legs[0].depart : route.start;
  const shownDuration = Math.max(0, route.time - startTime);
  const stationName = (id) =>
    detail && !readOnly
      ? `<button type="button" class="journey-station-button" data-route-stop="${esc(id)}">${esc(name(id))}<span aria-hidden="true">›</span></button>`
      : `<b class="journey-stop-name">${esc(name(id))}</b>`;
  const point = (minute, id, label, cls = "") =>
    `<div class="planner-leg journey-point ${cls}"><time class="planner-clock">${clock(minute, label)}</time><span class="planner-line"></span><div class="journey-station-band"><span class="journey-station-kind">${label}</span>${stationName(id)}</div></div>`;
  const timeline = [];
  route.legs.forEach((leg, legIndex) => {
    const previous = route.legs[legIndex - 1],
      fromTime = previous?.arrive ?? route.start;
    if (leg.depart > fromTime && (previous || leg.kind !== "ride")) {
      if (!previous)
        timeline.push(point(fromTime, leg.from, ui("route_search_view_009")));
      timeline.push(
        ui("route_search_view_049", [
          Math.round(leg.depart - fromTime),
          previous && leg.kind === "ride"
            ? ui("route_search_view_010")
            : ui("route_search_view_011"),
          esc(name(leg.from)),
          icon("clock"),
        ]),
      );
    }
    if (leg.kind !== "ride") {
      timeline.push(
        ui("route_search_view_050", [
          leg.kind === "walk" ? "walk" : "journey-dwell",
          clock(leg.depart, ui("route_search_view_012")),
          leg.kind === "walk"
            ? ui("route_search_view_013")
            : leg.kind === "dwell"
              ? ui("route_search_view_014")
              : ui("route_search_view_015"),
          leg.minutes,
          esc(name(leg.from)),
          leg.kind === "walk" ? ` → ${esc(name(leg.to))}` : "",
          leg.kind === "dwell" ? ui("route_search_view_016") : "",
        ]),
      );
      if (legIndex === route.legs.length - 1)
        timeline.push(
          point(
            leg.arrive,
            leg.to,
            ui("route_search_view_017"),
            "journey-final",
          ),
        );
      return;
    }
    const ride = rides[legIndex],
      intermediate = (leg.path ?? []).slice(1, -1),
      stops =
        detail && intermediate.length
          ? ui("route_search_view_051", [
              esc(`${legIndex}:${leg.from}:${leg.to}`),
              intermediate.length,
              intermediate.length + 1,
              intermediate
                .map(
                  (id, j) =>
                    `<li><span>${esc(name(id))}</span><time>${Number.isFinite(leg.times?.[j + 1]) ? formatTime(leg.times[j + 1]) : ui("route_search_view_018")}</time></li>`,
                )
                .join(""),
            ])
          : "",
      actions = hideActions
        ? ""
        : `${ride && boardingAvailable(ride, current) ? ui("route_search_view_019", [routeIndex, legIndex]) : ""}${ride && !route.connectionUnavailable && first?.i !== legIndex ? ui("route_search_view_020", [routeIndex, legIndex]) : ""}`,
      departure =
        detail && !readOnly && legIndex > lockedThrough
          ? ui("route_search_view_052", [
              routeIndex,
              legIndex,
              esc(name(leg.from)),
              formatTime(leg.depart),
              clock(leg.depart, ui("route_search_view_021")),
            ])
          : `<time class="planner-clock">${clock(leg.depart, ui("route_search_view_022"))}</time>`,
      source = leg.realtime
        ? `<span data-route-observations="${esc(JSON.stringify([leg.realtime]))}" data-delay="${esc(leg.realtime.delay)}">${observationHTML([leg.realtime], leg.realtime.delay)}</span>`
        : `${dot("schedule")}${leg.dataConfidence === "stale" ? ui("route_search_view_023") : ui("route_search_view_024")}`;
    timeline.push(
      ui("route_search_view_053", [
        esc(leg.operatingCompany ?? leg.operator),
        departure,
        stationName(leg.from),
        lineBadge(leg, { size: isBus(leg) ? "large" : "regular", label: serviceLabel(leg) }),
        isBus(leg)
          ? `${esc(operatorLabel[leg.operatingCompany ?? leg.operator] ?? "")} ${esc(serviceLabel(leg))}${isLoopRoute(leg.route) ? `<em class="journey-loop">${esc(ui("route_loop"))}</em>` : ""}`
          : esc(
              (leg.category === "express"
                ? ui("route_search_view_025")
                : leg.category === "local"
                  ? ui("route_search_view_026")
                  : ""
              ).replace(/^\s*·\s*/, ""),
            ),
        esc(placeName(leg.destination) ?? ui("route_search_view_027")),
        leg.destination ? ui("route_search_view_028") : "",
        leg.through ? ui("route_search_view_029") : "",
        leg.platform ? ui("route_search_view_030", [esc(leg.platform)]) : "",
        source,
        !leg.realtimeApplied && leg.realtime
          ? ui("route_search_view_031", [
              formatTime(leg.arrive + leg.realtime.delay),
            ])
          : "",
        stops,
        actions ? `<div class="planner-leg-actions">${actions}</div>` : "",
        point(
          leg.arrive,
          leg.to,
          ui("route_search_view_032"),
          `${legIndex === route.legs.length - 1 ? "journey-final" : "journey-transfer"}`,
        ),
        leg.arrivalPlatform
          ? ui("route_search_view_033", [esc(leg.arrivalPlatform)])
          : "",
        esc(lineKind(leg)),
        `<p class="journey-leg-meta"><span>${esc(ui("route_leg_minutes", [Math.max(0, Math.round(leg.arrive - leg.depart))]))}</span>${legFare(leg) ? `<span>${esc(legFare(leg))}</span>` : ""}</p>`,
      ]),
    );
  });
  const startAction =
    detail && first && !hideActions && !route.connectionUnavailable
      ? ui("route_search_view_034", [routeIndex, first.i, icon("location")])
      : "";
  const toolbar =
    detail && !readOnly && !hideActions
      ? ui("route_search_view_035", [
          icon("bookmark"),
          icon("share"),
          icon("operations"),
          icon("more"),
        ])
      : "";
  const observations = route.legs.map((leg) => leg.realtime).filter(Boolean);
  const quality = `<span class="planner-quality" data-route-observations="${esc(JSON.stringify(observations))}">${observationHTML(observations)}</span>`;
  const tags = recommendations
    .map(
      (key) =>
        `<span class="route-rank ${key}" aria-label="${{ arrival: ui("route_search_view_036"), transfers: ui("route_search_view_037"), fare: ui("route_search_view_038") }[key]}">${{ arrival: ui("route_search_view_039"), transfers: ui("route_search_view_040"), fare: ui("route_search_view_041") }[key]}</span>`,
    )
    .join("");
  return ui("route_search_view_054", [
    detail ? "route-detail" : "route-option",
    esc(route.legs.find((l) => l.kind === "ride")?.operator ?? "walk"),
    !detail ? ui("route_search_view_042", [position, position]) : "",
    route.changedLeg != null ? ui("route_search_view_043") : "",
    formatTime(startTime),
    formatTime(route.time),
    durationLabel(shownDuration),
    yen(route.fare.additional),
    route.fare.additional !== route.fare.normal
      ? ui("route_search_view_044", [yen(route.fare.normal)])
      : "",
    route.transfers,
    walk,
    !detail ? `<span class="route-ranks">${tags}</span>` : "",
    quality,
    passApplied ? ui("route_search_view_045") : "",
    detail ? toolbar : `<p class="planner-route-summary">${routeBadges}</p>`,
    route.connectionUnavailable
      ? ui("route_search_view_046")
      : route.connectionRisk
        ? ui("route_search_view_047")
        : "",
    detail
      ? `<div class="planner-timeline">${timeline.join("")}</div>`
      : ui("route_search_view_048", [routeIndex]),
    startAction
      ? `<footer class="screen-bottom-action journey-start-action">${startAction}</footer>`
      : "",
  ]);
}
