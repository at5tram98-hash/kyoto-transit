import { ui } from "./locale.js";
import { setupSheetGestures } from "./context-sheet.js";
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
  const sheet = document.createElement("dialog");
  sheet.id = "trip-choice-sheet";
  sheet.className = "sheet";
  sheet.dataset.detent = "medium";
  sheet.setAttribute("aria-labelledby", "trip-choice-title");
  sheet.innerHTML = ui("route_trip_screen_001");
  document.body.append(sheet);
  setupSheetGestures();
  const body = sheet.querySelector(".sheet-body");
  let sheetRoute = null,
    opener = null;
  sheet.addEventListener("close", () => {
    if (sheetRoute) views.get(sheetRoute.key)?.controller?.abort();
    views.delete("trip-sheet");
    if (opener?.isConnected) {
      opener.setAttribute("aria-expanded", "false");
      opener.focus({ preventScroll: true });
    }
  });
  sheet.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-trip-close")) sheet.close();
    else if (button.dataset.tripChoice !== undefined && sheetRoute)
      void choose(body, sheetRoute, Number(button.dataset.tripChoice));
    else if (button.hasAttribute("data-more-trips") && sheetRoute) {
      navigation.push("departures", sheetRoute.params);
    } else if (button.hasAttribute("data-retry-trip") && sheetRoute) {
      views.delete(sheetRoute.key);
      void load(body, sheetRoute);
    }
  });
  const valid = (route) => {
    const data = getSnapshot(route.params.revision);
    return (
      data?.routes[route.params.index] &&
      (data.routeVersions?.[route.params.index] ?? 0) ===
        route.params.routeVersion
    );
  };
  const selectedDate = (leg) => leg.serviceDate ?? ui("route_trip_screen_002");
  function renderOptions(element, view) {
    const list = element.querySelector(".trip-choice-list");
    const current = Math.max(
      0,
      view.options.findIndex((o) => o.selected),
    );
    const options = view.options.map((o, i) => ({ o, i }));
    const visible = view.compact
      ? options.slice(Math.max(0, current - 1), Math.max(0, current - 1) + 4)
      : options;
    list.innerHTML = view.options.length
      ? `<div class="native-list">${visible
          .map(({ o, i }) => {
            const l = o.leg,
              picked = view.key ? view.key === o.key : o.selected;
            return ui("route_trip_screen_026", [
              picked ? "selected" : "",
              i,
              picked,
              o.available ? "" : "disabled",
              formatTime(l.depart),
              Number.isFinite(l.arrive)
                ? ui("route_trip_screen_003", [formatTime(l.arrive)])
                : ui("route_trip_screen_004"),
              esc(
                l.route
                  ? ui("route_trip_screen_005", [l.route])
                  : (operatorLabel[l.operator] ?? l.label),
              ),
              l.category === "express"
                ? ui("route_trip_screen_006")
                : l.category === "local"
                  ? ui("route_trip_screen_007")
                  : "",
              esc(l.destination ?? ui("route_trip_screen_008")),
              l.destination ? ui("route_trip_screen_009") : "",
              l.platform ? ui("route_trip_screen_010", [esc(l.platform)]) : "",
              esc(selectedDate(l)),
              o.selected ? ui("route_trip_screen_011") : "",
              l.dataConfidence === "stale" ? ui("route_trip_screen_012") : "",
              o.reason
                ? `<small class="trip-choice-reason">${esc(o.reason)}</small>`
                : "",
              picked
                ? '<svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg>'
                : "",
            ]);
          })
          .join("")}</div>`
      : ui("route_trip_screen_013");
    if (view.compact)
      list.insertAdjacentHTML("beforeend", ui("route_trip_screen_014"));
  }
  function renderPreview(element, view) {
    const preview = element.querySelector(".trip-change-preview"),
      footer = element.querySelector(".screen-bottom-action"),
      button = footer.querySelector("button");
    preview.hidden = !view.preview && !view.busy && !view.error;
    footer.hidden = view.compact || !view.key;
    button.disabled = !view.preview || view.busy;
    button.textContent = view.busy
      ? ui("route_trip_screen_015")
      : ui("route_trip_screen_016");
    if (view.busy) {
      preview.innerHTML = ui("route_trip_screen_017");
      return;
    }
    if (view.error) {
      preview.innerHTML = `<p class="planner-warning" role="alert">${esc(view.error)}</p>`;
      return;
    }
    if (!view.preview || view.compact) {
      preview.replaceChildren();
      return;
    }
    const change = journeyChange(view.original, view.preview),
      price = (n) =>
        Number.isFinite(n)
          ? ui("route_trip_screen_018", [n.toLocaleString("ja-JP")])
          : ui("route_trip_screen_019");
    preview.innerHTML = ui("route_trip_screen_027", [
      formatTime(view.original.time),
      formatTime(view.preview.time),
      view.original.transfers,
      view.preview.transfers,
      price(view.original.fare.additional),
      price(view.preview.fare.additional),
      change.changedTrips,
      change.deadline ? ui("route_trip_screen_020", [change.deadline]) : "",
      routeHTML(view.preview, network, [], 0, tokyoNow(), true, {
        readOnly: true,
        hideActions: true,
      }),
    ]);
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
      if (view.compact && valid(route)) {
        apply(route.params, view.preview, view.context);
        sheet.close();
      }
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
      element.innerHTML = ui("route_trip_screen_021");
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
      compact: route.key === "trip-sheet",
    };
    views.set(route.key, view);
    element.innerHTML = ui("route_trip_screen_022", [
      esc(network.stops.get(leg.from)?.name ?? leg.from),
      esc(network.stops.get(leg.to)?.name ?? leg.to),
      formatTime(leg.depart),
    ]);
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
            .map((m) => m.warning ?? ui("route_trip_screen_023")),
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
        element.querySelector(".trip-choice-list").innerHTML = ui(
          "route_trip_screen_024",
          [esc(error.message)],
        );
    } finally {
      view.loading = false;
    }
  }
  navigation.register("departures", {
    title: ui("route_trip_screen_025"),
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
  return {
    open(params) {
      views.get("trip-sheet")?.controller?.abort();
      views.delete("trip-sheet");
      sheetRoute = { type: "departures", key: "trip-sheet", params };
      opener = document.activeElement;
      opener?.setAttribute("aria-expanded", "true");
      sheet.dataset.detent =
        parseFloat(getComputedStyle(document.documentElement).fontSize) > 20
          ? "large"
          : "medium";
      sheet.showModal();
      void load(body, sheetRoute);
    },
  };
}
