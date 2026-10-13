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
  const fillStation = ({ element, route }) =>
    updateHTML(element, stationDetailHTML(route.params.stopId));
  navigation.register("station", {
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
    onShow: fillStation,
    update: fillStation,
  });
  const fillNearby = ({ element, route }) =>
    updateHTML(element, nearbyDetailHTML(route.params.stopId));
  navigation.register("nearby", {
    title: (r) => state.network.stops.get(r.params.stopId)?.name ?? "近く",
    onShow: fillNearby,
    update: fillNearby,
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
      `<section class="section-block"><h2>${esc(a.conclusion)}</h2><p class="source-note">My Mapの推定です。公式の運行情報とは区別して表示します。</p><dl class="context-facts"><div><dt>時刻表</dt><dd>公式の予定時刻</dd></div><div><dt>現在位置</dt><dd>${state.heroModel.locationConfidence === "available" ? "GPSと停車位置を照合" : "未取得。ダイヤから推定"}</dd></div><div><dt>接近情報</dt><dd>${state.heroModel.dataSources.includes("接近") ? "取得データを参照" : "実測データは未取得"}</dd></div></dl>${samples.length > 1 ? `<svg class="delay-chart" viewBox="0 0 300 120" role="img" aria-label="観測した遅れの推移、推定"><path d="M20 95H280" class="map-grid"/><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="3"/></svg>` : '<p class="source-note">推移を表示するための観測データがまだ不足しています。</p>'}</section>`,
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
      if (!state.routeMap) return;
      const map = element.querySelector(".route-map");
      if (!map) {
        element.innerHTML = routeMapHTML(state.routeMap, state.heroModel, {
          expanded: true,
        });
        const key = route.params.journey ?? rideKey(state.ride),
          saved = navigation.recalled("map-viewport");
        restoreMapViewport(
          element,
          key,
          saved?.journey === key ? saved.view : null,
        );
      } else renderRouteMap(element, state.routeMap, state.heroModel);
    },
    update({ element }) {
      if (state.routeMap)
        renderRouteMap(element, state.routeMap, state.heroModel);
    },
    capture({ element, route }) {
      const key = route.params.journey ?? rideKey(state.ride),
        view = rememberMapViewport(element, key);
      if (view) navigation.remember("map-viewport", { journey: key, view });
    },
  });
  const nowRoot = $('[data-view="now"]');
  nowRoot.addEventListener("click", (e) => {
    const b = e.target.closest("[data-navigation-screen]");
    if (!b) return;
    navigation.push(b.dataset.navigationScreen, {
      journey: state.ride ? rideKey(state.ride) : null,
      id: state.ride?.operator,
    });
  });
}
export function validNowScreen(route) {
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
