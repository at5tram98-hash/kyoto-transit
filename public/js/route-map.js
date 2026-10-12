import { freshFix } from "./riding.js";
import { distance } from "./mobility.js";
import { esc } from "./vnext-state.js";
import { updateHTML } from "./view-rendering.js";

export function snapToPolyline(
  fix,
  points,
  { maxDistance = 100, at = Date.now() } = {},
) {
  if (!freshFix(fix, at) || !Array.isArray(points) || points.length < 2)
    return null;
  let best = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      c = Math.cos((fix.lat * Math.PI) / 180);
    const dx = (b[0] - a[0]) * c,
      dy = b[1] - a[1],
      x = (fix.lng - a[0]) * c,
      y = fix.lat - a[1];
    const ratio = Math.max(
      0,
      Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1)),
    );
    const point = {
      lng: a[0] + ratio * (b[0] - a[0]),
      lat: a[1] + ratio * (b[1] - a[1]),
    };
    const meters = distance(fix, point);
    if (!best || meters < best.meters)
      best = { ...point, meters, segment: i - 1, ratio };
  }
  return best?.meters <= maxDistance ? best : null;
}
export function routeMapModel(
  ride,
  progress,
  { geo, fix, routeConfig, at = Date.now() } = {},
) {
  const known = new Map((geo?.stops ?? []).map((s) => [s.id, s]));
  const stops = progress.stops
    .map((s) => ({ ...s, ...known.get(s.id) }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  const shape = routeConfig?.shape?.length
    ? routeConfig.shape
    : stops.map((s) => [s.lng, s.lat]);
  const unavailable = routeConfig?.suspended || routeConfig?.variantUnverified;
  const snapped = unavailable
    ? null
    : snapToPolyline(fix, shape, {
        at,
        maxDistance: Math.max(70, Math.min(150, fix?.accuracy ?? 70)),
      });
  const points = shape.length ? shape : stops.map((s) => [s.lng, s.lat]);
  let position = snapped;
  if (!position && !unavailable && points.length >= 2) {
    const nearestIndex = (s) =>
      !s
        ? null
        : points.reduce(
            (best, p, i) =>
              distance(s, { lng: p[0], lat: p[1] }) <
              distance(s, { lng: points[best][0], lat: points[best][1] })
                ? i
                : best,
            0,
          );
    const first = nearestIndex(stops[0]) ?? 0,
      last = nearestIndex(stops.at(-1)) ?? points.length - 1;
    const n = Math.max(
        0,
        Math.min(points.length - 1, first + (last - first) * progress.fraction),
      ),
      a = points[Math.floor(n)],
      b = points[Math.min(points.length - 1, Math.ceil(n))];
    position = {
      lng: a[0] + (b[0] - a[0]) * (n % 1),
      lat: a[1] + (b[1] - a[1]) * (n % 1),
    };
  }
  return {
    points,
    stops,
    position,
    source: unavailable ? "unavailable" : snapped ? "location" : "schedule",
    approximate: !routeConfig?.shape?.length || routeConfig?.shapeEstimated,
    unavailable,
  };
}
export function routeMapHTML(map, model, { expanded = false } = {}) {
  if (map.points.length < 2)
    return '<p class="source-note">経路の位置データは未取得です。停車順と時刻表で案内します。</p>';
  const xs = map.points.map((p) => p[0]),
    ys = map.points.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const cos = Math.cos((((minY + maxY) / 2) * Math.PI) / 180),
    w = (maxX - minX) * cos,
    h = maxY - minY,
    scale = Math.min(270 / (w || 1), 150 / (h || 1));
  const xy = (p) => [
    160 + (p[0] - (minX + maxX) / 2) * cos * scale,
    100 - (p[1] - (minY + maxY) / 2) * scale,
  ];
  const line = map.points
    .map((p) =>
      xy(p)
        .map((v) => v.toFixed(2))
        .join(","),
    )
    .join(" ");
  const pos = map.position && xy([map.position.lng, map.position.lat]);
  return `<div class="route-map ${expanded ? "expanded" : ""}" data-line="${model.lineId}"><svg viewBox="0 0 320 200" role="img" aria-label="${model.bus ? "バス" : "鉄道"}の経路と${map.source === "location" ? "現在地" : "時刻表による推定位置"}"><path class="map-grid" d="M0 40H320M0 100H320M0 160H320M50 0V200M160 0V200M270 0V200"/><polyline points="${line}" class="map-path"/>${map.stops
    .map((s) => {
      const [x, y] = xy([s.lng, s.lat]);
      return `<circle cx="${x}" cy="${y}" r="3.5" class="map-stop"/>`;
    })
    .join(
      "",
    )}${pos ? `<circle class="map-position" cx="${pos[0]}" cy="${pos[1]}" r="6"/>` : ""}</svg><p>${map.unavailable ? "経路変更・運休のため現在位置は未確認" : map.source === "location" ? "現在地を経路上に表示" : "位置情報未取得 · 時刻表から推定"}${map.approximate ? " · 経路図は概略" : ""}</p></div>`;
}

const mapViews = new WeakMap();
export function renderRouteMap(element, map, model) {
  const html = routeMapHTML(map, model),
    signature = JSON.stringify([map.points, map.stops.map((s) => s.id)]);
  if (mapViews.get(element) !== signature || !element.querySelector("svg")) {
    updateHTML(element, html);
    mapViews.set(element, signature);
    return;
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  const next = template.content.firstElementChild,
    current = element.firstElementChild;
  if (!next?.querySelector("svg")) {
    updateHTML(element, html);
    return;
  }
  current.dataset.line = next.dataset.line;
  current
    .querySelector("svg")
    .setAttribute(
      "aria-label",
      next.querySelector("svg").getAttribute("aria-label"),
    );
  let marker = current.querySelector(".map-position");
  const target = next.querySelector(".map-position");
  if (!target) marker?.remove();
  else {
    if (!marker) {
      marker = target.cloneNode(true);
      current.querySelector("svg").append(marker);
    }
    for (const axis of ["cx", "cy"]) {
      const value = target.getAttribute(axis);
      if (marker.getAttribute(axis) !== value) marker.setAttribute(axis, value);
    }
  }
  updateHTML(current.querySelector("p"), next.querySelector("p").innerHTML);
}
