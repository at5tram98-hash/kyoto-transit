// Has today's service at a stop ended? Read from the timetable: the first and
// last departure of the day at the stop. After the last one (or in the small
// hours before the first, from 01:00) the stop says "today's service has
// ended" instead of an empty or stale list. Before 01:00 the previous day's
// late trips may still run, so nothing is claimed.
import { ui } from "./locale.js";
import { esc } from "./vnext-state.js";
import { getStaticFeed } from "./fast-data.js";

export function stopServiceDay(feeds = [], stopId, date) {
  let first = Infinity,
    last = -Infinity;
  for (const feed of feeds)
    for (const service of feed?.services ?? []) {
      const stops = service.stops ?? [];
      stops.forEach((id, index) => {
        if (id !== stopId || index === stops.length - 1) return;
        for (const trip of service.trips ?? []) {
          if (trip.date && trip.date !== date) continue;
          const depart = trip.departures?.[index] ?? trip.arrivals?.[index];
          if (!Number.isFinite(depart)) continue;
          if (depart < first) first = depart;
          if (depart > last) last = depart;
        }
      });
    }
  return Number.isFinite(first) ? { first, last } : null;
}

// "ended" after the last departure; "before" in the small hours before the
// first; null while service runs (or when it cannot be told).
export function serviceEndState(day, minute) {
  if (!day || !Number.isFinite(minute)) return null;
  if (minute > day.last) return "ended";
  if (minute >= 60 && minute < day.first && day.first - minute > 30) return "before";
  return null;
}

const clock = (m) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function serviceEndHTML(state, day) {
  if (!state) return "";
  return `<p class="service-ended" role="status"><b>${esc(ui("service_ended"))}</b>${
    state === "before" && day ? `<small>${esc(ui("service_first", [clock(day.first)]))}</small>` : ""
  }</p>`;
}

// Bus timetables come from the static feed: one fetch per operator and day,
// kept here so a render can ask synchronously.
const feeds = new Map(),
  loading = new Set();
export function cachedStaticFeed(operator, date, onLoad) {
  const key = `${operator}:${date}`;
  if (feeds.has(key)) return feeds.get(key);
  if (!loading.has(key)) {
    loading.add(key);
    getStaticFeed(operator, date)
      .then((feed) => {
        feeds.set(key, feed);
        while (feeds.size > 6) feeds.delete(feeds.keys().next().value);
        onLoad?.();
      })
      .catch(() => {})
      .finally(() => loading.delete(key));
  }
  return null;
}

// The end-of-service note for a stop now, or "" (also while loading).
export function stopEndNote(stop, feedsOrOperator, now, onLoad) {
  const list = Array.isArray(feedsOrOperator)
    ? feedsOrOperator
    : [cachedStaticFeed(feedsOrOperator, now.date, onLoad)].filter(Boolean);
  if (!list.length) return { state: null, html: "" };
  const day = stopServiceDay(list, stop.id, now.date),
    state = serviceEndState(day, now.minute);
  return { state, html: serviceEndHTML(state, day) };
}
