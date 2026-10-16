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
    4,
    Math.min(
      17,
      Math.floor(
        Math.log2(
          Math.min(
            (WIDTH - 70) / Math.max(0.001, Math.max(...xs) - Math.min(...xs)),
            Math.max(20, height - 60) /
              Math.max(0.001, Math.max(...ys) - Math.min(...ys)),
          ),
        ),
      ),
    ),
  );
  return { center, zoom, height };
}
// Actual catalog positions and line geometry; a default region is never a GPS fix.
export function nearbyMapModel(geo, near, fix, network) {
  if (!geo?.stops?.length) return null;
  const origin = fix ?? { lat: 35.01651, lng: 135.75949 };
  const rows = (
    near?.all?.length
      ? near.all
      : geo.stops.map((s) => ({
          ...s,
          stop: network?.stops.get(s.id),
          meters: distance(origin, s),
        }))
  )
    .filter((s) => s.stop && s.meters < 2200)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, 28);
  const stops = rows.map((s) => ({ ...s, ...s.stop, operator: s.stop.type }));
  const anchor = rows[0] ?? origin;
  const center = [anchor.lng, anchor.lat];
  return {
    place: true,
    nearby: true,
    source: fix ? "location" : "schedule",
    points: [
      [center[0] - 0.006, center[1] - 0.0035],
      [center[0] + 0.006, center[1] + 0.0035],
    ],
    stops,
    position: fix
      ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }
      : null,
    lines: (geo.lines ?? []).filter((l) =>
      l.points?.some((p) => distance(origin, { lng: p[0], lat: p[1] }) < 2500),
    ),
  };
}
function mapDrawing(map, view) {
  const factor = 2 ** view.zoom,
    center = view.center.map((v) => v * factor);
  const left = center[0] - WIDTH / 2,
    top = center[1] - (view.height ?? HEIGHT) / 2;
  const xy = (p) =>
    mapProject(p, view.zoom).map((v, i) => v - (i ? top : left));
  const tiles = [],
    tileZoom = Math.floor(view.zoom),
    tileSize = 256 * 2 ** (view.zoom - tileZoom);
  for (
    let y = Math.floor(top / tileSize);
    y <= Math.floor((top + (view.height ?? HEIGHT)) / tileSize);
    y++
  ) {
    for (
      let x = Math.floor(left / tileSize);
      x <= Math.floor((left + WIDTH) / tileSize);
      x++
    ) {
      tiles.push(
        `<img class="map-tile" alt="" decoding="async" data-tile-src="https://tile.openstreetmap.org/${tileZoom}/${x}/${y}.png" style="left:${((x * tileSize - left) / WIDTH) * 100}%;top:${((y * tileSize - top) / (view.height ?? HEIGHT)) * 100}%;width:${(tileSize / WIDTH) * 100}%;height:${(tileSize / (view.height ?? HEIGHT)) * 100}%">`,
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
      return `<g data-map-stop="${esc(s.id)}" data-operator="${esc(s.operator ?? "")}"${map.nearby ? ` role="button" tabindex="0" aria-label="${esc(s.name)}の詳細"` : ""}>${map.nearby ? `<circle cx="${x}" cy="${y}" r="26" fill="transparent"/>` : ""}<circle cx="${x}" cy="${y}" r="4" class="map-stop"/><text ${label ? "" : "hidden"} x="${Math.max(5, Math.min(WIDTH - 5, x))}" y="${Math.max(16, Math.min((view.height ?? HEIGHT) - 8, y - 10))}" text-anchor="${x < 80 ? "start" : x > WIDTH - 80 ? "end" : "middle"}">${esc(s.name.replace(/（[^）]+）/g, "").replace("バスターミナル", "BT"))}</text></g>`;
    })
    .join("");
  const accuracy =
    pos && map.position.accuracy > 0
      ? `<circle class="map-accuracy" cx="${pos[0]}" cy="${pos[1]}" r="${Math.min(2048, map.position.accuracy / ((156543.03392 * Math.cos((map.position.lat * Math.PI) / 180)) / factor))}"/>`
      : "";
  const lines = (map.lines ?? [])
    .map(
      (l) =>
        `<polyline class="map-path" data-operator="${l.line === "烏丸線" ? "subway" : "kintetsu"}" points="${l.points.map((p) => xy(p).join(",")).join(" ")}"/>`,
    )
    .join("");
  return {
    tiles: tiles.join(""),
    overlay: `${lines}${accuracy}${map.place ? "" : `<polyline points="${map.points.map((p) => xy(p).join(",")).join(" ")}" class="map-path"/>`}${stops}${pos ? `<circle class="map-position" cx="${pos[0]}" cy="${pos[1]}" r="7"/>` : ""}`,
  };
}
const mapNote = (map) =>
  map.nearby
    ? map.position
      ? "現在地と付近の交通"
      : "京都中心部 · 現在地は未取得"
    : map.place
      ? "駅・停留所の登録位置"
      : `${map.unavailable ? "経路変更・運休のため現在位置は未確認" : map.source === "location" ? "現在地を経路上に表示" : "現在地は時刻表から推定"}${map.approximate ? " · 路線は概略" : ""}`;
export function routeMapHTML(
  map,
  model,
  { expanded = false, interactive = expanded, controls = true } = {},
) {
  if (map.points.length < (map.place ? 1 : 2))
    return '<p class="source-note">経路の位置データは未取得です。停車順と時刻表で案内します。</p>';
  const key = JSON.stringify([map.points, map.stops.map((s) => s.id)]);
  mapData.set(key, { ...map, nextId: model.nextStation?.id, model });
  // Only keep current journey contexts, not a growing history of GPS updates.
  if (mapData.size > 6) mapData.delete(mapData.keys().next().value);
  const view = mapViewport(map.points),
    drawing = mapDrawing({ ...map, nextId: model.nextStation?.id }, view);
  return `<div class="route-map ${expanded ? "expanded" : ""} ${interactive ? "map-interactive" : ""}" data-map-key="${esc(key)}" data-line="${model.lineId}"><div class="map-canvas"><div class="map-tiles">${drawing.tiles}</div><svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="${map.nearby ? "group" : "img"}" aria-label="道路・地名を含む${model.bus ? "バス" : "鉄道"}の地図。${mapNote(map)}">${drawing.overlay}</svg>${controls ? '<div class="map-controls"><button data-map-zoom="1" aria-label="地図を拡大">＋</button><button data-map-zoom="-1" aria-label="地図を縮小">−</button><button data-map-reset aria-label="経路全体を表示">⌖</button></div>' : ""}<span class="map-load-note" hidden>背景地図を取得できません · ${map.place ? "登録位置" : "経路"}のみ表示</span><a class="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a></div><p>${mapNote(map)}</p></div>`;
}
function draw(element, map, view) {
  const svg = element.querySelector("svg");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${view.height ?? HEIGHT}`);
  const drawing = mapDrawing(map, view);
  updateHTML(element.querySelector(".map-tiles"), drawing.tiles);
  updateHTML(svg, drawing.overlay);
  viewports.set(element, view);
}
const savedViewports = new Map();
export function rememberMapViewport(host, key) {
  const element = host.querySelector(".route-map"),
    view = element && viewports.get(element);
  if (view) savedViewports.set(key, { ...view, center: [...view.center] });
  if (savedViewports.size > 24)
    savedViewports.delete(savedViewports.keys().next().value);
  return view;
}
export function restoreMapViewport(host, key, saved = null) {
  const valid =
    saved &&
    Number.isFinite(saved.zoom) &&
    saved.zoom >= 4 &&
    saved.zoom <= 18 &&
    Array.isArray(saved.center) &&
    saved.center.length === 2 &&
    saved.center.every(Number.isFinite);
  const element = host.querySelector(".route-map"),
    view = savedViewports.get(key) ?? (valid ? saved : null),
    map = element && mapData.get(element.dataset.mapKey);
  if (view && map) draw(element, map, view);
}
export function renderRouteMap(element, map, model, options = {}) {
  const key = JSON.stringify([map.points, map.stops.map((s) => s.id)]);
  const current = element.querySelector(".route-map");
  if (!current || current.dataset.mapKey !== key) {
    const previousView = current && viewports.get(current);
    updateHTML(
      element,
      routeMapHTML(map, model, {
        expanded: Boolean(current?.classList.contains("expanded")),
        ...options,
      }),
    );
    if (map.nearby && previousView)
      draw(element.querySelector(".route-map"), map, previousView);
    return;
  }
  const next = { ...map, nextId: model.nextStation?.id, model };
  mapData.set(key, next);
  // Preserve loaded background tiles and user pan/zoom on position refresh.
  for (const target of [
    current,
    ...document.querySelectorAll(".navigation-current .route-map.expanded"),
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
    let accuracy = target.querySelector(".map-accuracy");
    if (
      pos &&
      Number.isFinite(map.position?.accuracy) &&
      map.position.accuracy > 0
    ) {
      if (!accuracy) {
        accuracy = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        accuracy.setAttribute("class", "map-accuracy");
        target.querySelector("svg").prepend(accuracy);
      }
      accuracy.setAttribute("cx", pos[0]);
      accuracy.setAttribute("cy", pos[1]);
      accuracy.setAttribute(
        "r",
        Math.min(
          2048,
          map.position.accuracy /
            ((156543.03392 * Math.cos((map.position.lat * Math.PI) / 180)) /
              2 ** view.zoom),
        ),
      );
    } else accuracy?.remove();
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
    target
      .querySelector("svg")
      .setAttribute(
        "aria-label",
        `道路・地名を含む${model.bus ? "バス" : "鉄道"}の地図。${mapNote(map)}`,
      );
    [...target.querySelectorAll("[data-map-stop]")].forEach((stop, i) => {
      const point = stop.querySelector(".map-stop"),
        label = stop.querySelector("text");
      const x = Number(point.getAttribute("cx")),
        y = Number(point.getAttribute("cy"));
      label.toggleAttribute(
        "hidden",
        !(
          (i === 0 ||
            i === map.stops.length - 1 ||
            stop.dataset.mapStop === next.nextId) &&
          x >= 0 &&
          x <= WIDTH &&
          y >= 0 &&
          y <= (view.height ?? HEIGHT)
        ),
      );
    });
    updateHTML(target.querySelector("p"), mapNote(map));
  }
}
export function setupRouteMaps() {
  // Safari gesture events must not turn a map pinch into whole-page zoom.
  for (const type of ["gesturestart", "gesturechange", "gestureend"])
    document.addEventListener(
      type,
      (event) => {
        if (event.target.closest?.(".map-interactive")) event.preventDefault();
      },
      { passive: false },
    );
  const watched = new Set(),
    visible = new WeakSet();
  const loadTiles = (canvas) => {
    for (const tile of canvas.querySelectorAll(".map-tile:not([src])"))
      tile.src = tile.dataset.tileSrc;
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
          e.target.parentElement.querySelector("[data-tile-failed]"),
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
              4,
              Math.min(18, view.zoom + Number(button.dataset.mapZoom)),
            ),
          },
    );
  });
  const pointers = new Map();
  let drag = null,
    pinch = null;
  const resetLayers = (element) => {
    for (const layer of element.querySelectorAll("svg,.map-tiles"))
      layer.style.transform = "";
  };
  const gap = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  document.addEventListener("pointerdown", (e) => {
    const canvas = e.target.closest(".route-map.map-interactive .map-canvas");
    if (!canvas || e.target.closest("button,a")) return;
    const main = document.querySelector("main"),
      depth = Number(
        document.querySelector(".app-shell")?.dataset.navigationDepth,
      );
    if (depth > 0 && e.clientX < main.getBoundingClientRect().left + 24) return;
    const element = canvas.closest(".route-map"),
      map = mapData.get(element.dataset.mapKey);
    if (!map) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      resetLayers(element);
      pinch = {
        element,
        map,
        distance: gap(),
        view: viewports.get(element) ?? mapViewport(map.points),
      };
      drag = null;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
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
    if (pointers.has(e.pointerId))
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const scale = Math.max(0.5, Math.min(2, gap() / pinch.distance));
      for (const layer of pinch.element.querySelectorAll("svg,.map-tiles"))
        layer.style.transform = `scale(${scale})`;
      return;
    }
    if (!drag) return;
    drag.element.dataset.mapDragging = "true";
    drag.dx = e.clientX - drag.x;
    drag.dy = e.clientY - drag.y;
    for (const layer of drag.element.querySelectorAll("svg,.map-tiles"))
      layer.style.transform = `translate(${drag.dx}px,${drag.dy}px)`;
  });
  document.addEventListener("pointerup", (e) => {
    if (pinch) {
      const { element, map, view, distance } = pinch,
        scale = pointers.size === 2 ? gap() / distance : 1;
      resetLayers(element);
      draw(element, map, {
        ...view,
        zoom: Math.max(4, Math.min(18, view.zoom + Math.log2(scale))),
      });
      pinch = null;
      pointers.clear();
      drag = null;
      return;
    }
    pointers.delete(e.pointerId);
    if (!drag) return;
    const { element, map, view, width, height, dx = 0, dy = 0 } = drag;
    for (const layer of element.querySelectorAll("svg,.map-tiles"))
      layer.style.transform = "";
    draw(element, map, {
      ...view,
      center: [
        view.center[0] - (dx * WIDTH) / width / 2 ** view.zoom,
        view.center[1] -
          (dy * (view.height ?? HEIGHT)) / height / 2 ** view.zoom,
      ],
    });
    const moved = element;
    setTimeout(() => delete moved.dataset.mapDragging, 0);
    drag = null;
  });
  document.addEventListener("pointercancel", () => {
    if (pinch) resetLayers(pinch.element);
    pinch = null;
    pointers.clear();
    if (drag) delete drag.element.dataset.mapDragging;
    if (drag)
      for (const layer of drag.element.querySelectorAll("svg,.map-tiles"))
        layer.style.transform = "";
    drag = null;
  });
}
