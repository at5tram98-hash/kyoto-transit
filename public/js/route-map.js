import { ui } from "./locale.js";
import { freshFix } from "./riding.js";
import { distance } from "./mobility.js";
import { esc } from "./vnext-state.js";
import { updateHTML } from "./view-rendering.js";
import { busPosition } from "./bus-radar.js";

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
  viewports = new WeakMap(),
  positionedMaps = new WeakSet();
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
export function nearbyMapModel(geo, near, fix, network, radar = null) {
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
  const anchor = origin;
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
    // Live buses approaching the nearest stop (RTM), and that stop.
    buses: radar?.buses ?? [],
    radarStopId: radar?.stopId ?? null,
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
      return `<g data-map-stop="${esc(s.id)}" data-operator="${esc(s.operator ?? "")}"${map.nearby ? ui("route_map_001", [esc(s.name)]) : ""}>${map.nearby ? `<circle cx="${x}" cy="${y}" r="26" fill="transparent"/>` : ""}<circle cx="${x}" cy="${y}" r="4" class="map-stop"/><text ${label ? "" : "hidden"} x="${Math.max(5, Math.min(WIDTH - 5, x))}" y="${Math.max(16, Math.min((view.height ?? HEIGHT) - 8, y - 10))}" text-anchor="${x < 80 ? "start" : x > WIDTH - 80 ? "end" : "middle"}">${esc(s.name.replace(/（[^）]+）/g, "").replace(ui("route_map_002"), "BT"))}</text></g>`;
    })
    .join("");
  // RTM: each approaching bus as a route plate at its reported stop. Plates
  // are placed greedily so none overlaps another (busy terminals such as
  // Kyoto Station report many buses at once); a stem joins plate and stop.
  const placed = [];
  const overlaps = (box) =>
    placed.some(
      (p) => box.x < p.x + p.w + 2 && p.x < box.x + box.w + 2 && box.y < p.y + p.h + 2 && p.y < box.y + box.h + 2,
    );
  // Each bus is drawn round its own origin and moved by a CSS transform, so
  // the clock can glide it between stops without redrawing (moveRadarBuses).
  const buses = (map.buses ?? [])
    .map((b, i) => {
      const at = b.to ? busPosition(b) : b,
        [x, y] = xy([at.lng, at.lat]),
        label = `${b.route}${b.rotation === "cw" ? "↻" : b.rotation === "ccw" ? "↺" : b.side === "kou" ? "甲" : b.side === "otsu" ? "乙" : ""}`,
        away = b.stopsAway === 0 ? ui("radar_at_stop") : ui("radar_stops_away", [b.stopsAway]),
        w = Math.max(30, 12 + label.length * 9),
        total = w + 4 + away.length * (/[\u3040-\u9fff]/.test(away) ? 10 : 6),
        offsets = [0, 1, 2, 3, 4, 5].flatMap((row) =>
          [0, 1, -1].map((col) => [col * (total + 4), -16 - row * 22]),
        );
      let box = null;
      for (const [dx, dy] of offsets) {
        const candidate = { x: x + dx - w / 2, y: y + dy - 9, w: total, h: 18 };
        if (!overlaps(candidate)) {
          box = candidate;
          break;
        }
      }
      if (!box) return "";
      placed.push(box);
      const bx = box.x - x,
        by = box.y - y,
        cx = bx + w / 2;
      return `<g class="map-bus${b.stopsAway <= 1 ? " imminent" : ""}" data-bus-index="${i}" data-line="${esc(b.kind)}" style="transform:translate(${x.toFixed(1)}px,${y.toFixed(1)}px)" role="img" aria-label="${esc(ui("radar_bus_label", [b.rotation ? `${b.route} ${ui(`bus_rotation_${b.rotation}`)}` : b.side ? `${b.route} ${ui(`bus_side_${b.side}`)}` : String(b.route), b.dest, away]))}"><line class="map-bus-stem" x1="0" y1="0" x2="${cx}" y2="${by + 18}"/><circle class="map-bus-anchor" cx="0" cy="0" r="5"/><rect class="map-bus-plate" x="${bx}" y="${by}" width="${w}" height="18" rx="5"/><text class="map-bus-route" x="${cx}" y="${by + 13}" text-anchor="middle">${esc(label)}</text><text class="map-bus-away" x="${bx + w + 3}" y="${by + 13}">${esc(away)}</text></g>`;
    })
    .join("");
  const radarRing = (() => {
    const s = map.radarStopId && map.stops.find((x) => x.id === map.radarStopId);
    if (!s) return "";
    const [x, y] = xy([s.lng, s.lat]);
    return `<circle class="map-radar-stop" cx="${x}" cy="${y}" r="9"/>`;
  })();
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
    // The live bus layer is drawn separately so its updates never replace
    // the base map (stops, position) underneath.
    base: `${lines}${accuracy}${map.place ? "" : `<polyline points="${map.points.map((p) => xy(p).join(",")).join(" ")}" class="map-path"/>`}${stops}${pos ? `<circle class="map-position" cx="${pos[0]}" cy="${pos[1]}" r="7"/>` : ""}`,
    radar: `${radarRing}${buses}`,
    project: xy,
    get overlay() {
      return `<g data-map-base>${this.base}</g><g data-map-radar>${this.radar}</g>`;
    },
  };
}
const mapNote = (map) =>
  map.nearby
    ? map.position
      ? ui("route_map_003")
      : ui("route_map_004")
    : map.place
      ? ui("route_map_005")
      : `${map.unavailable ? ui("route_map_006") : map.source === "location" ? ui("route_map_007") : ui("route_map_008")}${map.approximate ? ui("route_map_009") : ""}`;
export function routeMapHTML(
  map,
  model,
  { expanded = false, interactive = expanded, controls = true } = {},
) {
  if (map.points.length < (map.place ? 1 : 2)) return ui("route_map_010");
  const key = map.nearby
    ? "nearby"
    : JSON.stringify([map.points, map.stops.map((s) => s.id)]);
  mapData.set(key, { ...map, nextId: model.nextStation?.id, model });
  // Only keep current journey contexts, not a growing history of GPS updates.
  if (mapData.size > 6) mapData.delete(mapData.keys().next().value);
  const view = mapViewport(map.points),
    drawing = mapDrawing({ ...map, nextId: model.nextStation?.id }, view);
  return ui("route_map_018", [
    expanded ? "expanded" : "",
    interactive ? "map-interactive" : "",
    esc(key),
    model.lineId,
    drawing.tiles,
    WIDTH,
    HEIGHT,
    map.nearby ? "group" : "img",
    model.bus ? ui("route_map_011") : ui("route_map_012"),
    mapNote(map),
    drawing.overlay,
    controls ? ui("route_map_013") : "",
    map.place ? ui("route_map_014") : ui("route_map_015"),
    mapNote(map),
  ]);
}
function draw(element, map, view) {
  if (map.nearby && map.position && !positionedMaps.has(element)) {
    view = mapViewport(map.points, view.height ?? HEIGHT);
    positionedMaps.add(element);
  }
  const svg = element.querySelector("svg");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${view.height ?? HEIGHT}`);
  const drawing = mapDrawing(map, view);
  if (map.nearby) svg.setAttribute("aria-label", mapNote(map));
  updateHTML(element.querySelector(".map-tiles"), drawing.tiles);
  const base = svg.querySelector(":scope > [data-map-base]"),
    radar = svg.querySelector(":scope > [data-map-radar]");
  if (base && radar) {
    updateHTML(base, drawing.base);
    updateHTML(radar, drawing.radar);
  } else updateHTML(svg, drawing.overlay);
  trackRadar(svg.querySelector(":scope > [data-map-radar]"), map.buses, drawing.project);
  viewports.set(element, view);
}
// RTM motion: once a second each drawn bus is moved to where it is now
// estimated to be; the CSS transition makes the step a glide.
const radarLayers = new Map();
let radarClock = 0;
function trackRadar(layer, buses, project) {
  if (!layer) return;
  if (buses?.some((b) => b.to)) radarLayers.set(layer, { buses, project });
  else radarLayers.delete(layer);
  if (radarLayers.size && !radarClock) radarClock = setInterval(moveRadarBuses, 1000);
}
export function moveRadarBuses(now = Date.now()) {
  if (globalThis.document?.hidden) return;
  for (const [layer, { buses, project }] of radarLayers) {
    if (!layer.isConnected) {
      radarLayers.delete(layer);
      continue;
    }
    for (const g of layer.querySelectorAll("[data-bus-index]")) {
      const bus = buses[Number(g.dataset.busIndex)];
      if (!bus?.to) continue;
      const at = busPosition(bus, now),
        [x, y] = project([at.lng, at.lat]);
      g.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    }
  }
  if (!radarLayers.size) {
    clearInterval(radarClock);
    radarClock = 0;
  }
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
  if (view && map) {
    if (map.nearby) positionedMaps.add(element);
    draw(element, map, view);
  }
}
export function renderRouteMap(element, map, model, options = {}) {
  const key = map.nearby
    ? "nearby"
    : JSON.stringify([map.points, map.stops.map((s) => s.id)]);
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
  if (map.nearby) {
    draw(current, next, viewports.get(current) ?? mapViewport(map.points));
    updateHTML(current.querySelector("p"), mapNote(map));
    return;
  }
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
        ui("route_map_019", [
          model.bus ? ui("route_map_016") : ui("route_map_017"),
          mapNote(map),
        ]),
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
