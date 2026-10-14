import { navigation } from "./navigation.js";
import { esc } from "./vnext-state.js";
import { formatTime } from "./router.js";
import { routeHTML, operatorLabel } from "./route-search-view.js";
import { journeyChange } from "./journey-plan.js";

// Own the selection screen, not the shared document click router. A preview
// never changes the result snapshot until the bottom action is confirmed.
export function registerTripChoice({
  network,
  getSnapshot,
  getContext,
  plan,
  apply,
  tokyoNow,
}) {
  const views = new Map();
  const valid = (route) => {
    const data = getSnapshot(route.params.revision);
    return (
      data?.routes[route.params.index] &&
      (data.routeVersions?.[route.params.index] ?? 0) ===
        route.params.routeVersion
    );
  };
  const selectedDate = (leg) => leg.serviceDate ?? "運行日未取得";
  function renderOptions(element, view) {
    const list = element.querySelector(".trip-choice-list");
    list.innerHTML = view.options.length
      ? `<div class="native-list">${view.options
          .map((o, i) => {
            const l = o.leg,
              picked = view.key === o.key;
            return `<button type="button" class="trip-choice-row ${picked ? "selected" : ""}" data-trip-choice="${i}" aria-pressed="${picked}" ${o.available ? "" : "disabled"}><span class="trip-choice-times"><b>${formatTime(l.depart)}</b><small>${Number.isFinite(l.arrive) ? `${formatTime(l.arrive)}着` : "到着未取得"}</small></span><span class="trip-choice-description"><b>${esc(l.route ? `${l.route}系統` : (operatorLabel[l.operator] ?? l.label))}${l.category === "express" ? " · 急行" : l.category === "local" ? " · 普通" : ""}</b><small>${esc(l.destination ?? "行先未確認")}${l.destination ? "行" : ""}${l.platform ? ` · ${esc(l.platform)}のりば` : ""}</small><small>${esc(selectedDate(l))}運行${o.selected ? " · 現在の便" : ""}${l.dataConfidence === "stale" ? " · 保存ダイヤ" : ""}</small>${o.reason ? `<small class="trip-choice-reason">${esc(o.reason)}</small>` : ""}</span><span class="trip-choice-check" aria-hidden="true">${picked ? "✓" : ""}</span></button>`;
          })
          .join("")}</div>`
      : '<p class="empty-state">この区間の別便を取得できません。元の経路は保持しています。</p>';
  }
  function renderPreview(element, view) {
    const preview = element.querySelector(".trip-change-preview"),
      footer = element.querySelector(".screen-bottom-action"),
      button = footer.querySelector("button");
    preview.hidden = !view.preview && !view.busy && !view.error;
    footer.hidden = !view.key;
    button.disabled = !view.preview || view.busy;
    button.textContent = view.busy ? "接続を再計算中…" : "この便で経路を更新";
    if (view.busy) {
      preview.innerHTML =
        '<p class="loading-note" role="status">後続の乗換・到着時刻・運賃を再計算しています…</p>';
      return;
    }
    if (view.error) {
      preview.innerHTML = `<p class="planner-warning" role="alert">${esc(view.error)}</p>`;
      return;
    }
    if (!view.preview) {
      preview.replaceChildren();
      return;
    }
    const change = journeyChange(view.original, view.preview),
      price = (n) =>
        Number.isFinite(n) ? `${n.toLocaleString("ja-JP")}円` : "未確認";
    preview.innerHTML = `<h2>変更後の旅程</h2><dl class="context-facts"><div><dt>到着</dt><dd>${formatTime(view.original.time)} → ${formatTime(view.preview.time)}</dd></div><div><dt>乗換</dt><dd>${view.original.transfers}回 → ${view.preview.transfers}回</dd></div><div><dt>追加運賃</dt><dd>${price(view.original.fare.additional)} → ${price(view.preview.fare.additional)}</dd></div></dl><p class="source-caption">${change.changedTrips}区間の便を更新。徒歩・滞在・乗換余裕・定期区間も再計算しました。</p>${change.deadline ? `<p class="planner-warning">元の到着指定より${change.deadline}分遅くなります。</p>` : ""}${routeHTML(view.preview, network, [], 0, tokyoNow(), true, { readOnly: true, hideActions: true })}`;
  }
  async function choose(element, route, index) {
    const view = views.get(route.key),
      option = view?.options[index];
    if (!option?.available || !valid(route)) return;
    view.controller?.abort();
    view.controller = new AbortController();
    const controller = view.controller;
    view.key = option.key;
    view.busy = true;
    view.error = "";
    view.preview = null;
    renderOptions(element, view);
    renderPreview(element, view);
    try {
      const result = await plan(
        view.context,
        {
          action: "replace-leg",
          journey: view.original,
          legIndex: route.params.legIndex,
          choiceKey: option.key,
        },
        controller.signal,
      );
      if (controller.signal.aborted || !valid(route)) return;
      view.preview = result.journey;
    } catch (error) {
      if (!controller.signal.aborted) view.error = error.message;
    } finally {
      if (!controller.signal.aborted) {
        view.busy = false;
        renderPreview(element, view);
      }
    }
  }
  async function load(element, route) {
    const data = getSnapshot(route.params.revision),
      original = data?.routes[route.params.index],
      leg = original?.legs[route.params.legIndex];
    if (!valid(route) || leg?.kind !== "ride") {
      element.innerHTML =
        '<p class="empty-state">経路が更新されています。経路詳細へ戻り、便を選び直してください。</p>';
      return;
    }
    let view = views.get(route.key);
    if (view?.ready && !view.loading) {
      if (!element.querySelector(".trip-choice-list")) view = null;
      else return;
    }
    view?.controller?.abort();
    view = {
      original: structuredClone(original),
      key: null,
      options: [],
      controller: new AbortController(),
      loading: true,
    };
    views.set(route.key, view);
    element.innerHTML = `<p class="trip-choice-intro"><b>${esc(network.stops.get(leg.from)?.name ?? leg.from)} → ${esc(network.stops.get(leg.to)?.name ?? leg.to)}</b><small>現在 ${formatTime(leg.depart)}発 · 前後の便を選択</small></p><p class="source-caption" data-trip-feed-note></p><div class="trip-choice-list"><p class="loading-note">公式の時刻表を確認中…</p></div><section class="trip-change-preview" hidden aria-live="polite"></section><footer class="screen-bottom-action" hidden><button type="button" class="primary-action" data-apply-trip disabled>この便で経路を更新</button></footer>`;
    try {
      view.context = await getContext(
        data,
        route.params.legIndex,
        view.controller.signal,
      );
      const result = await plan(
        view.context,
        {
          action: "trip-options",
          journey: original,
          legIndex: route.params.legIndex,
        },
        view.controller.signal,
      );
      if (view.controller.signal.aborted || !valid(route)) return;
      // Keep the current departure within a finite window of the list.
      const all = result.options,
        current = all.findIndex((o) => o.selected),
        start = Math.max(0, current - 12);
      view.options = all.slice(start, start + 60);
      element.querySelector("[data-trip-feed-note]").textContent = [
        ...new Set(
          (result.feedMeta ?? [])
            .filter((m) => m.stale || m.warning)
            .map(
              (m) => m.warning ?? "保存したダイヤです。変更をご確認ください。",
            ),
        ),
      ].join(" ");
      renderOptions(element, view);
      view.ready = true;
      const saved = (navigation.recalled("trip-drafts") ?? []).find(
        (d) => d.screen === route.key,
      );
      const index =
        saved?.version === route.params.routeVersion
          ? view.options.findIndex((o) => o.key === saved.key)
          : -1;
      if (index >= 0) await choose(element, route, index);
    } catch (error) {
      if (!view.controller.signal.aborted)
        element.querySelector(".trip-choice-list").innerHTML =
          `<p class="planner-warning" role="alert">${esc(error.message)}</p><button class="plain-action" data-retry-trip>再取得</button>`;
    } finally {
      view.loading = false;
    }
  }
  navigation.register("departures", {
    title: "便を変更",
    create({ element, route }) {
      element.addEventListener("click", (event) => {
        const target = event.target.closest("button");
        if (!target) return;
        if (target.dataset.tripChoice !== undefined)
          void choose(element, route, Number(target.dataset.tripChoice));
        else if (target.hasAttribute("data-retry-trip")) {
          views.delete(route.key);
          void load(element, route);
        } else if (target.hasAttribute("data-apply-trip")) {
          const view = views.get(route.key);
          if (view?.preview && valid(route) && !view.busy) {
            apply(route.params, view.preview, view.context);
            navigation.pop();
          }
        }
      });
    },
    onShow: ({ element, route }) => load(element, route),
    capture({ route }) {
      const view = views.get(route.key);
      if (view?.key)
        navigation.remember(
          "trip-drafts",
          [
            ...(navigation.recalled("trip-drafts") ?? []).filter(
              (d) => d.screen !== route.key,
            ),
            {
              screen: route.key,
              key: view.key,
              version: route.params.routeVersion,
            },
          ].slice(-5),
        );
    },
    onHide({ route }) {
      const view = views.get(route.key);
      view?.controller?.abort();
      if (view?.busy) {
        view.busy = false;
        view.preview = null;
        view.ready = false;
      }
    },
    onDispose({ route }) {
      views.get(route.key)?.controller?.abort();
      views.delete(route.key);
    },
  });
}
