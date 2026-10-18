import { ui as screenText } from "./locale.js";
import {
  NAV_TABS,
  restoreNavigation,
  currentRoute,
  navigationTransition,
  swipeDecision,
} from "./navigation-core.js";
import { transition, settleSwipe } from "./navigation-motion.js";
const registry = new Map(),
  STORE = "mymap-navigation-v1";
let controller;
export const navigation = {
  register(type, config) {
    registry.set(type, config);
  },
  push(type, params = {}) {
    return controller?.push(type, params);
  },
  pop() {
    return controller?.pop();
  },
  dismissSheet() {
    return controller?.dismissSheet() ?? Promise.resolve();
  },
  root(tab) {
    return controller?.root(tab);
  },
  selectTab(tab) {
    return controller?.selectTab(tab);
  },
  refresh() {
    controller?.refresh();
  },
  get route() {
    return controller?.route ?? { type: "root", params: {} };
  },
  get tab() {
    return controller?.tab ?? "now";
  },
  get ready() {
    return Boolean(controller);
  },
  contains(type) {
    return controller?.contains(type) ?? false;
  },
  remember(key, value) {
    controller?.remember(key, value);
  },
  recalled(key) {
    return controller?.recalled(key);
  },
};
export function initializeNavigation({
  onTabChange,
  validate = () => true,
} = {}) {
  const shell = document.querySelector(".app-shell"),
    viewport = document.querySelector("main"),
    back = document.querySelector("[data-navigation-back]");
  const roots = new Map(
    NAV_TABS.map((t) => [t, document.querySelector(`[data-view="${t}"]`)]),
  );
  roots.forEach((el) => (el.tabIndex = -1));
  const details = document.createElement("div");
  details.className = "navigation-details";
  viewport.append(details);
  const edge = document.createElement("div");
  edge.className = "navigation-edge";
  edge.setAttribute("aria-hidden", "true");
  viewport.append(edge);
  let saved = {};
  try {
    const value = JSON.parse(sessionStorage.getItem(STORE) || "{}");
    if (value && typeof value === "object" && !Array.isArray(value))
      saved = value;
  } catch {}
  let state = restoreNavigation(
      history.state?.mymapNavigation?.state ?? saved.state,
    ),
    ui =
      saved.ui && typeof saved.ui === "object" && !Array.isArray(saved.ui)
        ? saved.ui
        : {},
    memory =
      saved.memory &&
      typeof saved.memory === "object" &&
      !Array.isArray(saved.memory)
        ? saved.memory
        : {};
  // Back restores an older history snapshot. New pushes still need fresh IDs;
  // otherwise a cached screen's controller can retain different parameters.
  let sequenceCeiling = Math.max(
    state.sequence,
    ...Object.keys(ui)
      .map((key) => Number(key.split(":")[1]))
      .filter((n) => Number.isSafeInteger(n) && n >= 0 && n < 1e9),
  );
  const frames = new Map(),
    titles = {
      now: document.documentElement.lang === "en" ? "Now" : "今",
      search: screenText("navigation_001"),
      timetable: screenText("navigation_002"),
      operations: screenText("navigation_003"),
      settings: screenText("navigation_004"),
    };
  let busy = false,
    queued = null,
    epoch = 0,
    drag = null,
    refreshFrame = 0,
    saveTimer = 0,
    sheet = null,
    sheetBack = false,
    pending = null,
    skipPop = false,
    historyRestore = null,
    tabRestore = null;
  history.scrollRestoration = "manual";
  shell.classList.add("navigation-app");
  function capture() {
    const route = currentRoute(state),
      element =
        route.type === "root"
          ? roots.get(state.tab)
          : frames.get(route.key)?.element;
    if (!element) return;
    const fields = [
      ...element.querySelectorAll("input,select,textarea,details"),
    ]
      .filter(
        (e) => !getFrame(route)?.config?.ownsFields || e.tagName === "DETAILS",
      )
      .filter(
        (e) =>
          !e.matches(
            "[data-setting],[data-setting-value],[data-setting-range]",
          ),
      )
      .map((e) => ({
        id: e.id || null,
        name: e.name || null,
        value:
          e.tagName === "DETAILS"
            ? e.open
            : e.type === "checkbox"
              ? e.checked
              : e.value,
      }))
      .filter(
        (f) =>
          (f.id || f.name) &&
          (typeof f.value !== "string" || f.value.length <= 2048),
      )
      .slice(0, 40);
    const focused = document.activeElement;
    let focusSelector = null;
    if (focused instanceof HTMLElement && element.contains(focused)) {
      if (focused.id) focusSelector = `#${CSS.escape(focused.id)}`;
      else if (focused.getAttribute("name"))
        focusSelector = `[name="${CSS.escape(focused.getAttribute("name"))}"]`;
      else {
        const attributes = [
          "data-change-leg",
          "data-change-route",
          "data-open-route",
          "data-station-detail",
          "data-navigation-screen",
          "data-result-order",
          "data-search-date",
          "data-search-filter",
          "data-timetable-entry",
          "data-setting-page",
        ].filter((key) => focused.hasAttribute(key));
        if (attributes.length)
          focusSelector =
            focused.tagName.toLowerCase() +
            (focused.classList[0]
              ? `.${CSS.escape(focused.classList[0])}`
              : "") +
            attributes
              .map(
                (key) => `[${key}="${CSS.escape(focused.getAttribute(key))}"]`,
              )
              .join("");
      }
    }
    ui[route.key] = {
      focusSelector,
      contextIdentity: element.dataset.contextIdentity ?? null,
      scroll: element.scrollTop,
      fields,
      focus: document.activeElement,
    };
    getFrame(route)?.config?.capture?.({ element, route });
  }
  function save() {
    try {
      const serial = Object.fromEntries(
        Object.entries(ui)
          .slice(-40)
          .map(([k, v]) => [
            k,
            {
              scroll: v.scroll,
              fields: v.fields,
              focusSelector: v.focusSelector,
              contextIdentity: v.contextIdentity,
            },
          ]),
      );
      const value = JSON.stringify({
        state: {
          ...state,
          sequence: Math.max(state.sequence, sequenceCeiling),
        },
        ui: serial,
        memory,
      });
      if (value.length < 500000) sessionStorage.setItem(STORE, value);
    } catch {}
  }
  function restoreUI(element, key, focus = false) {
    const data = ui[key];
    if (!data) return;
    const adapter = key.startsWith("root:")
      ? registry.get(key)
      : frames.get(key)?.config;
    if (
      element.dataset.contextIdentity &&
      data.contextIdentity !== element.dataset.contextIdentity
    ) {
      data.scroll = 0;
      data.focus = null;
      data.focusSelector = null;
      data.contextIdentity = element.dataset.contextIdentity;
    }
    for (const f of (Array.isArray(data.fields) ? data.fields : []).slice(
      0,
      40,
    )) {
      if (!f || typeof f !== "object") continue;
      const el =
        typeof f.id === "string"
          ? element.querySelector(`#${CSS.escape(f.id)}`)
          : typeof f.name === "string"
            ? element.querySelector(`[name="${CSS.escape(f.name)}"]`)
            : null;
      if (
        !el ||
        (adapter?.ownsFields && el.tagName !== "DETAILS") ||
        el.matches("[data-setting],[data-setting-value],[data-setting-range]")
      )
        continue;
      if (el.tagName === "DETAILS" && typeof f.value === "boolean")
        el.open = f.value;
      else if (el.type === "checkbox" && typeof f.value === "boolean")
        el.checked = f.value;
      else if (typeof f.value === "string") el.value = f.value;
    }
    element.scrollTop = Math.max(0, Number(data.scroll) || 0);
    if (focus) {
      if (
        data.focus instanceof HTMLElement &&
        data.focus.isConnected &&
        !data.focus.closest("[hidden]")
      )
        data.focus.focus({ preventScroll: true });
      else {
        let target = null;
        if (
          typeof data.focusSelector === "string" &&
          data.focusSelector.length < 300
        ) {
          try {
            target = element.querySelector(data.focusSelector);
          } catch {}
        }
        (target ?? element).focus({ preventScroll: true });
      }
    }
  }
  function title(route, tab = state.tab) {
    const config = registry.get(route.type);
    return route.type === "root"
      ? tab === "now" && shell.dataset.rideMode
        ? screenText("navigation_005")
        : titles[tab]
      : ((typeof config?.title === "function"
          ? config.title(route)
          : config?.title) ?? screenText("navigation_006"));
  }
  function historyWrite(kind = "replace", snapshot = state, modal = sheet) {
    const route = currentRoute(snapshot),
      params = route.params.stopId ?? route.params.id ?? "";
    const suffix =
      route.type === "arrival-detail" && route.params.serviceKey
        ? `?service=${encodeURIComponent(route.params.serviceKey)}`
        : "";
    const path = `#/${snapshot.tab}${route.type === "root" ? "" : `/${route.type}${params ? `/${encodeURIComponent(params)}` : ""}`}${suffix}`;
    const parentKey =
      snapshot.stacks[snapshot.tab].at(-2)?.key ?? `root:${snapshot.tab}`;
    history[kind === "push" ? "pushState" : "replaceState"](
      {
        ...history.state,
        mymapNavigation: { state: snapshot, parentKey, sheet: modal },
      },
      "",
      path,
    );
    save();
  }
  // A tab is a peer, not a parent. Rebuild its history spine so every Back
  // method reaches the same logical parent, while the other tab stacks survive.
  function historySpine() {
    const stack = state.stacks[state.tab];
    for (let i = 0; i <= stack.length; i++)
      historyWrite(
        i ? "push" : "replace",
        {
          ...state,
          stacks: { ...state.stacks, [state.tab]: stack.slice(0, i) },
        },
        null,
      );
  }
  function getFrame(route, tab = state.tab) {
    if (route.type === "root")
      return {
        element: roots.get(tab),
        route,
        config: registry.get(`root:${tab}`),
      };
    let frame = frames.get(route.key);
    if (frame) {
      frames.delete(route.key);
      frames.set(route.key, frame);
      return frame;
    }
    const config = registry.get(route.type);
    if (!config) return null;
    const element = document.createElement("section");
    element.className = "navigation-screen";
    element.dataset.screen = route.type;
    element.dataset.navigationKey = route.key;
    element.tabIndex = -1;
    element.hidden = true;
    frame = { element, route, config };
    frames.set(route.key, frame);
    details.append(element);
    const content = config.create?.({ element, route });
    if (content instanceof Node) element.append(content);
    return frame;
  }
  function clean(element) {
    element.style.transform = "";
    element.style.opacity = "";
    element.style.boxShadow = "";
    element.style.zIndex = "";
  }
  function showOnly(element) {
    for (const el of [
      ...roots.values(),
      ...[...frames.values()].map((f) => f.element),
    ]) {
      const active = el === element;
      el.hidden = !active;
      el.inert = !active;
      el.classList.toggle("navigation-current", active);
      el.setAttribute("aria-hidden", String(!active));
      clean(el);
    }
  }
  function chrome(route) {
    const stack = state.stacks[state.tab],
      parent = stack.at(-2) ?? { type: "root" };
    shell.dataset.navigationDepth = stack.length;
    shell.dataset.navigationScreen = route.type;
    shell.classList.toggle(
      "navigation-fullscreen",
      Boolean(registry.get(route.type)?.fullscreen),
    );
    back.hidden = !stack.length;
    back.querySelector("span").textContent = title(parent);
    back.setAttribute(
      "aria-label",
      screenText("navigation_007", [title(parent)]),
    );
    document.querySelector("#view-title").textContent =
      route.type === "root" ? titles[state.tab] : title(route);
    document.querySelectorAll(".tab-button").forEach((b) => {
      const selected = b.dataset.tab === state.tab;
      b.classList.toggle("active", selected);
      b.setAttribute("aria-current", selected ? "page" : "false");
    });
    const toolbar = document.querySelector("#screen-toolbar");
    if (toolbar) {
      const config = registry.get(
        route.type === "root" ? `root:${state.tab}` : route.type,
      );
      toolbar.innerHTML =
        typeof config?.toolbar === "function"
          ? config.toolbar(route)
          : (config?.toolbar ?? "");
    }
    edge.hidden = !stack.length;
  }
  function evict() {
    const active = currentRoute(state).key,
      parent = state.stacks[state.tab].at(-2)?.key;
    for (const [key, frame] of frames) {
      if (frames.size <= 5) break;
      if (key === active || key === parent) continue;
      frame.config.capture?.({ element: frame.element, route: frame.route });
      frame.config.onDispose?.({ element: frame.element, route: frame.route });
      frame.element.remove();
      frames.delete(key);
    }
  }
  async function render(previous, { kind = "none", focus = true } = {}) {
    shell.dataset.navigationBusy = "true";
    const token = ++epoch,
      route = currentRoute(state),
      frame = getFrame(route);
    if (!frame) {
      busy = false;
      return;
    }
    const old =
      previous?.type === "root"
        ? roots.get(previous.tab)
        : frames.get(previous?.key)?.element;
    if (previous)
      getFrame(previous, previous.tab)?.config?.onHide?.({
        element: old,
        route: previous,
      });
    showOnly(frame.element);
    chrome(route);
    shell.style.setProperty(
      "--navigation-top",
      `${viewport.getBoundingClientRect().top}px`,
    );
    frame.element.setAttribute("aria-labelledby", "view-title");
    // Async work belongs to the screen. Navigation never waits for a network request.
    Promise.resolve(frame.config?.onShow?.({ element: frame.element, route }))
      .then(() => {
        if (
          token === epoch &&
          frame.element.isConnected &&
          !frame.element.hidden
        )
          restoreUI(frame.element, route.key);
      })
      .catch((error) => console.error(error));
    restoreUI(frame.element, route.key);
    await transition(old, frame.element, kind, viewport.clientWidth);
    if (token !== epoch) return;
    showOnly(frame.element);
    restoreUI(frame.element, route.key, focus && kind === "pop");
    if (focus && kind !== "pop") {
      frame.element.focus({ preventScroll: true });
      frame.config?.onFocus?.({ element: frame.element, route });
    }
    busy = false;
    shell.dataset.navigationBusy = "false";
    save();
    evict();
    document.dispatchEvent(
      new CustomEvent("mymap-navigation-change", {
        detail: { tab: state.tab, route },
      }),
    );
    const action = queued;
    queued = null;
    if (action) queueMicrotask(action);
  }
  function move(action, { kind = "push", historyKind = "push" } = {}) {
    if (drag) return false;
    if (busy) {
      queued = () => move(action, { kind, historyKind });
      return true;
    }
    capture();
    if (action.type === "push")
      state.sequence = Math.max(state.sequence, sequenceCeiling);
    const previous = { ...currentRoute(state), tab: state.tab },
      updated = navigationTransition(state, action);
    if (JSON.stringify(updated) === JSON.stringify(state)) return false;
    const previousDepth = state.stacks[previous.tab].length;
    const singletonIndex =
      action.type === "push" && action.singleton
        ? state.stacks[previous.tab].findIndex(
            (route) => route.type === action.screen,
          )
        : -1;
    state = updated;
    sequenceCeiling = Math.max(sequenceCeiling, state.sequence);
    busy = true;
    if (previous.tab !== state.tab) {
      onTabChange?.(state.tab);
      if (previousDepth) {
        tabRestore = { state, previous };
        shell.dataset.navigationBusy = "true";
        history.go(-previousDepth);
        return true;
      }
      historySpine();
    } else if (singletonIndex >= 0) {
      const removed = previousDepth - singletonIndex - 1;
      if (removed > 0) {
        historyRestore = { state, previous, kind: "state" };
        shell.dataset.navigationBusy = "true";
        save();
        history.go(-removed);
        return true;
      }
      historyWrite("replace");
      kind = "state";
    } else historyWrite(historyKind);
    render(previous, { kind }).catch((error) => {
      busy = false;
      console.error(error);
    });
    return true;
  }
  function afterSheet(action) {
    if (sheet || sheetBack) {
      busy = true;
      shell.dataset.navigationBusy = "true";
      pending = action;
      if (!sheetBack) {
        sheetBack = true;
        document
          .querySelectorAll("dialog.sheet[open]")
          .forEach((d) => d.close());
        history.back();
      }
      return false;
    }
    return action();
  }
  const api = {
    get route() {
      return currentRoute(state);
    },
    get tab() {
      return state.tab;
    },
    contains(type) {
      return state.stacks[state.tab].some((r) => r.type === type);
    },
    dismissSheet() {
      return new Promise((resolve) =>
        afterSheet(() => {
          document
            .querySelectorAll("dialog.sheet[open]")
            .forEach((dialog) => dialog.close());
          resolve();
        }),
      );
    },
    push(type, params) {
      const config = registry.get(type);
      return config
        ? afterSheet(() =>
            move({
              type: "push",
              screen: type,
              params,
              singleton: config.singleton,
            }),
          )
        : false;
    },
    pop() {
      return afterSheet(() => {
        if (!state.stacks[state.tab].length) return false;
        if (busy) {
          queued = () => api.pop();
          return true;
        }
        capture();
        busy = true;
        shell.dataset.navigationBusy = "true";
        history.back();
        return true;
      });
    },
    selectTab(tab) {
      return NAV_TABS.includes(tab)
        ? afterSheet(() =>
            state.tab === tab
              ? api.root(tab)
              : move({ type: "tab", tab }, { kind: "tab" }),
          )
        : false;
    },
    root(tab = state.tab) {
      return afterSheet(() => {
        queued = null;
        for (const el of [
          ...roots.values(),
          ...[...frames.values()].map((f) => f.element),
        ])
          el.getAnimations().forEach((a) => a.cancel());
        capture();
        const previous = { ...currentRoute(state), tab: state.tab },
          depth = state.stacks[state.tab].length;
        state = navigationTransition(state, { type: "tab", tab });
        state = navigationTransition(state, { type: "root", tab });
        busy = true;
        shell.dataset.navigationBusy = "true";
        onTabChange?.(tab);
        if (depth) {
          historyRestore = { state, previous };
          save();
          history.go(-depth);
        } else {
          historyWrite();
          render(previous, { kind: previous.tab === tab ? "pop" : "tab" });
        }
        return true;
      });
    },
    refresh() {
      if (refreshFrame || drag) return;
      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = 0;
        const route = currentRoute(state);
        const invalid = state.stacks[state.tab].findIndex(
          (r) => !validate(r, state.tab),
        );
        if (invalid >= 0) {
          capture();
          state.stacks[state.tab].splice(invalid);
          historySpine();
          render(route, { kind: "pop" });
          return;
        }
        const f = getFrame(route);
        if (f && !f.element.hidden)
          f.config?.update?.({ element: f.element, route });
      });
    },
    remember(key, value) {
      if (/^[a-zA-Z0-9_-]{1,40}$/.test(key)) {
        memory[key] = value;
        save();
      }
    },
    recalled(key) {
      return memory[key];
    },
  };
  controller = api;
  for (const tab of NAV_TABS) {
    const stack = state.stacks[tab],
      invalid = stack.findIndex(
        (r) => !registry.has(r.type) || !validate(r, tab),
      );
    if (invalid >= 0) stack.splice(invalid);
  }
  // Direct hash links without a session can identify stateless detail screens.
  if (
    !history.state?.mymapNavigation &&
    !saved.state &&
    location.hash.startsWith("#/")
  ) {
    const [hashPath, query = ""] = location.hash.split("?");
    const [, tab, type, id] = hashPath.split("/");
    const params = { stopId: "" };
    try { params.stopId = decodeURIComponent(id ?? ""); } catch { /* Invalid links stay at the tab root. */ }
    if (type === "arrival-detail")
      params.serviceKey = new URLSearchParams(query).get("service") ?? "";
    if (NAV_TABS.includes(tab)) {
      state.tab = tab;
      if (registry.has(type) && validate({ type, params }, tab))
        state = navigationTransition(state, {
          type: "push",
          screen: type,
          params,
        });
    }
  }
  onTabChange?.(state.tab);
  historySpine();
  render(null, { focus: false });
  back.addEventListener("click", () => api.pop());
  document
    .querySelector("#screen-toolbar")
    ?.addEventListener("click", (event) => {
      const route = currentRoute(state),
        frame = getFrame(route);
      frame?.config?.onToolbar?.({ event, route, element: frame.element });
    });
  window.addEventListener("popstate", async (event) => {
    if (drag) {
      clean(drag.current);
      clean(drag.parent);
      drag = null;
      viewport.classList.remove("navigation-interacting");
    }
    capture();
    const rootChange = historyRestore,
      tabChange = tabRestore;
    historyRestore = null;
    tabRestore = null;
    const previous = (rootChange ?? tabChange)?.previous ?? {
        ...currentRoute(state),
        tab: state.tab,
      },
      data = event.state?.mymapNavigation;
    sheet = data?.sheet ?? null;
    sheetBack = false;
    document.querySelectorAll("dialog.sheet[open]").forEach((d) => {
      if (d.id !== sheet) d.close();
    });
    // A sheet closed by Back is not reopened by Forward without its owner.
    const restored = restoreNavigation(
      (rootChange ?? tabChange)?.state ?? data?.state,
    );
    state = {
      ...restored,
      sequence: Math.max(state.sequence, restored.sequence),
      stacks: {
        ...state.stacks,
        [restored.tab]: restored.stacks[restored.tab],
      },
    };
    if (rootChange) historyWrite();
    if (tabChange) historySpine();
    if (previous.tab !== state.tab) onTabChange?.(state.tab);
    busy = true;
    const kind = skipPop
      ? "none"
      : (rootChange?.kind ?? (previous.tab === state.tab ? "pop" : "tab"));
    skipPop = false;
    await render(previous, { kind, focus: !sheet });
    const action = pending;
    pending = null;
    if (action) action();
  });
  new MutationObserver(() => {
    const id =
      [...document.querySelectorAll("dialog.sheet[open]")].at(-1)?.id ?? null;
    if (id === sheet || sheetBack) return;
    if (id) {
      const replace = Boolean(sheet);
      sheet = id;
      historyWrite(replace ? "replace" : "push");
    } else if (sheet) {
      busy = true;
      shell.dataset.navigationBusy = "true";
      sheet = null;
      sheetBack = true;
      history.back();
    }
  }).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      !e.defaultPrevented &&
      !document.querySelector("dialog[open]") &&
      state.stacks[state.tab].length
    ) {
      e.preventDefault();
      api.pop();
    }
  });
  const scheduleSave = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      capture();
      save();
    }, 180);
  };
  viewport.addEventListener("scroll", scheduleSave, {
    capture: true,
    passive: true,
  });
  viewport.addEventListener("input", scheduleSave, { passive: true });
  window.addEventListener("pagehide", () => {
    capture();
    save();
  });
  const updateViewport = () => {
    const vv = visualViewport,
      keyboard = vv && vv.scale <= 1 && innerHeight - vv.height > 120;
    shell.dataset.keyboard = Boolean(keyboard);
    document.documentElement.style.setProperty(
      "--app-height",
      `${vv?.height ?? innerHeight}px`,
    );
    document.documentElement.style.setProperty(
      "--keyboard-bottom",
      `${keyboard ? Math.max(0, innerHeight - vv.height - vv.offsetTop) : 0}px`,
    );
    document.documentElement.style.setProperty(
      "--viewport-top",
      `${keyboard ? vv.offsetTop : 0}px`,
    );
  };
  visualViewport?.addEventListener("resize", updateViewport);
  visualViewport?.addEventListener("scroll", updateViewport);
  updateViewport();
  viewport.addEventListener("pointerdown", (e) => {
    const bounds = viewport.getBoundingClientRect();
    if (
      e.clientX < bounds.left ||
      e.clientX > bounds.left + 24 ||
      e.clientY >
        bounds.bottom -
          (shell.classList.contains("navigation-fullscreen") ? 0 : 74)
    )
      return;
    if (busy || sheet || !state.stacks[state.tab].length || e.button > 0)
      return;
    if (e.pointerType === "mouse") e.preventDefault();
    viewport.classList.add("navigation-interacting");
    const current = getFrame(currentRoute(state)),
      parent = getFrame(
        state.stacks[state.tab].at(-2) ?? {
          type: "root",
          key: `root:${state.tab}`,
          params: {},
        },
      );
    if (!parent) return;
    Promise.resolve(
      parent.config?.onShow?.({ element: parent.element, route: parent.route }),
    ).catch(console.error);
    restoreUI(parent.element, parent.route.key);
    drag = {
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastAt: performance.now(),
      dx: 0,
      dy: 0,
      velocity: 0,
      current: current.element,
      parent: parent.element,
      started: false,
    };
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = Math.max(0, e.clientX - drag.x),
      dy = e.clientY - drag.y,
      time = performance.now();
    if (!drag.started && Math.abs(dy) > 12 && Math.abs(dy) > dx) {
      drag = null;
      viewport.classList.remove("navigation-interacting");
      return;
    }
    if (!drag.started && (dx < 8 || dx < Math.abs(dy) * 1.25)) return;
    e.preventDefault();
    if (!drag.started) viewport.setPointerCapture(e.pointerId);
    drag.started = true;
    drag.velocity = (e.clientX - drag.lastX) / Math.max(1, time - drag.lastAt);
    drag.lastX = e.clientX;
    drag.lastAt = time;
    drag.dx = dx;
    drag.dy = dy;
    const p = Math.min(1, dx / viewport.clientWidth);
    drag.parent.hidden = false;
    drag.parent.inert = true;
    drag.parent.style.zIndex = "1";
    drag.parent.style.transform = `translateX(${-viewport.clientWidth * 0.25 * (1 - p)}px)`;
    drag.parent.style.opacity = 0.8 + 0.2 * p;
    drag.current.style.zIndex = "3";
    drag.current.style.transform = `translateX(${dx}px)`;
    drag.current.style.boxShadow = `-6px 0 20px rgba(0,0,0,${0.12 * (1 - p)})`;
  });
  async function finish(cancel = false) {
    if (!drag) return;
    const value = drag;
    drag = null;
    viewport.classList.remove("navigation-interacting");
    if (!value.started) {
      showOnly(value.current);
      return;
    }
    const commit =
      !cancel &&
      swipeDecision({
        ...value,
        velocity: performance.now() - value.lastAt > 100 ? 0 : value.velocity,
        width: viewport.clientWidth,
      }) === "pop";
    busy = true;
    shell.dataset.navigationBusy = "true";
    await settleSwipe(value.current, value.parent, {
      dx: value.dx,
      width: viewport.clientWidth,
      commit,
    });
    showOnly(value.current);
    busy = false;
    if (commit) {
      skipPop = true;
      api.pop();
    } else shell.dataset.navigationBusy = "false";
  }
  viewport.addEventListener("pointerup", () => finish());
  viewport.addEventListener("pointercancel", () => finish(true));
  return api;
}
