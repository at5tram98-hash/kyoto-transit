// Between two rides of a planned journey the Now screen keeps guiding: the
// walk and the wait to the next boarding stop, the service to take and a
// countdown to its departure, so the rider moves straight on to the next leg
// instead of dropping back to the idle screen.
import { displayStopName, ui } from "./locale.js";
import { lineBadge } from "./line-badge.js";
import { esc } from "./vnext-state.js";
import { icon } from "./icons.js";
import { formatTime } from "./router.js";

const isRide = (leg) => leg?.kind === "ride";

// The minute of the plan's service day that corresponds to now, so trips
// after midnight (minute >= 1440) still count down correctly.
export function planMinute(plan, now) {
  const date = plan?.input?.date ?? plan?.route?.date;
  if (!date || !now?.date) return now?.minute ?? null;
  const days =
    (Date.parse(`${now.date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
    86400000;
  return Number.isFinite(days) ? now.minute + days * 1440 : now.minute;
}

// The steps from the last ride's alighting stop to the next ride: walks,
// stays at a via stop, then the remaining wait at the boarding stop.
export function transferSteps(plan) {
  if (!plan || plan.phase !== "transfer") return null;
  const legs = plan.route.legs,
    next = legs[plan.legIndex];
  if (!isRide(next)) return null;
  let previous = -1;
  for (let i = plan.legIndex - 1; i >= 0; i--)
    if (isRide(legs[i])) {
      previous = i;
      break;
    }
  const between = legs.slice(previous + 1, plan.legIndex),
    arrived = previous >= 0 ? legs[previous].arrive : plan.route.start,
    moving = between.reduce((n, leg) => n + (leg.minutes ?? 0), 0),
    wait = Math.max(0, Math.round(next.depart - arrived - moving)),
    rides = legs.filter(isRide);
  return {
    previous: previous >= 0 ? legs[previous] : null,
    between,
    wait,
    next,
    number: rides.indexOf(next) + 1,
    total: rides.length,
  };
}

export function transferGuideHTML(plan, network, now) {
  const name = (id) => esc(displayStopName(network.stops.get(id)) || id || "");
  const minute = planMinute(plan, now);
  if (plan?.phase === "walking") {
    const destination = plan.route.legs.at(-1)?.to,
      walk = plan.route.legs
        .slice(plan.legIndex + 1)
        .filter((leg) => leg.kind === "walk")
        .reduce((n, leg) => n + leg.minutes, 0);
    return `<section class="transfer-guide" data-transfer-guide="walking" aria-live="polite"><p class="transfer-step-label">${esc(ui("transfer_final_walk"))}</p><h2>${esc(ui("transfer_walk_to", [displayStopName(network.stops.get(destination)) || destination, walk]))}</h2><ol class="transfer-steps"><li data-kind="walk"><span class="transfer-step-icon">${icon("walk")}</span><span><b>${esc(ui("transfer_walk", [walk]))}</b><small>${name(plan.route.legs[plan.legIndex]?.to)} → ${name(destination)}</small></span></li></ol><div class="screen-action-group"><button type="button" class="primary-action" data-itinerary-next>${esc(ui("transfer_arrived"))}</button><button type="button" class="plain-action" data-open-itinerary>${esc(ui("transfer_whole_route"))}</button></div></section>`;
  }
  const steps = transferSteps(plan);
  if (!steps) return "";
  const { next } = steps,
    remaining = Number.isFinite(minute)
      ? Math.round(next.depart - minute)
      : null,
    countdown =
      remaining == null
        ? ""
        : remaining > 0
          ? ui("transfer_countdown", [remaining])
          : ui("transfer_departing");
  const headsign = next.destination || plan.rides?.[plan.legIndex]?.destination;
  const rows = steps.between.map((leg) =>
    leg.kind === "walk"
      ? `<li data-kind="walk"><span class="transfer-step-icon">${icon("walk")}</span><span><b>${esc(ui("transfer_walk", [leg.minutes]))}</b><small>${name(leg.from)} → ${name(leg.to)}</small></span></li>`
      : `<li data-kind="dwell"><span class="transfer-step-icon">${icon("clock")}</span><span><b>${esc(ui("transfer_stay", [leg.minutes]))}</b><small>${name(leg.from)}</small></span></li>`,
  );
  if (steps.wait > 0)
    rows.push(
      `<li data-kind="wait"><span class="transfer-step-icon">${icon("clock")}</span><span><b>${esc(ui("transfer_wait", [steps.wait]))}</b><small>${name(next.from)}${next.platform ? ` · ${esc(ui("transfer_platform", [next.platform]))}` : ""}</small></span></li>`,
    );
  rows.push(
    `<li data-kind="ride"><span class="transfer-step-icon">${lineBadge(next, { name: false, size: "small" })}</span><span><b>${esc(headsign ? ui("transfer_ride", [headsign]) : ui("transfer_ride_to", [displayStopName(network.stops.get(next.to)) || next.to]))}</b><small>${esc(ui("transfer_ride_detail", [formatTime(next.depart), displayStopName(network.stops.get(next.to)) || next.to, formatTime(next.arrive)]))}</small></span></li>`,
  );
  return `<section class="transfer-guide" data-transfer-guide="transfer" aria-live="polite"><p class="transfer-step-label">${esc(ui("transfer_label", [steps.number, steps.total]))}</p><h2>${esc(ui("transfer_title", [displayStopName(network.stops.get(next.from)) || next.from]))}</h2><div class="transfer-next">${lineBadge(next, { size: "large" })}<div class="transfer-clock"><time>${esc(ui("transfer_depart_at", [formatTime(next.depart)]))}</time>${countdown ? `<b data-transfer-countdown${remaining != null && remaining <= 2 ? ' data-soon="true"' : ""}>${esc(countdown)}</b>` : ""}</div></div><ol class="transfer-steps">${rows.join("")}</ol><div class="screen-action-group"><button type="button" class="primary-action" data-board-armed>${esc(ui("transfer_board"))}</button><button type="button" class="plain-action" data-open-itinerary>${esc(ui("transfer_whole_route"))}</button></div></section>`;
}
