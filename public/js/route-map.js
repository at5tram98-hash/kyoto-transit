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
// Web Mercator matches the OpenStreetMap raster tile coordinate system.
export function mapProject([lng, lat], zoom) {
  const world = 256 * 2 ** zoom;
  const sin = Math.sin(
    (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180,
  );
  return [
    ((lng + 180) / 360) * world,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world,
  ];
}
const mapData = new Map(),
  viewports = new WeakMap();
const WIDTH = 420,
  HEIGHT = 240;
export function mapViewport(points, height = HEIGHT) {
  const projected = points.map((p) => mapProject(p, 0));
  const xs = projected.map((p) => p[0]),
    ys = projected.map((p) => p[1]);
  const center = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
  const zoom = Math.max(
    9,
    Math.min(
      17,
      Math.floor(
        Math.log2(
          Math.min(
            (WIDTH - 70) / Math.max(0.001, Math.max(...xs) - Math.min(...xs)),
            (height - 60) / Math.max(0.001, Math.max(...ys) - Math.min(...ys)),
          ),
        ),
      ),
    ),
  );
  return { center, zoom, height };
}
function mapDrawing(map, view) {
  const factor = 2 ** view.zoom,
    center = view.center.map((v) => v * factor);
  const left = center[0] - WIDTH / 2,
    top = center[1] - (view.height ?? HEIGHT) / 2;
  const xy = (p) =>
    mapProject(p, view.zoom).map((v, i) => v - (i ? top : left));
  const tiles = [];
  for (
    let y = Math.floor(top / 256);
    y <= Math.floor((top + (view.height ?? HEIGHT)) / 256);
    y++
  ) {
    for (
      let x = Math.floor(left / 256);
      x <= Math.floor((left + WIDTH) / 256);
      x++
    ) {
      tiles.push(
        `<image class="map-tile" x="${x * 256 - left}" y="${y * 256 - top}" width="256" height="256" data-tile-src="https://tile.openstreetmap.org/${view.zoom}/${x}/${y}.png"/>`,
      );
    }
  }
  const pos = map.position && xy([map.position.lng, map.position.lat]);
  const stops = map.stops
    .map((s, i) => {
      const [x, y] = xy([s.lng, s.lat]);
      const label =
        (i === 0 || i === map.stops.length - 1 || s.id === map.nextId) &&
        x >= 0 &&
        x <= WIDTH &&
        y >= 0 &&
        y <= (view.height ?? HEIGHT);
      return `<g><circle cx="${x}" cy="${y}" r="4" class="map-stop"/>${label ? `<text x="${Math.max(5, Math.min(WIDTH - 5, x))}" y="${Math.max(16, Math.min((view.height ?? HEIGHT) - 8, y - 10))}" text-anchor="${x < 80 ? "start" : x > WIDTH - 80 ? "end" : "middle"}">${esc(s.name.replace(/（[^）]+）/g, "").replace("バスターミナル", "BT"))}</text>` : ""}</g>`;
    })
    .join("");
  return `${tiles.join("")}<polyline points="${map.points.map((p) => xy(p).join(",")).join(" ")}" class="map-path"/>${stops}${pos ? `<circle class="map-position" cx="${pos[0]}" cy="${pos[1]}" r="7"/>` : ""}`;
}
const mapNote = (map) =>
  `${map.unavailable ? "経路変更・運休のため現在位置は未確認" : map.source === "location" ? "現在地を経路上に表示" : "現在地は時刻表から推定"}${map.approximate ? " · 路線は概略" : ""}`;
export function routeMapHTML(map, model, { expanded = false } = {}) {
  if (map.points.length < 2)
    return '<p class="source-note">経路の位置データは未取得です。停車順と時刻表で案内します。</p>';
  const key = JSON.stringify([map.points, map.stops.map((s) => s.id)]);
  mapData.set(key, { ...map, nextId: model.nextStation?.id, model });
  // Only keep current journey contexts, not a growing history of GPS updates.
  if (mapData.size > 6) mapData.delete(mapData.keys().next().value);
  const view = mapViewport(map.points);
  return `<div class="route-map ${expanded ? "expanded" : ""}" data-map-key="${esc(key)}" data-line="${model.lineId}"><div class="map-canvas"><svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="道路・地名を含む${model.bus ? "バス" : "鉄道"}の地図。${mapNote(map)}">${mapDrawing({ ...map, nextId: model.nextStation?.id }, view)}</svg><div class="map-controls"><button data-map-zoom="1" aria-label="地図を拡大">＋</button><button data-map-zoom="-1" aria-label="地図を縮小">−</button><button data-map-reset aria-label="経路全体を表示">⌖</button></div><span class="map-load-note" hidden>背景地図を取得できません · 経路のみ表示</span><a class="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a></div><p>${mapNote(map)}</p></div>`;
}
function draw(element, map, view) {
  const svg = element.querySelector("svg");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${view.height ?? HEIGHT}`);
  updateHTML(svg, mapDrawing(map, view));
  viewports.set(element, view);
}
export function renderRouteMap(element, map, model) {
  const key = JSON.stringify([map.points, map.stops.map((s) => s.id)]);
  const current = element.querySelector(".route-map");
  if (!current || current.dataset.mapKey !== key) {
    updateHTML(element, routeMapHTML(map, model));
    return;
  }
  const next = { ...map, nextId: model.nextStation?.id, model };
  mapData.set(key, next);
  // Preserve loaded background tiles and user pan/zoom on position refresh.
  for (const target of [
    current,
    ...document.querySelectorAll(".sheet[open] .route-map"),
  ]) {
    if (target.dataset.mapKey !== key) continue;
    target.dataset.line = model.lineId;
    const view = viewports.get(target) ?? mapViewport(map.points);
    const factor = 2 ** view.zoom;
    const pos =
      map.position &&
      mapProject([map.position.lng, map.position.lat], view.zoom).map(
        (v, i) =>
          v -
          view.center[i] * factor +
          (i ? (view.height ?? HEIGHT) : WIDTH) / 2,
      );
    let marker = target.querySelector(".map-position");
    if (!pos) marker?.remove();
    else {
      if (!marker) {
        marker = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        marker.setAttribute("class", "map-position");
        marker.setAttribute("r", "7");
        target.querySelector("svg").append(marker);
      }
      for (const [i, axis] of ["cx", "cy"].entries())
        marker.setAttribute(axis, String(pos[i]));
    }
    updateHTML(target.querySelector("p"), mapNote(map));
  }
}
export function setupRouteMaps() {
  const watched = new Set(),
    visible = new WeakSet();
  const loadTiles = (canvas) => {
    for (const tile of canvas.querySelectorAll(".map-tile:not([href])"))
      tile.setAttribute("href", tile.dataset.tileSrc);
  };
  const visibility = new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting } of entries) {
        if (isIntersecting) {
          visible.add(target);
          loadTiles(target);
        } else visible.delete(target);
      }
    },
    { rootMargin: "50px" },
  );
  const observer = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const element = target.closest(".route-map"),
        map = mapData.get(element.dataset.mapKey);
      if (!map || !target.clientWidth || !target.clientHeight) continue;
      const height = (WIDTH * target.clientHeight) / target.clientWidth;
      const view = viewports.get(element);
      draw(
        element,
        map,
        view ? { ...view, height } : mapViewport(map.points, height),
      );
    }
  });
  new MutationObserver(() => {
    for (const canvas of watched)
      if (!canvas.isConnected) {
        observer.unobserve(canvas);
        visibility.unobserve(canvas);
        visible.delete(canvas);
        watched.delete(canvas);
      }
    for (const canvas of document.querySelectorAll(".route-map .map-canvas")) {
      if (!watched.has(canvas)) {
        watched.add(canvas);
        observer.observe(canvas);
        visibility.observe(canvas);
      }
      if (visible.has(canvas)) loadTiles(canvas);
    }
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener(
    "error",
    (e) => {
      if (!e.target?.matches?.(".map-tile")) return;
      const note = e.target
        .closest(".route-map")
        ?.querySelector(".map-load-note");
      e.target.dataset.tileFailed = "true";
      if (note) note.hidden = false;
    },
    true,
  );
  document.addEventListener(
    "load",
    (e) => {
      if (!e.target?.matches?.(".map-tile")) return;
      const note = e.target
        .closest(".route-map")
        ?.querySelector(".map-load-note");
      e.target.dataset.tileLoaded = "true";
      if (note)
        note.hidden = Boolean(
          e.target.closest("svg").querySelector("[data-tile-failed]"),
        )
          ? false
          : true;
    },
    true,
  );
  document.addEventListener("click", (e) => {
    const button = e.target.closest("[data-map-zoom],[data-map-reset]");
    if (!button) return;
    const element = button.closest(".route-map"),
      map = mapData.get(element.dataset.mapKey);
    if (!map) return;
    const view = viewports.get(element) ?? mapViewport(map.points);
    draw(
      element,
      map,
      button.hasAttribute("data-map-reset")
        ? mapViewport(map.points, view.height)
        : {
            ...view,
            zoom: Math.max(
              9,
              Math.min(18, view.zoom + Number(button.dataset.mapZoom)),
            ),
          },
    );
  });
  let drag = null;
  document.addEventListener("pointerdown", (e) => {
    const canvas = e.target.closest(".route-map.expanded .map-canvas");
    if (!canvas || e.target.closest("button,a")) return;
    const element = canvas.closest(".route-map"),
      map = mapData.get(element.dataset.mapKey);
    if (!map) return;
    drag = {
      element,
      map,
      x: e.clientX,
      y: e.clientY,
      view: viewports.get(element) ?? mapViewport(map.points),
      width: canvas.getBoundingClientRect().width,
      height: canvas.getBoundingClientRect().height,
    };
    canvas.setPointerCapture(e.pointerId);
  });
  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.x;
    drag.dy = e.clientY - drag.y;
    drag.element.querySelector("svg").style.transform =
      `translate(${drag.dx}px,${drag.dy}px)`;
  });
  document.addEventListener("pointerup", () => {
    if (!drag) return;
    const { element, map, view, width, height, dx = 0, dy = 0 } = drag;
    element.querySelector("svg").style.transform = "";
    draw(element, map, {
      ...view,
      center: [
        view.center[0] - (dx * WIDTH) / width / 2 ** view.zoom,
        view.center[1] -
          (dy * (view.height ?? HEIGHT)) / height / 2 ** view.zoom,
      ],
    });
    drag = null;
  });
  document.addEventListener("pointercancel", () => {
    if (drag) drag.element.querySelector("svg").style.transform = "";
    drag = null;
  });
}
