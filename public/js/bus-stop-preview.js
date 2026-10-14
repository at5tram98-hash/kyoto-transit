import { esc } from "./vnext-state.js";
import { compactBusHTML } from "./vnext-arrivals.js";
import {
  getCached,
  fetchRealtime,
  createLiveLoop,
  isFresh,
} from "./realtime.js";
import { updateHTML } from "./view-rendering.js";

// A visible stop detail owns this loop. It uses the existing cache/network
// layer; leaving the screen stops it and does not change the arrivals picker.
export function mountBusStopPreview(host, stop) {
  let shown = false,
    disposed = false,
    controller = null,
    data = null,
    route = null;
  const city = stop.type === "citybus",
    name = stop.fullName ?? stop.name,
    key = `citybus:${name}`;
  function render({ updating = false, failed = false } = {}) {
    const filtered = data && {
        ...data,
        results: route
          ? data.results?.filter((r) => String(r.route) === route)
          : data.results,
      },
      rows = city && filtered ? compactBusHTML(filtered) : "",
      fresh = data && !data.stale && isFresh(data.asOf);
    const scroll = host.querySelector(".stop-route-chips")?.scrollLeft ?? 0,
      focus = document.activeElement?.dataset.previewRoute;
    updateHTML(
      host,
      `<h2>この停留所の接近情報</h2><div class="stop-route-chips" aria-label="利用系統"><button type="button" class="${route === null ? "active" : ""}" data-preview-route="" aria-pressed="${route === null}">すべて</button>${(stop.lines ?? []).map((r) => `<button type="button" class="${route === String(r) ? "active" : ""}" data-preview-route="${esc(r)}" aria-pressed="${route === String(r)}">${esc(r)}</button>`).join("")}</div>${rows || `<p class="source-note">${city ? (data ? "接近車両の時刻・位置を確認できません。全方面の状態を確認できます。" : updating ? "接近情報を確認中…" : "接近情報を取得できません。再試行できます。") : "この停留所の接近実測は未取得です。公式時刻表をご確認ください。"}</p>`}${updating && rows ? '<p class="source-caption" role="status">更新中…</p>' : ""}${data && !fresh ? '<p class="source-caption">保存した情報からの予測です。最新の接近を再確認してください。</p>' : ""}${failed && city ? '<button class="plain-action" data-preview-retry>再取得</button>' : ""}<button class="native-row" ${city ? `data-open-arrivals="${esc(stop.id)}"` : `data-open-timetable="${esc(stop.id)}"`}><span>${city ? "すべての接近情報" : "公式時刻表を見る"}</span><span class="chevron">›</span></button>`,
    );
    const chips = host.querySelector(".stop-route-chips");
    if (chips) chips.scrollLeft = scroll;
    if (focus !== undefined)
      [...host.querySelectorAll("[data-preview-route]")]
        .find((b) => b.dataset.previewRoute === focus)
        ?.focus({ preventScroll: true });
  }
  async function refresh() {
    controller?.abort();
    controller = new AbortController();
    const current = controller;
    render({ updating: true });
    try {
      const result = await fetchRealtime(
        key,
        "/api/citybus/arrivals",
        { stop: name },
        { signal: current.signal },
      );
      if (!shown || disposed || current.signal.aborted) return;
      data = result;
      render();
    } catch (error) {
      if (current.signal.aborted || !shown || disposed) return;
      if (error.cached?.data)
        data = { ...error.cached.data, stale: true, source: "prediction" };
      render({ failed: true });
      throw error;
    }
  }
  const loop = createLiveLoop({
    run: refresh,
    active: () => shown && !disposed && !document.hidden,
  });
  host.addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (b?.dataset.previewRoute !== undefined) {
      route = b.dataset.previewRoute || null;
      render();
    }
    if (b?.hasAttribute("data-preview-retry")) loop.poke();
  });
  return {
    async show() {
      shown = true;
      if (city && !data) {
        const cached = await getCached(key);
        if (shown && !disposed && cached?.data) data = cached.data;
      }
      if (!shown || disposed) return;
      render({ updating: city && !data });
      if (city) loop.start();
    },
    pause() {
      shown = false;
      controller?.abort();
      loop.stop();
    },
    dispose() {
      disposed = true;
      shown = false;
      controller?.abort();
      loop.stop();
    },
    get host() {
      return host;
    },
  };
}
