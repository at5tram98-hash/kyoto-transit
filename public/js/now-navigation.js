import { currentMotionEvidence } from "./motion-assist.js";
import { readSavedPlaces, toggleSavedPlace } from "./saved-places.js";
import { setupSheetGestures } from "./context-sheet.js";
import { trajectory } from "./riding.js";
import { mountBusStopPreview } from "./bus-stop-preview.js";
import { navigation } from "./navigation.js";
import {
  $,
  esc,
  state,
  tokyoNow,
  rideKey,
  persistJourney,
} from "./vnext-state.js";
import { renderNow, nearbyDetailHTML } from "./vnext-view.js";
import { stationDetailHTML } from "./context-sheet.js";
import {
  routeMapHTML,
  renderRouteMap,
  rememberMapViewport,
  restoreMapViewport,
} from "./route-map.js";
import { delayAnalysis } from "./now-model.js";
import { renderNetworkPanel } from "./vnext-network-view.js";
import { updateHTML } from "./view-rendering.js";
export function registerNowScreens({ arrivals, onFoldback }) {
  const source = (id) => {
    const node = $(id),
      home = node.parentElement;
    return {
      singleton: true,
      create() {
        node.hidden = false;
        return node;
      },
      onShow({ element }) {
        node.hidden = false;
        element.append(node);
      },
      onDispose({ element }) {
        if (node.parentElement === element) {
          node.hidden = true;
          home.append(node);
        }
      },
    };
  };
  navigation.register("stops", {
    ...source("#ride-stops-source"),
    title: () => (state.heroModel?.bus ? "停留所" : "停車駅"),
    onShow({ element }) {
      element.append($("#ride-stops-source"));
      $("#ride-stops-source").hidden = false;
      renderNow();
    },
  });
  navigation.register("trains", {
    ...source("#network-panel"),
    title: "列車位置",
    onShow({ element }) {
      element.append($("#network-panel"));
      $("#network-panel").hidden = false;
      return renderNetworkPanel(
        $("#network-panel"),
        state.ride,
        tokyoNow(),
      ).then(() => {
        const detail = $(".live-track-detail");
        if (detail) detail.open = true;
      });
    },
    update() {
      if (state.ride)
        void renderNetworkPanel($("#network-panel"), state.ride, tokyoNow());
    },
  });
  navigation.register("arrivals", {
    ...source("#arrivals-root"),
    title: "接近情報",
    onShow({ element, route }) {
      element.append($("#arrivals-root"));
      $("#arrivals-root").hidden = false;
      if (route.params.stopId)
        void arrivals.selectStop(route.params.stopId, true);
      void arrivals.show();
    },
    onHide() {
      arrivals.pause();
    },
    onDispose: source("#arrivals-root").onDispose,
  });
  const previews = new Map();
  function placeSurface(element, stop) {
    const position = state.geo.stops.find((s) => s.id === stop.id);
    const point =
      position && Number.isFinite(position.lng) && Number.isFinite(position.lat)
        ? [position.lng, position.lat]
        : null;
    element.classList.add("place-screen");
    element.innerHTML = `<div class="place-map" aria-label="${esc(stop.name)}の小地図">${point ? routeMapHTML({ points: [point], stops: [{ ...stop, ...position }], position: null, place: true, source: "schedule" }, { bus: stop.type.includes("bus"), lineId: stop.type === "subway" ? "K" : "B" }) : '<p class="source-note">地図の位置データは未取得です</p>'}</div><section class="place-sheet" data-detent="${parseFloat(getComputedStyle(document.documentElement).fontSize) > 20 ? "large" : "medium"}" aria-label="${esc(stop.name)}の次便と操作"><button type="button" class="sheet-drag-handle" aria-label="停留所詳細の高さを変更"><span></span></button><div class="sheet-header"><h2>${esc(stop.name)}</h2><button type="button" class="plain-action" data-save-place="${esc(stop.id)}" aria-pressed="${readSavedPlaces().includes(stop.id)}">${readSavedPlaces().includes(stop.id) ? "保存済み" : "保存"}</button></div><div class="sheet-body" data-place-content></div></section>`;
    const panel = element.querySelector(".place-sheet");
    panel.addEventListener("mymap-sheet-dismiss", () => navigation.pop());
    element.addEventListener("click", (e) => {
      const b = e.target.closest("[data-save-place]");
      if (b) {
        const saved = toggleSavedPlace(b.dataset.savePlace);
        b.textContent = saved ? "保存済み" : "保存";
        b.setAttribute("aria-pressed", String(saved));
      }
    });
    setupSheetGestures();
  }
  function fillStop(context, html, show = false) {
    const { element, route } = context,
      saved = previews.get(element),
      stop = state.network.stops.get(route.params.stopId),
      bus = stop?.type.includes("bus");
    if (bus && !element.querySelector("[data-place-content]"))
      placeSurface(element, stop);
    const content = element.querySelector("[data-place-content]") ?? element;
    updateHTML(content, html(route.params.stopId));
    const host = content.querySelector("[data-bus-stop-preview]");
    if (host && stop) host.dataset.operator = stop.type;
    if (!host || !stop) {
      saved?.dispose();
      previews.delete(element);
      return;
    }
    if (saved && host !== saved.host) host.replaceWith(saved.host);
    const preview = saved ?? mountBusStopPreview(host, stop);
    previews.set(element, preview);
    if (show) void preview.show();
  }
  const stopLifecycle = (html) => ({
    onShow(context) {
      fillStop(context, html, true);
    },
    update(context) {
      fillStop(context, html);
    },
    onHide({ element }) {
      previews.get(element)?.pause();
    },
    onDispose({ element }) {
      previews.get(element)?.dispose();
      previews.delete(element);
    },
  });
  const placeToolbar = (route) => {
    const stop = state.network.stops.get(route.params.stopId);
    if (!stop || stop.type.includes("bus")) return "";
    const saved = readSavedPlaces().includes(stop.id);
    return `<button type="button" class="plain-action" data-save-place="${esc(stop.id)}" aria-pressed="${saved}">${saved ? "保存済み" : "保存"}</button>`;
  };
  const onPlaceToolbar = ({ event }) => {
    const b = event.target.closest("[data-save-place]");
    if (b) {
      const saved = toggleSavedPlace(b.dataset.savePlace);
      b.textContent = saved ? "保存済み" : "保存";
      b.setAttribute("aria-pressed", String(saved));
    }
  };
  navigation.register("station", {
    toolbar: placeToolbar,
    onToolbar: onPlaceToolbar,
    title: (r) =>
      state.network.stops.get(r.params.stopId)?.name ?? "駅・停留所",
    create({ element }) {
      element.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.chooseDestination) {
          const stop = state.ride?.officialStops?.find(
            (s) => s.id === b.dataset.chooseDestination,
          );
          if (stop) {
            state.ride.userDestination = { id: stop.id, name: stop.name };
            persistJourney(true);
            renderNow();
            navigation.pop();
          }
        }
        if (b.hasAttribute("data-context-foldback")) onFoldback();
      });
    },
    ...stopLifecycle(stationDetailHTML),
  });
  navigation.register("nearby", {
    toolbar: placeToolbar,
    onToolbar: onPlaceToolbar,
    title: (r) => state.network.stops.get(r.params.stopId)?.name ?? "近く",
    ...stopLifecycle(nearbyDetailHTML),
  });
  const fillDelay = ({ element }) => {
    if (!state.heroModel) return;
    const a = delayAnalysis(state.heroModel, state.delayHistory),
      samples = a.samples,
      points = samples
        .map(
          (s, i) =>
            `${20 + (i * 260) / Math.max(1, samples.length - 1)},${95 - Math.max(-5, Math.min(15, s.shift)) * 4}`,
        )
        .join(" ");
    updateHTML(
      element,
      `<section class="section-block"><h2>${esc(a.conclusion)}</h2><p class="source-note">My Mapの推定です。公式の運行情報とは区別して表示します。</p><dl class="context-facts"><div><dt>時刻表</dt><dd>公式の予定時刻</dd></div><div><dt>現在位置</dt><dd>${state.heroModel.locationConfidence === "available" ? "GPSと停車位置を照合" : "未取得。ダイヤから推定"}</dd></div><div><dt>接近情報</dt><dd>${state.heroModel.dataSources.includes("接近") ? "取得データを参照" : "実測データは未取得"}</dd></div></dl><details class="ride-diagnostics"><summary>位置情報・乗車判定の詳細</summary><dl class="context-facts"><div><dt>GPS精度</dt><dd>${Number.isFinite(state.fix?.accuracy) ? `${Math.round(state.fix.accuracy)}m` : "未取得"}</dd></div><div><dt>速度</dt><dd>${Number.isFinite(trajectory(state.samples).speed) ? `${(trajectory(state.samples).speed * 3.6).toFixed(1)}km/h` : "未取得"}</dd></div><div><dt>加速度</dt><dd>${Number.isFinite(currentMotionEvidence().peakAcceleration) ? `${currentMotionEvidence().peakAcceleration.toFixed(2)}m/s²` : "未取得"}</dd></div><div><dt>一致度</dt><dd>${Number.isFinite(state.rideConfidence) ? `${Math.round(state.rideConfidence)} / 100` : "未確認"}</dd></div><div><dt>判定根拠</dt><dd>${esc(state.rideSource ?? "未確認")}</dd></div></dl></details>${samples.length > 1 ? `<svg class="delay-chart" viewBox="0 0 300 120" role="img" aria-label="観測した遅れの推移、推定"><path d="M20 95H280" class="map-grid"/><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="3"/></svg>` : '<p class="source-note">推移を表示するための観測データがまだ不足しています。</p>'}</section>`,
    );
  };
  navigation.register("delay", {
    title: "遅延分析",
    onShow: fillDelay,
    update: fillDelay,
  });
  navigation.register("map", {
    title: "地図と現在地",
    fullscreen: true,
    onShow({ element, route }) {
      const nearby = route.params.nearby;
      const mapData = nearby ? state.nearbyMap : state.routeMap,
        model = nearby ? { bus: false, lineId: "nearby" } : state.heroModel;
      if (!mapData) return;
      const map = element.querySelector(".route-map");
      if (!map) {
        element.innerHTML = routeMapHTML(mapData, model, {
          expanded: true,
        });
        const key =
            route.params.journey ??
            (state.ride ? rideKey(state.ride) : "nearby"),
          saved = navigation.recalled("map-viewport");
        restoreMapViewport(
          element,
          key,
          saved?.journey === key ? saved.view : null,
        );
      } else renderRouteMap(element, mapData, model);
    },
    update({ element, route }) {
      const map = route.params.nearby ? state.nearbyMap : state.routeMap;
      if (map)
        renderRouteMap(
          element,
          map,
          route.params.nearby
            ? { bus: false, lineId: "nearby" }
            : state.heroModel,
        );
    },
    capture({ element, route }) {
      const key =
          route.params.journey ?? (state.ride ? rideKey(state.ride) : "nearby"),
        view = rememberMapViewport(element, key);
      if (view) navigation.remember("map-viewport", { journey: key, view });
    },
  });
  const nowRoot = $('[data-view="now"]');
  nowRoot.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-navigation-screen]");
    if (!b || !nowRoot.contains(b)) return;
    navigation.push(b.dataset.navigationScreen, {
      journey: state.ride ? rideKey(state.ride) : null,
      id: state.ride?.operator,
    });
  });
}
export function validNowScreen(route) {
  if (route.type === "map" && route.params.nearby) return true;
  if (["stops", "station", "map", "delay", "trains"].includes(route.type))
    return (
      Boolean(state.ride) &&
      (!route.params.journey || route.params.journey === rideKey(state.ride))
    );
  if (
    ["station", "nearby", "board"].includes(route.type) &&
    route.params.stopId
  )
    return state.network.stops.has(route.params.stopId);
  return true;
}
