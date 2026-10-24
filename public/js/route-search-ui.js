import { ui, displayStopName, serviceDateLabel, userFacingError, userError, currentLocale } from "./locale.js";
import { downloadRouteImage } from "./route-image.js";
import { esc, icon } from "./vnext-state.js";
import {
  routeHTML,
  operatorLabel,
  refreshRouteObservations,
} from "./route-search-view.js";
import { navigation } from "./navigation.js";
import { setupSheetGestures, openContextSheet } from "./context-sheet.js";
import {
  readSearchPairs,
  saveSearchPair,
  removeSearchPair,
} from "./search-history.js";
import { mountStopAutocomplete } from "./stop-autocomplete.js";
import { quickSearchStops, chooseQuickSearchStop } from "./search-shortcuts-c1.js";
import {
  resolveStop,
  sortedRouteIndexes,
  nextDepartureInput,
  previousDepartureInput,
  searchShareURL,
  readSharedSearch,
} from "./route-search-model.js";
import { getStaticFeed } from "./fast-data.js";
import { CAPTURE_API } from "./live.js";
import { scheduledJourney, boardingAvailable } from "./journey-session.js";
import { registerTripChoice } from "./route-trip-screen.js";
import { updateHTML } from "./view-rendering.js";
import {
  makeItinerary,
  shiftServiceDate,
  itineraryAction,
  itineraryDestinationChanged,
  itineraryRevision,
  editableItineraryLeg,
  updateItineraryRoute,
} from "./journey-plan.js";
import { mergeTimetableFeeds } from "./search-core.js";
import { searchRecoveryOptions, recoveryAction } from "./search-recovery-c6.js";
import { routeComparison, transferRisk, routeFacts } from "./route-comparison-c2-c5.js";
import { getCached, putCached } from "./realtime.js";
import { relevantMissingOperators } from "./arrival-stability.js";
import { loadNorth3Snapshot, north3Feed } from "./north3-feed.js";
import {
  recoveryInput,
  missedConnection,
  nextDaySearch,
} from "./journey-recovery.js";

const searchStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};
let plannerSequence = 0;
// Up to four searches can be kept open at once (search slots); results for
// each stay available while the others run.
const MAX_SLOTS = 4,
  MAX_SNAPSHOTS = 8;
async function api(path, params = {}, signal) {
  const u = new URL(path, CAPTURE_API);
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null) u.searchParams.set(k, v);
  const requestController = new AbortController(),
    abort = () => requestController.abort(),
    timer = setTimeout(abort, 4000);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const r = await fetch(u, {
      signal: requestController.signal,
      cache: "no-store",
    });
    let data = null;
    try {
      data = await r.json();
    } catch {}
    if (!r.ok)
      throw Object.assign(Error(`HTTP ${r.status}`), {
        detail: data?.error,
        fallback: ui("route_search_ui_001"),
        status: r.status,
        code: data?.code,
      });
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
const minuteValue = (value) => {
  const m = String(value).match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const passState = (settings) => ({
  citybus: Boolean(settings.passCityBus),
  kyotobus: Boolean(settings.passKyotoBus),
  subway: Boolean(settings.passSubway),
  subwayFrom: settings.passSubwayFrom ?? "K01",
  subwayTo: settings.passSubwayTo ?? "K11",
  expires: settings.passExpires ?? "",
});
async function loadOneFeed(operator, date, signal) {
  const key = `static:${operator}:${date}`;
  try {
    const data = await getStaticFeed(operator, date, { signal });
    await putCached(key, { data, savedAt: Date.now() });
    return { data, cached: false };
  } catch (error) {
    if (signal?.aborted) throw error;
    const cached = await getCached(key);
    if (cached?.data)
      return {
        data: {
          ...cached.data,
          meta: {
            ...cached.data.meta,
            stale: true,
            warning: ui("route_search_ui_079", [
              operatorLabel[operator] ?? ui("route_search_ui_002"),
            ]),
          },
        },
        cached: true,
      };
    throw error;
  }
}
async function loadFeeds(date, signal, network) {
  const operators = ["subway", "kintetsu", "citybus", "kyotobus"],
    feeds = [],
    missing = [],
    cached = [];
  await Promise.all(
    operators.map(async (operator) => {
      try {
        const result = await loadOneFeed(operator, date, signal);
        feeds.push(result.data);
        if (result.cached) cached.push(operator);
      } catch (e) {
        missing.push({ operator, error: e.message, status: e.status });
      }
    }),
  );
  if (!feeds.some((f) => f.services?.some((s) => s.route === "北3"))) {
    try {
      const local = north3Feed(await loadNorth3Snapshot(), network, date);
      if (local) feeds.push(local);
    } catch {}
  }
  return { feeds, missing, cached };
}
async function loadRealtime(network, request, signal) {
  const result = {},
    tasks = [
      api("/api/rail/live", {}, signal)
        .then((x) => (result.rail = x))
        .catch(() => {}),
      api("/api/bus/rt", {}, signal)
        .then((x) => (result.kyotobus = x))
        .catch(() => {}),
    ];
  const cityStop = [request.from, ...request.via.map((v) => v.stop), request.to]
    .map((id) => network.stops.get(id))
    .find((s) => s?.type === "citybus");
  if (cityStop)
    tasks.push(
      api(
        "/api/citybus/arrivals",
        { stop: cityStop.fullName ?? cityStop.name },
        signal,
      )
        .then((x) => (result.citybus = x))
        .catch(() => {}),
    );
  await Promise.all(tasks);
  return result;
}
function feedWarnings(meta) {
  return [
    ...new Set(
      (meta ?? [])
        .filter((m) => m?.stale || m?.warning)
        .map((m) => m.warning ?? ui("route_search_ui_003", [m.operator])),
    ),
  ];
}
async function planInWorker(base, feeds, request, passes, signal, extra = {}) {
  const payload = {
      base,
      feeds,
      request,
      passes,
      nowEpoch: Date.now(),
      locale: currentLocale(),
      ...extra,
    },
    id = ++plannerSequence;
  if (typeof Worker === "undefined") {
    const { planWorkerJob } = await import("./planner-worker.js");
    return planWorkerJob(payload);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./planner-worker.js", import.meta.url), {
      type: "module",
      name: "mymap-route-planner",
    });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      fn(value);
    };
    const onAbort = () =>
      finish(reject, new DOMException("Aborted", "AbortError"));
    worker.onmessage = (event) => {
      const data = event.data;
      if (data?.id !== id) return;
      if (data.ok) {
        const { id: completedId, ok, ...result } = data;
        finish(resolve, result);
      } else
        finish(
          reject,
          data.userFacing
            ? userFacingError(data.error)
            : Object.assign(Error(data.error ?? "planner"), { fallback: ui("route_search_ui_004") }),
        );
    };
    worker.onerror = (event) => {
      // The owned promise reports genuine failures inline. Cancellation during
      // document teardown must not escape as an unhandled module error.
      event.preventDefault();
      finish(reject, Error(event.message || ui("route_search_ui_005")));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.postMessage({ nowEpoch: Date.now(), id, ...payload });
  });
}
export function mountRouteSearch({
  network,
  settings,
  tokyoNow,
  onBoard,
  onArm,
  onCurrentLocation,
  getItinerary,
  getCurrentRide,
  getRecoveryStop,
  getRideDelay,
  onItineraryAdvance,
  onItineraryUpdate,
}) {
  const root = document.querySelector("#route-search-root");
  if (!root) return { show() {}, setFrom() {}, openBoard() {} };
  let searchRevision = 0,
    previousSearch = false,
    invalidField = null,
    incomingInput = null;
  const feedContexts = new Map();
  let observationElement = null,
    observationTimer = null,
    resumeSearch = false,
    lastJob = null;
  // Searches in flight, one per search slot. Each owns its controller and
  // result snapshot, so up to four searches can run side by side.
  const runningJobs = new Set();
  let slotSequence = 0;
  const newSlot = (input = null) => ({
    id: ++slotSequence,
    input,
    revision: null,
    job: null,
  });
  const slots = [newSlot()];
  let activeSlotId = slots[0].id;
  const activeSlot = () =>
    slots.find((slot) => slot.id === activeSlotId) ?? slots[0];
  function watchObservations(element) {
    observationElement = element;
    clearInterval(observationTimer);
    observationTimer = null;
    if (!element || document.hidden) return;
    refreshRouteObservations(element);
    observationTimer = setInterval(
      () => refreshRouteObservations(element),
      1000,
    );
  }
  function stopObservations(element) {
    if (observationElement === element) watchObservations(null);
  }
  document.addEventListener("visibilitychange", () =>
    watchObservations(observationElement),
  );
  for (const event of ["online", "offline"])
    window.addEventListener(event, () => {
      if (observationElement && !document.hidden)
        refreshRouteObservations(observationElement);
    });
  function suspendSearch() {
    resumeSearch ||= runningJobs.size > 0;
    for (const job of runningJobs) job.controller.abort();
    clearInterval(observationTimer);
  }
  window.addEventListener("beforeunload", suspendSearch);
  window.addEventListener("pagehide", suspendSearch);
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    watchObservations(observationElement);
    if (resumeSearch) {
      resumeSearch = false;
      if (lastJob) {
        lastJob.status = ui("route_search_ui_006");
        publish(lastJob);
      }
    }
  });
  const now = tokyoNow();
  root.innerHTML = ui("route_search_ui_007", [
    icon("location"),
    icon("swap"),
    icon("now"),
    esc(now.time),
    icon("train"),
  ]);
  const inlineStatus = root.querySelector("#search-inline-status"),
    form = root.querySelector("#planner-form");
  // The open searches sit as tabs at the bottom of the Search tab, above the
  // tab bar, on the form, the results and the route detail alike.
  const slotStrip = document.createElement("nav");
  slotStrip.id = "search-slots";
  slotStrip.className = "search-slots";
  slotStrip.setAttribute("aria-label", ui("search_slot_tabs"));
  (document.querySelector(".app-shell") ?? document.body).append(slotStrip);
  const quickStops = quickSearchStops(network);
  const shortcuts = document.createElement("section");
  shortcuts.className = "planner-quick-stops";
  shortcuts.setAttribute("aria-label", ui("c1_quick_stops"));
  shortcuts.innerHTML = `<p class="section-label">${esc(ui("c1_quick_stops"))}</p><div class="planner-quick-buttons">${quickStops.map(stop =>
    `<button type="button" data-c1-quick-stop="${esc(stop.id)}">${esc(stop.name)}</button>`
  ).join("")}</div><p class="source-caption">${esc(ui("c1_quick_note"))}</p>`;
  // Keep the search action visible above the keyboard. Shortcuts are
  // supplemental and must never push submit below the first viewport.
  form.after(shortcuts);
  let activePlaceField = "from";
  form.elements.from.addEventListener("focus", () => activePlaceField = "from");
  form.elements.to.addEventListener("focus", () => activePlaceField = "to");
  shortcuts.addEventListener("click", e => {
    const button = e.target.closest("[data-c1-quick-stop]");
    if (!button) return;
    const stop = network.stops.get(button.dataset.c1QuickStop);
    if (!stop) return;
    chooseQuickSearchStop(form,
      {id:stop.id,name:displayStopName(stop)},activePlaceField);
    navigation.remember("search-input", captureInput());
    const next = activePlaceField === "from" ? "to" : "from";
    if (!form.elements[next].value) form.elements[next].focus();
  });
  function makeSearchSheet(id, title, body) {
    const dialog = document.createElement("dialog");
    dialog.id = id;
    dialog.className = "sheet";
    dialog.dataset.detent = "fit";
    dialog.setAttribute("aria-labelledby", `${id}-title`);
    dialog.innerHTML = ui("route_search_ui_008", [id, title, body]);
    let finished = false;
    dialog.beginSearchSheet = () => {
      finished = false;
    };
    const finish = (value) => {
      if (finished) return;
      finished = true;
      dialog.returnValue = value;
      // Commit or restore the single planner model before Navigation observes
      // the native close mutation and records its History snapshot.
      dialog.dispatchEvent(new Event("mymap-search-sheet-result"));
      if (dialog.open) dialog.close(value);
    };
    dialog.addEventListener("close", () => finish(dialog.returnValue));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish("cancel");
    });
    dialog
      .querySelectorAll("input,select")
      .forEach((el) => el.setAttribute("form", "planner-form"));
    dialog
      .querySelector("[data-search-sheet-done]")
      .addEventListener("click", () => {
        const invalid = [...dialog.querySelectorAll("input[required]")].find(
          (input) => !input.checkValidity(),
        );
        if (invalid) {
          invalid.reportValidity();
          return;
        }
        finish("apply");
      });
    dialog
      .querySelector("[data-search-sheet-cancel]")
      .addEventListener("click", () => finish("cancel"));
    document.body.append(dialog);
    return dialog;
  }
  const dateSheet = makeSearchSheet(
    "search-date",
    ui("route_search_ui_009"),
    ui("route_search_ui_010", [now.date, now.time, icon("now")]),
  );
  const filter = makeSearchSheet(
    "search-filter",
    ui("route_search_ui_011"),
    ui("route_search_ui_080", [
      [
        ["subway", ui("route_search_ui_012")],
        ["kintetsu", ui("route_search_ui_013")],
        ["citybus", ui("route_search_ui_014")],
        ["kyotobus", ui("route_search_ui_015")],
      ]
        .map(
          ([id, label]) =>
            `<label class="setting-row"><span>${label}</span><input type="checkbox" role="switch" data-search-operator="${id}" checked></label>`,
        )
        .join(""),
    ]),
  );
  let dateBefore = null,
    dateDraftBefore = null,
    dateSearchOrigin = null;
  function openDate(input = null) {
    dateDraftBefore = captureInput();
    if (input) applyInput(input);
    dateBefore = Object.fromEntries(
      ["date", "time", "timeMode"].map((name) => [
        name,
        form.elements[name].value,
      ]),
    );
    dateSearchOrigin = input;
    dateSheet.beginSearchSheet();
    dateSheet.returnValue = "";
    dateSheet.showModal();
  }
  root
    .querySelector("[data-search-date]")
    .addEventListener("click", () => openDate());
  // Quick controls in the date sheet: time type, day chips, Now and steps.
  const setDateTime = (date, time) => {
    form.elements.date.value = date;
    form.elements.time.value = time;
  };
  const clockText = (minute) =>
    `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  root.querySelector("[data-planner-now]").addEventListener("click", () => {
    const today = tokyoNow();
    setDateTime(today.date, today.time);
    form.elements.timeMode.value = "departure";
    dateChanged();
    navigation.remember("search-input", captureInput());
  });
  dateSheet.addEventListener("click", (event) => {
    const mode = event.target.closest("[data-time-mode]"),
      offset = event.target.closest("[data-date-offset]"),
      step = event.target.closest("[data-time-step]");
    const today = tokyoNow();
    if (mode) form.elements.timeMode.value = mode.dataset.timeMode;
    else if (offset)
      form.elements.date.value = shiftServiceDate(today.date, Number(offset.dataset.dateOffset));
    else if (event.target.closest("[data-time-now]")) {
      // "Now" means leaving now.
      setDateTime(today.date, today.time);
      form.elements.timeMode.value = "departure";
    } else if (step) {
      const current = minuteValue(form.elements.time.value) ?? today.minute,
        total = current + Number(step.dataset.timeStep),
        days = Math.floor(total / 1440);
      setDateTime(
        days ? shiftServiceDate(form.elements.date.value || today.date, days) : form.elements.date.value,
        clockText(((total % 1440) + 1440) % 1440),
      );
    } else return;
    dateChanged();
  });
  dateSheet.addEventListener("mymap-search-sheet-result", () => {
    const confirmed =
      dateSheet.returnValue === "apply" &&
      [...dateSheet.querySelectorAll("input[required]")].every((input) =>
        input.checkValidity(),
      );
    const origin = dateSearchOrigin;
    dateSearchOrigin = null;
    if (!confirmed && dateDraftBefore) applyInput(dateDraftBefore);
    const changed =
      confirmed &&
      dateBefore &&
      Object.entries(dateBefore).some(
        ([name, value]) => form.elements[name].value !== value,
      );
    dateChanged();
    navigation.remember("search-input", captureInput());
    if (origin && changed) form.requestSubmit();
  });
  let filterBefore = null;
  function openFilter() {
    filterBefore = captureInput();
    filter.beginSearchSheet();
    filter.returnValue = "";
    filter.showModal();
  }
  root
    .querySelector("[data-search-filter]")
    .addEventListener("click", openFilter);
  filter.addEventListener("mymap-search-sheet-result", () => {
    if (filter.returnValue !== "apply" && filterBefore)
      applyInput(filterBefore);
    dateChanged();
    navigation.remember("search-input", captureInput());
  });
  setupSheetGestures();
  let draftVia = [];
  const autocomplete = mountStopAutocomplete({
    container: form,
    list: form.querySelector("#planner-suggestions"),
    network,
    onSelect(input, stop) {
      if (["from", "to"].includes(input.name))
        form.elements[`${input.name}Id`].value = stop?.id ?? "";
      else {
        const row = draftVia[Number(input.dataset.viaIndex)];
        if (row) {
          row.name = input.value;
          row.id = stop?.id ?? "";
        }
      }
      navigation.remember("search-input", captureInput());
    },
  });
  form.querySelectorAll("[data-stop-input]").forEach(autocomplete.bind);
  function renderVia() {
    autocomplete.close();
    form.querySelector("#planner-via").innerHTML =
      draftVia
        .map((v, i) =>
          ui("route_search_ui_081", [
            i + 1,
            i,
            i,
            esc(v.name),
            i,
            i + 1,
            i,
            i + 1,
            [...new Set([0, 5, 10, 15, 30, 60, 120, 180, v.dwell])]
              .sort((a, b) => a - b)
              .map((n) =>
                ui("route_search_ui_016", [
                  n,
                  n === v.dwell ? "selected" : "",
                  n,
                ]),
              )
              .join(""),
          ]),
        )
        .join("") + (draftVia.length ? ui("route_search_ui_017") : "");
    form.querySelectorAll("[data-via-index]").forEach(autocomplete.bind);
    form.querySelector("[data-add-via]").hidden = draftVia.length >= 3;
  }
  function captureInput() {
    for (const [i, v] of draftVia.entries()) {
      v.name = form.querySelector(`[data-via-index="${i}"]`)?.value ?? v.name;
      v.dwell = Number(
        form.querySelector(`[data-dwell-index="${i}"]`)?.value ?? v.dwell,
      );
    }
    return {
      ...Object.fromEntries(
        [
          "from",
          "to",
          "fromId",
          "toId",
          "date",
          "time",
          "timeMode",
          "operators",
          "walkSpeed",
          "trainType",
          "buffer",
          "maxWalk",
        ].map((n) => [n, form.elements[n].value]),
      ),
      via: draftVia.map((v) => ({ ...v })),
    };
  }
  function applyInput(input) {
    if (!input) return;
    for (const name of [
      "from",
      "to",
      "fromId",
      "toId",
      "date",
      "time",
      "timeMode",
      "operators",
      "walkSpeed",
      "trainType",
      "buffer",
      "maxWalk",
    ])
      if (typeof input[name] === "string" && input[name].length < 200)
        form.elements[name].value = input[name];
    for (const side of ["from", "to"]) {
      const stop = network.stops.get(input[`${side}Id`]);
      if (stop) form.elements[side].value = displayStopName(stop);
    }
    draftVia = Array.isArray(input.via)
      ? input.via
          .slice(0, 3)
          .filter(
            (v) =>
              v &&
              typeof v.name === "string" &&
              v.name.length < 200 &&
              Number.isFinite(v.dwell) &&
              v.dwell >= 0 &&
              v.dwell <= 180,
          )
          .map((v) => ({
            name: v.name,
            id: typeof v.id === "string" ? v.id : "",
            dwell: v.dwell,
          }))
      : [];
    renderVia();
    dateChanged();
  }
  const resultInteractions = new WeakMap();
  let resultFrame = null,
    snapshots = new Map(),
    restoredSearch = false,
    searchDrafts = new Map();
  function validSnapshot(x) {
    return (
      x &&
      Number.isSafeInteger(x.revision) &&
      Array.isArray(x.routes) &&
      Array.isArray(x.boarding) &&
      x.routes.length <= 12 &&
      x.routes.every(
        (r) =>
          [r.start, r.time, r.duration, r.transfers].every(Number.isFinite) &&
          Boolean(r.fare) &&
          [r.fare.additional, r.fare.normal].every(
            (v) => v == null || Number.isFinite(v),
          ) &&
          Array.isArray(r.legs) &&
          r.legs.length < 40 &&
          r.legs.every((l) => [l.depart, l.arrive].every(Number.isFinite)),
      )
    );
  }
  function restoreSearch() {
    if (restoredSearch) return;
    restoredSearch = true;
    const inputs = navigation.recalled("search-input");
    if (inputs && typeof inputs === "object") applyInput(inputs);
    const savedDrafts = navigation.recalled("search-drafts");
    if (Array.isArray(savedDrafts))
      for (const [key, value] of savedDrafts
        .slice(-8)
        .filter((row) => Array.isArray(row) && row.length === 2))
        if (typeof key === "string" && value && typeof value === "object")
          searchDrafts.set(key, value);
    const savedSlots = navigation.recalled("search-slots");
    if (savedSlots && Array.isArray(savedSlots.slots) && savedSlots.slots.length) {
      slots.splice(
        0,
        slots.length,
        ...savedSlots.slots
          .slice(0, MAX_SLOTS)
          .map((row) => ({
            ...newSlot(row?.input && typeof row.input === "object" ? row.input : null),
            revision: Number.isSafeInteger(row?.revision) ? row.revision : null,
            stack: Array.isArray(row?.stack) ? row.stack.slice(0, 6) : undefined,
          })),
      );
      activeSlotId = (slots[savedSlots.active] ?? slots[0]).id;
    }
    const saved = navigation.recalled("search-data");
    if (Array.isArray(saved))
      for (const x of saved.slice(-MAX_SNAPSHOTS))
        if (validSnapshot(x)) {
          snapshots.set(x.revision, { ...x, status: "" });
          searchRevision = Math.max(searchRevision, x.revision);
        }
  }
  function publish(job) {
    const previous = snapshots.get(job.revision);
    snapshots.set(job.revision, {
      revision: job.revision,
      routes: job.routes,
      boarding: job.boarding,
      description: job.description,
      status: job.status,
      input: job.input,
      request: job.request,
      order: previous?.order ?? job.order,
      routeVersions: job.routes.map(
        (_, i) => previous?.routeVersions?.[i] ?? 0,
      ),
    });
    trimSnapshots();
    renderResults();
    renderSlots();
    navigation.refresh();
  }
  // Keep the newest results, but never drop one a search slot still shows.
  function trimSnapshots() {
    const kept = new Set(slots.map((slot) => slot.revision));
    while (snapshots.size > MAX_SNAPSHOTS) {
      const oldest = [...snapshots.keys()].find((key) => !kept.has(key));
      if (oldest === undefined) break;
      snapshots.delete(oldest);
    }
  }
  function renderResults() {
    if (!resultFrame) return;
    const revision = Number(resultFrame.dataset.searchRevision),
      data = snapshots.get(revision);
    resultFrame.querySelector(".search-request").textContent =
      data?.description ?? "";
    updateHTML(
      resultFrame.querySelector("[data-planner-status]"),
      data?.status ?? ui("route_search_ui_018"),
    );
    const orderRoot = resultFrame.querySelector(".result-order");
    if (orderRoot && !orderRoot.querySelector('[data-result-order="walking"]')) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.resultOrder = "walking";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", ui("c5_sort_walking"));
      button.innerHTML = `<i class="route-rank walking" aria-hidden="true">${esc(ui("route_rank_walk"))}</i><span>${esc(ui("c5_sort_walking"))}</span>`;
      orderRoot.append(button);
    }
    resultFrame.querySelectorAll("[data-result-order]").forEach((button) => {
      const selected =
        button.dataset.resultOrder === (data?.order ?? "arrival");
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    resultFrame.querySelector("[data-result-clock]").textContent = data?.input
      ? searchClockLabel(data.input)
      : "—";
    resultFrame.querySelector("[data-result-date]").textContent = data?.input
      ?.date
      ? serviceDateLabel(data.input.date)
      : "";
    resultFrame.querySelector("[data-result-places]").textContent = data?.input
      ? `${data.input.from} → ${data.input.to}`
      : ui("route_search_ui_019");
    resultFrame.querySelector("[data-previous-departure]").hidden = !(
      data?.routes.length && data.input
    );
    resultFrame.querySelector("[data-next-departure]").hidden = !(
      data?.routes.length && data.input
    );
    const interaction = resultInteractions.get(resultFrame);
    if (
      interaction?.pointerId != null ||
      (resultFrame.contains(document.activeElement) &&
        document.activeElement.closest(".planner-result"))
    )
      return;
    const routes = data?.routes ?? [];
    const comparisons = routeComparison(routes);
    const buffer = Number(data?.input?.buffer ?? 3);
    const results = sortedRouteIndexes(routes, data?.order).map((i, position) => {
      const facts = comparisons[i];
      const risk = transferRisk(routes[i], buffer);
      const compareTags = [
        facts.fastest ? ui("c2_fastest") : "",
        facts.fewestTransfers ? ui("c2_fewest") : "",
        facts.leastWalking ? ui("c2_least_walk") : "",
        facts.cheapest ? ui("c4_cheapest") : "",
      ].filter(Boolean);
      const margin = risk.hasTransfer
        ? `<span class="route-margin" data-transfer-risk="${risk.critical ? "critical" : risk.tight ? "tight" : "normal"}">${esc(ui(risk.critical ? "c3_critical" : risk.tight ? "c3_tight" : "c3_margin", [risk.shortest]))}</span>`
        : `<span class="route-margin">${esc(ui("c3_direct"))}</span>`;
      // Walk, transfers and fare already lead the card; the note adds the
      // transfer margin and what this route is best at, as plain caption text.
      const cost = facts.fare === null ? `<span>${esc(ui("c4_unknown"))}</span>` : "";
      const overview = `<p class="route-compare-note" aria-label="${esc(ui("c2_overview"))}">${margin}${cost}${compareTags.map(t => `<span class="route-compare-best">${esc(t)}</span>`).join("")}</p>`;
      return `<div class="route-compared-result" data-route-compare-index="${i}">${routeHTML(
        routes[i], network, data.boarding?.[i], i, tokyoNow(), false,
        { position: position + 1, recommendations: [
          routes[i].time === Math.min(...routes.map(r => r.time).filter(Number.isFinite))
            ? "arrival" : "",
          facts.fewestTransfers ? "transfers" : "",
          facts.cheapest ? "fare" : "",
        ].filter(Boolean) },
      )}${overview}</div>`;
    }).join("");
    updateHTML(resultFrame.querySelector("[data-planner-results]"), results);
  }
  function handleRouteAction(e) {
    const b = e.target.closest("button");
    if (!b) return;
    const revision = Number(
        b.closest("[data-search-revision]")?.dataset.searchRevision,
      ),
      rides = snapshots.get(revision)?.boarding;
    if (b.dataset.routeStop)
      navigation.push("nearby", { stopId: b.dataset.routeStop });
    if (b.hasAttribute("data-route-operations"))
      navigation.selectTab("operations");
    if (b.dataset.openRoute !== undefined)
      navigation.push("route", {
        index: Number(b.dataset.openRoute),
        revision,
      });
    if (b.dataset.changeLeg !== undefined) {
      const data = snapshots.get(revision),
        index = Number(b.dataset.changeRoute);
      if (data?.routes[index]) {
        if (
          data.itinerarySignature &&
          (data.itinerarySignature !== itineraryRevision(getItinerary?.()) ||
            !editableItineraryLeg(
              getItinerary?.(),
              Number(b.dataset.changeLeg),
            ))
        )
          return;
        activeSlot().job?.controller.abort();
        data.status = "";
        tripChoices.open({
          index,
          revision,
          legIndex: Number(b.dataset.changeLeg),
          routeVersion: data.routeVersions?.[index] ?? 0,
        });
      }
    }
    if (b.dataset.armRoute !== undefined) {
      const ride =
        rides?.[Number(b.dataset.armRoute)]?.[Number(b.dataset.armLeg)];
      const index = Number(b.dataset.armRoute),
        legIndex = Number(b.dataset.armLeg),
        data = snapshots.get(revision);
      if (data?.routes[index]?.connectionUnavailable) {
        const feedback = b
          .closest(".navigation-current")
          ?.querySelector("[data-route-feedback]");
        if (feedback) feedback.textContent = ui("route_search_ui_020");
        return;
      }
      if (ride)
        onArm?.(
          ride,
          makeItinerary(
            data.routes[index],
            data.boarding[index],
            data.input,
            legIndex,
          ),
        );
    }
    if (b.dataset.boardRoute !== undefined) {
      const ride =
        rides?.[Number(b.dataset.boardRoute)]?.[Number(b.dataset.boardLeg)];
      const index = Number(b.dataset.boardRoute),
        legIndex = Number(b.dataset.boardLeg),
        data = snapshots.get(revision);
      if (ride && boardingAvailable(ride, tokyoNow()))
        onBoard?.(
          ride,
          makeItinerary(
            data.routes[index],
            data.boarding[index],
            data.input,
            legIndex,
          ),
        );
    }
  }
  function requestFor(data) {
    if (data.request) return data.request;
    const input = data.input;
    if (!input) throw userFacingError(ui("route_search_ui_021"));
    return {
      from: resolveStop(network, input.from, input.fromId).stop?.id,
      to: resolveStop(network, input.to, input.toId).stop?.id,
      date: input.date,
      start: minuteValue(input.time),
      timeMode: input.timeMode,
      via: input.via.map((v) => ({ stop: v.id, dwell: v.dwell })),
      trainType: input.trainType,
      buffer: Number(input.buffer),
      maxWalk: Number(input.maxWalk),
      operators: (input.operators ?? "subway,kintetsu,citybus,kyotobus").split(
        ",",
      ),
      walkSpeed: input.walkSpeed ?? "standard",
    };
  }
  async function choiceContext(data, legIndex, signal) {
    const request = requestFor(data);
    let context = feedContexts.get(data.revision);
    if (!context) {
      const loaded = await loadFeeds(request.date, signal, network);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!loaded.feeds.length) throw userFacingError(ui("route_search_ui_022"));
      context = { feeds: loaded.feeds, request };
    }
    if (
      data.routes.some(
        (r) => r.legs[legIndex]?.depart >= 1260 || r.time >= 1380,
      ) &&
      !context.nextDay
    ) {
      const next = await loadFeeds(
        shiftServiceDate(request.date, 1),
        signal,
        network,
      );
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      context = {
        ...context,
        feeds: [...context.feeds, ...next.feeds],
        nextDay: true,
      };
    }
    context.mapped ??= mergeTimetableFeeds(network, context.feeds, {
      date: request.date,
    });
    if (data.itinerarySignature) {
      const now = tokyoNow();
      context = {
        ...context,
        request: {
          ...request,
          notBefore:
            now.minute +
            (Date.parse(`${now.date}T00:00:00Z`) -
              Date.parse(`${request.date}T00:00:00Z`)) /
              60000,
        },
      };
    }
    feedContexts.set(data.revision, context);
    while (feedContexts.size > 3)
      feedContexts.delete(feedContexts.keys().next().value);
    return context;
  }
  const tripChoices = registerTripChoice({
    network,
    tokyoNow,
    getSnapshot: (revision) => {
      restoreSearch();
      const data = snapshots.get(revision);
      return data?.itinerarySignature &&
        (data.itinerarySignature !== itineraryRevision(getItinerary?.()) ||
          itineraryDestinationChanged(getItinerary?.(), getCurrentRide?.()))
        ? null
        : data;
    },
    getContext: choiceContext,
    plan: async (context, extra, signal) => {
      let realtime, realtimeContext;
      if (extra.action === "replace-leg") {
        realtime = await loadRealtime(network, context.request, signal);
        const current = tokyoNow();
        realtimeContext = {
          nowMinute:
            context.request.date === current.date ? current.minute : null,
          nowEpoch: Date.now(),
        };
      }
      return planInWorker(
        { ...network, services: [], mode: "timetable" },
        context.feeds,
        context.request,
        passState(settings),
        signal,
        { ...extra, realtime, realtimeContext },
      );
    },
    apply(params, journey, context) {
      const data = snapshots.get(params.revision);
      if (
        !data ||
        (data.routeVersions?.[params.index] ?? 0) !== params.routeVersion
      )
        return;
      const rides = journey.legs.map((l) =>
        l.kind === "ride"
          ? scheduledJourney(l, context.mapped, network, context.request.date)
          : null,
      );
      if (data.itinerarySignature) {
        if (itineraryDestinationChanged(getItinerary?.(), getCurrentRide?.()))
          return;
        const updated = updateItineraryRoute(
          getItinerary?.(),
          journey,
          rides,
          params.legIndex,
          data.itinerarySignature,
          tokyoNow(),
        );
        if (!updated) return;
        onItineraryUpdate?.(updated);
        data.itinerarySignature = itineraryRevision(updated);
      }
      data.routes[params.index] = journey;
      data.boarding[params.index] = rides;
      data.routeVersions ??= data.routes.map(() => 0);
      data.routeVersions[params.index] =
        (data.routeVersions[params.index] ?? 0) + 1;
      data.status = ui("route_search_ui_023");
      renderResults();
      persistSnapshots();
      if (data.itinerarySignature) navigation.refresh();
    },
  });
  function renderItinerary({ element }) {
    const plan = getItinerary?.();
    if (!plan) {
      updateHTML(element, ui("route_search_ui_024"));
      return;
    }
    restoreSearch();
    const signature = itineraryRevision(plan);
    let snapshot = [...snapshots.values()].find(
      (data) => data.itinerarySignature === signature,
    );
    if (!snapshot) {
      snapshot = {
        revision: ++searchRevision,
        input: plan.input,
        routes: [plan.route],
        boarding: [plan.rides],
        itinerarySignature: signature,
        order: "arrival",
        status: "",
      };
      snapshots.set(snapshot.revision, snapshot);
      trimSnapshots();
    }
    element.dataset.searchRevision = snapshot.revision;
    const action = itineraryAction(plan),
      riding = plan.phase === "riding",
      walking = plan.phase === "walking",
      changed = itineraryDestinationChanged(plan, getCurrentRide?.()),
      recovery =
        changed || missedConnection(plan, tokyoNow())
          ? ui("route_search_ui_082", [
              changed ? ui("route_search_ui_025") : ui("route_search_ui_026"),
            ])
          : "";
    updateHTML(
      element,
      ui("route_search_ui_083", [
        riding
          ? ui("route_search_ui_027")
          : walking
            ? ui("route_search_ui_028")
            : plan.phase === "arrived"
              ? ui("route_search_ui_029")
              : ui("route_search_ui_030"),
        esc(network.stops.get(action.current.to)?.name ?? action.current.to),
        changed ? ui("route_search_ui_031") : "",
        routeHTML(plan.route, network, [], 0, tokyoNow(), true, {
          readOnly: changed || walking || plan.phase === "arrived",
          hideActions: true,
          lockedThrough: plan.legIndex - (riding ? 0 : 1),
        }),
        recovery,
        plan.phase !== "arrived"
          ? `<footer class="screen-bottom-action"><button class="primary-action" ${riding || walking ? "data-itinerary-next" : "data-board-armed"}>${changed ? ui("route_search_ui_032") : walking ? ui("route_search_ui_033") : riding ? (action.final ? ui("route_search_ui_034") : ui("route_search_ui_035")) : ui("route_search_ui_036")}</button></footer>`
          : "",
      ]),
    );
  }
  navigation.register("journey", {
    title: ui("route_search_ui_037"),
    create({ element }) {
      element.addEventListener("click", handleRouteAction);
      element.addEventListener("click", (event) => {
        if (event.target.closest("[data-itinerary-next]"))
          onItineraryAdvance?.();
        if (event.target.closest("[data-itinerary-recover]")) replan();
      });
    },
    onShow: renderItinerary,
    update: renderItinerary,
  });
  navigation.register("root:search", {
    // The canonical search model owns inputs, including programmatic recovery.
    // Generic DOM snapshots must not restore an older operator selection over it.
    ownsFields: true,
    onShow() {
      restoreSearch();
      if (
        !navigation.recalled("search-input") &&
        !incomingInput &&
        !form.elements.from.value
      ) {
        const stop = onCurrentLocation?.({ silent: true });
        if (stop) {
          form.elements.from.value = stop.name;
          form.elements.fromId.value = stop.id;
        }
      }
      if (incomingInput) {
        applyInput(incomingInput);
        incomingInput = null;
      }
      historyView();
      renderSlots();
    },
    onFocus() {
      if (invalidField) {
        invalidField.focus({ preventScroll: true });
        autocomplete.show(invalidField);
        invalidField = null;
      }
    },
    capture() {
      navigation.remember("search-input", captureInput());
    },
    onHide() {
      autocomplete.close();
    },
  });
  // Old session/history links migrate to the owned Search root.
  navigation.register("search", {
    title: ui("route_search_ui_038"),
    onShow() {
      queueMicrotask(() => navigation.root("search"));
    },
  });
  navigation.register("results", {
    title: ui("route_search_ui_039"),
    singleton: true,
    create({ element }) {
      element.innerHTML = ui("route_search_ui_040");
      const interaction = {
        pointerId: null,
        timer: 0,
        frame: 0,
        lifetime: new AbortController(),
      };
      resultInteractions.set(element, interaction);
      const later = () => {
        cancelAnimationFrame(interaction.frame);
        interaction.frame = requestAnimationFrame(() => {
          if (
            resultFrame === element &&
            element.classList.contains("navigation-current")
          )
            renderResults();
        });
      };
      const release = () => {
        clearTimeout(interaction.timer);
        interaction.pointerId = null;
        later();
      };
      element.addEventListener("pointerdown", (event) => {
        if (
          event.isPrimary &&
          event.button === 0 &&
          event.target.closest(".planner-result")
        ) {
          clearTimeout(interaction.timer);
          interaction.pointerId = event.pointerId;
        }
      });
      // Retain the target through pointerup and the browser's click delivery.
      // A canceled scroll gesture has no click, so it releases immediately.
      window.addEventListener(
        "pointerup",
        (event) => {
          if (event.pointerId === interaction.pointerId)
            interaction.timer = setTimeout(release, 350);
        },
        { signal: interaction.lifetime.signal },
      );
      window.addEventListener(
        "pointercancel",
        (event) => {
          if (event.pointerId === interaction.pointerId) release();
        },
        { signal: interaction.lifetime.signal },
      );
      element.addEventListener("click", release);
      element.addEventListener("focusout", later);
      element.addEventListener("click", handleRouteAction);
      element.addEventListener("click", (e) => {
        const orderButton = e.target.closest("[data-result-order]");
        if (orderButton) {
          const data = snapshots.get(Number(element.dataset.searchRevision));
          if (data) {
            data.order = orderButton.dataset.resultOrder;
            renderResults();
            persistSnapshots();
          }
        }
      });
      element.addEventListener("click", (e) => {
        const data = snapshots.get(Number(element.dataset.searchRevision));
        if (e.target.closest("[data-edit-date]") && data?.input)
          openDate(data.input);
        if (e.target.closest("[data-edit-search]")) {
          applyInput(data?.input);
          navigation.root("search");
        }
        if (
          e.target.closest("[data-next-departure],[data-previous-departure]")
        ) {
          const previous = Boolean(
              e.target.closest("[data-previous-departure]"),
            ),
            input = (previous ? previousDepartureInput : nextDepartureInput)(
              data?.input,
              data?.routes ?? [],
            );
          if (input) {
            applyInput(input);
            previousSearch = previous;
            form.requestSubmit();
          }
        }
        const recovery = e.target.closest("[data-c6-recovery]");
        if (recovery) {
          const kind = recoveryAction(recovery.dataset.c6Recovery);
          if (!kind) return;
          if (data?.input) applyInput(data.input);
          if (kind === "date") openDate(data?.input);
          else if (kind === "filters") openFilter();
          else navigation.root("search");
          return;
        }
        if (e.target.closest("[data-retry-search]")) {
          applyInput(data?.input);
          form.requestSubmit();
        }
      });
    },
    onShow({ element, route }) {
      restoreSearch();
      element.dataset.searchRevision = route.params.revision;
      resultFrame = element;
      renderResults();
      watchObservations(element);
    },
    onHide({ element }) {
      stopObservations(element);
      const interaction = resultInteractions.get(element);
      if (interaction) {
        clearTimeout(interaction.timer);
        cancelAnimationFrame(interaction.frame);
        interaction.pointerId = null;
      }
    },
    onDispose({ element }) {
      const interaction = resultInteractions.get(element);
      if (interaction) {
        clearTimeout(interaction.timer);
        cancelAnimationFrame(interaction.frame);
        interaction.lifetime.abort();
        resultInteractions.delete(element);
      }
      if (resultFrame === element) resultFrame = null;
    },
  });
  function renderRouteDetail({ element, route }) {
    restoreSearch();
    const i = route.params.index,
      data = snapshots.get(route.params.revision);
    element.dataset.searchRevision = route.params.revision;
    element.dataset.routeIndex = i;
    if (!data?.routes[i]) {
      element.innerHTML = ui("route_search_ui_041");
      return;
    }
    const opened = new Set(
      [...element.querySelectorAll("details[open][data-leg-disclosure]")].map(
        (d) => d.dataset.legDisclosure,
      ),
    );
    updateHTML(
      element,
      routeHTML(data.routes[i], network, data.boarding[i], i, tokyoNow(), true),
    );
    element.querySelectorAll("[data-leg-disclosure]").forEach((d) => {
      if (opened.has(d.dataset.legDisclosure)) d.open = true;
    });
  }
  navigation.register("route", {
    title: ui("route_search_ui_042"),
    create({ element }) {
      element.addEventListener("click", handleRouteAction);
      const auxiliaryAction = async (e) => {
        const data = snapshots.get(Number(element.dataset.searchRevision)),
          feedback = element.querySelector("[data-route-feedback]");
        if (!data?.input) return;
        if (e.target.closest("[data-route-more]")) {
          const sheet = document.querySelector("#context-sheet");
          sheet.dataset.detent = "fit";
          openContextSheet(
            ui("route_search_ui_043"),
            ui("route_search_ui_044"),
          );
          const exportImage = async (event) => {
            if (event.target.closest("[data-export-route]")) {
              // WebKit's download navigation can cancel an in-flight History
              // pop. Complete the common dismissal transaction first.
              await navigation.dismissSheet();
              await auxiliaryAction(event);
            }
          };
          sheet.addEventListener("click", exportImage);
          sheet.addEventListener(
            "close",
            () => sheet.removeEventListener("click", exportImage),
            { once: true },
          );
        }
        if (e.target.closest("[data-save-route]")) {
          saveSearchPair(searchStorage(), data.input, { favorite: true });
          historyView();
          feedback.textContent = ui("route_search_ui_045");
        }
        if (e.target.closest?.("[data-export-route]")) {
          const button = e.target.closest("button");
          button.disabled = true;
          try {
            await downloadRouteImage(
              data.routes[Number(element.dataset.routeIndex)],
              network,
              data.input,
            );
            feedback.textContent = ui("route_search_ui_046");
          } catch (error) {
            feedback.textContent = userError(error);
          } finally {
            if (button.isConnected) button.disabled = false;
          }
        }
        if (
          e.type === "mymap-share-route" ||
          e.target.closest?.("[data-share-route]")
        ) {
          const url = searchShareURL(location.href, data.input);
          if (!url) return;
          const text = `${data.input.from} → ${data.input.to}`;
          try {
            if (navigator.share)
              await navigator.share({
                title: ui("route_search_ui_047"),
                text,
                url,
              });
            else if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(url);
              feedback.textContent = ui("route_search_ui_048");
            } else throw Error("clipboard");
          } catch (err) {
            if (err.name !== "AbortError") {
              feedback.replaceChildren(
                document.createTextNode(ui("route_search_ui_049")),
              );
              const link = document.createElement("input");
              link.readOnly = true;
              link.value = url;
              link.setAttribute("aria-label", ui("route_search_ui_050"));
              link.className = "planner-share-link";
              feedback.append(link);
              link.select();
            }
          }
        }
      };
      element.addEventListener("click", auxiliaryAction);
      element.addEventListener("mymap-share-route", auxiliaryAction);
    },
    onShow(context) {
      renderRouteDetail(context);
      watchObservations(context.element);
    },
    onHide({ element }) {
      stopObservations(element);
    },
    update: renderRouteDetail,
  });
  function persistSlots() {
    navigation.remember("search-slots", {
      active: slots.indexOf(activeSlot()),
      slots: slots.map(({ input, revision, stack }) => ({ input, revision, stack })),
    });
  }
  function slotTitle(slot) {
    const input = slot === activeSlot() ? captureInput() : slot.input;
    const from = input?.from?.trim(),
      to = input?.to?.trim();
    return from || to
      ? `${from || "—"} → ${to || "—"}`
      : ui("search_slot_new");
  }
  function slotState(slot) {
    if (slot.job) return ["running", ui("search_slot_running")];
    const data = snapshots.get(slot.revision);
    if (!data) return ["idle", ui("search_slot_idle")];
    return data.routes.length
      ? ["done", ui("search_slot_routes", [data.routes.length])]
      : ["empty", ui("search_slot_none")];
  }
  function renderSlots() {
    const active = activeSlot();
    document.querySelector(".app-shell")?.toggleAttribute("data-search-slots", true);
    const tabs = slots
      .map((slot, i) => {
        const [state, label] = slotState(slot),
          selected = slot === active;
        return `<div class="search-slot-wrap"><button type="button" class="search-slot" data-search-slot="${slot.id}" aria-current="${selected}" data-state="${state}" aria-label="${esc(`${ui("search_slot_number", [i + 1])} ${slotTitle(slot)} ${label}`)}"><span class="search-slot-index" aria-hidden="true">${state === "running" ? '<i class="search-slot-spinner"></i>' : i + 1}</span><span class="search-slot-copy" aria-hidden="true"><b>${esc(slotTitle(slot))}</b><small>${esc(label)}</small></span></button>${selected && slots.length > 1 ? `<button type="button" class="search-slot-close" data-search-slot-close="${slot.id}" aria-label="${esc(ui("search_slot_close", [i + 1]))}"><span aria-hidden="true">×</span></button>` : ""}</div>`;
      })
      .join("");
    const add =
      slots.length < MAX_SLOTS
        ? `<button type="button" class="search-slot-add" data-search-slot-add aria-label="${esc(ui("search_slot_add", [slots.length, MAX_SLOTS]))}">${icon("plus")}</button>`
        : "";
    updateHTML(
      slotStrip,
      `<div class="search-slot-tabs" role="group" aria-label="${esc(ui("search_slot_tabs"))}">${tabs}${add}</div>`,
    );
    // Keep the selected tab in view within the strip (never scroll the page).
    const strip = slotStrip.querySelector(".search-slot-tabs"),
      selected = strip?.querySelector('[aria-current="true"]')?.parentElement;
    if (strip && selected) {
      const left = selected.offsetLeft - strip.offsetLeft,
        right = left + selected.offsetWidth;
      if (left < strip.scrollLeft) strip.scrollLeft = left;
      else if (right > strip.scrollLeft + strip.clientWidth)
        strip.scrollLeft = right - strip.clientWidth;
    }
  }
  // Each slot remembers the screens it had open (results, a route's
  // detail, a stop opened from it), and switching back reopens that last
  // screen rather than the results list.
  let restoringSlot = false;
  const RESULT_SCREENS = new Set(["results", "route"]);
  const settled = (move) =>
    new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        document.removeEventListener("mymap-navigation-change", done);
        resolve();
      };
      const timer = setTimeout(done, 1500);
      document.addEventListener("mymap-navigation-change", done);
      if (move() === false) done();
    });
  function slotScreens(slot) {
    const saved = Array.isArray(slot.stack)
      ? slot.stack
      : slot.revision != null
        ? [{ type: "results", params: { revision: slot.revision } }]
        : [];
    const live = (entry) =>
      !RESULT_SCREENS.has(entry?.type) ||
      snapshots.has(entry.params?.revision) ||
      (slot.job && entry.params?.revision === slot.revision);
    const valid = [];
    for (const entry of saved) {
      if (!entry || typeof entry.type !== "string" || !live(entry)) break;
      valid.push(entry);
    }
    return valid.slice(0, 6);
  }
  async function showSlot(slot) {
    const screens = slotScreens(slot);
    restoringSlot = true;
    try {
      if (navigation.stack.length || navigation.tab !== "search")
        await settled(() => navigation.root("search"));
      for (const entry of screens)
        await settled(() => navigation.push(entry.type, entry.params));
    } finally {
      restoringSlot = false;
      rememberSlotScreens();
    }
  }
  function rememberSlotScreens() {
    if (restoringSlot || navigation.tab !== "search") return;
    activeSlot().stack = navigation.stack;
    persistSlots();
  }
  document.addEventListener("mymap-navigation-change", rememberSlotScreens);
  function blankInput() {
    const current = tokyoNow(),
      stop = onCurrentLocation?.({ silent: true });
    return {
      ...captureInput(),
      from: stop?.name ?? "",
      fromId: stop?.id ?? "",
      to: "",
      toId: "",
      date: current.date,
      time: current.time,
      timeMode: "departure",
      via: [],
    };
  }
  function selectSlot(id, input = null) {
    const current = activeSlot();
    current.input = captureInput();
    activeSlotId = id;
    const next = activeSlot();
    applyInput(input ?? next.input ?? blankInput());
    next.input = captureInput();
    navigation.remember("search-input", next.input);
    autocomplete.close();
    inlineStatus.textContent = "";
    persistSlots();
    renderSlots();
  }
  slotStrip.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-search-slot]");
    if (tab) {
      const id = Number(tab.dataset.searchSlot);
      // The open slot stays where it is; another slot reopens its last screen.
      if (id === activeSlotId && navigation.stack.length) return;
      if (id !== activeSlotId) selectSlot(id);
      void showSlot(activeSlot());
      return;
    }
    if (event.target.closest("[data-search-slot-add]") && slots.length < MAX_SLOTS) {
      const slot = newSlot();
      slots.push(slot);
      selectSlot(slot.id, blankInput());
      navigation.root("search");
      return;
    }
    const close = event.target.closest("[data-search-slot-close]");
    if (close && slots.length > 1) {
      const index = slots.findIndex((slot) => slot.id === Number(close.dataset.searchSlotClose));
      if (index < 0) return;
      const [removed] = slots.splice(index, 1);
      removed.job?.controller.abort();
      activeSlotId = (slots[index] ?? slots[index - 1]).id;
      applyInput(activeSlot().input ?? blankInput());
      navigation.remember("search-input", captureInput());
      persistSlots();
      renderSlots();
      void showSlot(activeSlot());
      slotStrip.querySelector('[aria-current="true"]')?.focus({ preventScroll: true });
    }
  });
  form.addEventListener("input", () => renderSlots());
  function historyView() {
    const pairs = readSearchPairs(searchStorage()),
      open = root.querySelector(".search-history")?.open ?? false;
    root.querySelector("#search-history").innerHTML = ui(
      "route_search_ui_087",
      [
        open ? "open" : "",
        ["favorites", "history"]
          .map(
            (key) =>
              `<div><p class="source-caption">${key === "favorites" ? ui("route_search_ui_051") : ui("route_search_ui_052")}</p>${pairs[key].map((pair, i) => ui("route_search_ui_084", [key, i, esc(pair.from), esc(pair.to), pair.via?.length ? ui("route_search_ui_053", [esc(pair.via.map((v) => v.name).join("・"))]) : "", key, i, esc(pair.from), esc(pair.to), key === "favorites" ? ui("route_search_ui_054") : ui("route_search_ui_055")])).join("") || ui("route_search_ui_056")}</div>`,
          )
          .join(""),
      ],
    );
  }
  historyView();
  renderSlots();
  root.addEventListener("click", (e) => {
    const deleted = e.target.closest("[data-delete-kind]");
    if (deleted) {
      const kind = deleted.dataset.deleteKind,
        pair =
          readSearchPairs(searchStorage())[kind]?.[
            Number(deleted.dataset.deleteIndex)
          ];
      removeSearchPair(searchStorage(), pair, kind);
      historyView();
      inlineStatus.textContent = ui("route_search_ui_057");
      root.querySelector(".search-history > summary")?.focus();
    }
    if (e.target.closest("[data-add-via]")) {
      draftVia.push({ name: "", id: "", dwell: 0 });
      renderVia();
      form.querySelector(`[data-via-index="${draftVia.length - 1}"]`).focus();
    }
    const remove = e.target.closest("[data-remove-via]");
    if (remove) {
      draftVia.splice(Number(remove.dataset.removeVia), 1);
      renderVia();
      form.querySelector("[data-add-via]").focus();
    }
    const quick = e.target.closest("[data-history-kind]");
    if (quick) {
      const pair =
        readSearchPairs(searchStorage())[quick.dataset.historyKind]?.[
          Number(quick.dataset.historyIndex)
        ];
      if (pair) {
        form.elements.from.value = pair.from;
        form.elements.to.value = pair.to;
        form.elements.fromId.value = pair.fromId ?? "";
        form.elements.toId.value = pair.toId ?? "";
        draftVia = (pair.via ?? []).map((v) => ({ ...v }));
        renderVia();
      }
    }
    if (e.target.closest("[data-search-current]")) {
      const stop = onCurrentLocation?.();
      if (stop) {
        form.elements.from.value = stop.name;
        form.elements.fromId.value = stop.id;
        autocomplete.close();
      }
    }
    if (e.target.closest(".planner-swap")) {
      const fromInput = form.elements.from,
        toInput = form.elements.to,
        temp = fromInput.value;
      fromInput.value = toInput.value;
      toInput.value = temp;
      const id = form.elements.fromId.value;
      form.elements.fromId.value = form.elements.toId.value;
      form.elements.toId.value = id;
      autocomplete.close();
    }
    dateChanged();
  });
  const timeModeLabel = (value) =>
    ({
      departure: ui("route_search_ui_058"),
      arrival: ui("route_search_ui_059"),
      first: ui("route_search_ui_060"),
      last: ui("route_search_ui_061"),
    })[value] ?? ui("route_search_ui_062");
  const searchClockLabel = (input) =>
    ["first", "last"].includes(input.timeMode)
      ? timeModeLabel(input.timeMode)
      : `${input.time} ${timeModeLabel(input.timeMode)}`;
  // "Today", "Tomorrow" or a short date such as 10月24日(土).
  const dayLabel = (date) => {
    const today = tokyoNow().date;
    if (date === today) return ui("route_search_ui_063");
    if (date === shiftServiceDate(today, 1)) return ui("search_tomorrow");
    try {
      return new Intl.DateTimeFormat(currentLocale() === "en" ? "en-GB" : "ja-JP", {
        timeZone: "Asia/Tokyo",
        month: currentLocale() === "en" ? "short" : "numeric",
        day: "numeric",
        weekday: "short",
      }).format(new Date(`${date}T12:00:00+09:00`));
    } catch {
      return date;
    }
  };
  const dateChanged = () => {
    const serviceBoundary = ["first", "last"].includes(
      form.elements.timeMode.value,
    );
    form.elements.time.disabled = serviceBoundary;
    for (const block of dateSheet.querySelectorAll("[data-time-block]"))
      block.hidden = serviceBoundary;
    for (const button of dateSheet.querySelectorAll("[data-time-mode]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.timeMode === form.elements.timeMode.value),
      );
    const today = tokyoNow().date;
    // One tap back to "leave now" whenever another time is set.
    const nowButton = root.querySelector("[data-planner-now]");
    if (nowButton)
      nowButton.hidden =
        form.elements.timeMode.value === "departure" &&
        form.elements.date.value === today &&
        Math.abs((minuteValue(form.elements.time.value) ?? 0) - tokyoNow().minute) <= 1;
    for (const button of dateSheet.querySelectorAll("[data-date-offset]"))
      button.setAttribute(
        "aria-pressed",
        String(shiftServiceDate(today, Number(button.dataset.dateOffset)) === form.elements.date.value),
      );
    if (serviceBoundary && !form.elements.time.value)
      form.elements.time.value = tokyoNow().time;
    const ops = form.elements.operators.value.split(",");
    filter
      .querySelectorAll("[data-search-operator]")
      .forEach((el) => (el.checked = ops.includes(el.dataset.searchOperator)));
    const relevant =
      ops.includes("kintetsu") &&
      [
        form.elements.fromId.value,
        form.elements.toId.value,
        ...draftVia.map((v) => v.id),
      ].some((id) => network.stops.get(id)?.type === "kintetsu");
    filter.querySelector("[data-kintetsu-condition]").hidden = !relevant;
    if (!relevant) form.elements.trainType.value = "all";
    root.querySelector("#planner-date-summary").textContent =
      `${dayLabel(form.elements.date.value)} ${searchClockLabel(captureInput())}`;
    root.querySelector("#planner-condition-summary").textContent = ui(
      "route_search_ui_085",
      [
        relevant
          ? {
              all: ui("route_search_ui_064"),
              local: ui("route_search_ui_065"),
              express: ui("route_search_ui_066"),
            }[form.elements.trainType.value] + " · "
          : "",
        form.elements.buffer.value,
        form.elements.maxWalk.value,
      ],
    );
  };
  form.addEventListener("change", (e) => {
    if (e.target.dataset.dwellIndex !== undefined) {
      const v = draftVia[Number(e.target.dataset.dwellIndex)];
      if (v) v.dwell = Number(e.target.value);
    }
    dateChanged();
  });
  form.addEventListener("input", dateChanged);
  filter.addEventListener("change", (event) => {
    if (event.target.matches("[data-search-operator]"))
      form.elements.operators.value = [
        ...filter.querySelectorAll("[data-search-operator]:checked"),
      ]
        .map((el) => el.dataset.searchOperator)
        .join(",");
    dateChanged();
  });
  dateSheet.addEventListener("change", dateChanged);
  form.addEventListener("mymap-search-draft", (e) =>
    applyInput({ ...captureInput(), ...e.detail }),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const previousDeparture = previousSearch;
    previousSearch = false;
    if (filter.open) filter.close();
    if (dateSheet.open) dateSheet.close();
    const active = document.activeElement;
    if (active instanceof HTMLInputElement) active.blur();
    const slot = activeSlot();
    slot.job?.controller.abort();
    const controller = new AbortController();
    const signal = controller.signal,
      endpoints = ["from", "to"].map((name) =>
        resolveStop(
          network,
          form.elements[name].value,
          form.elements[`${name}Id`].value,
        ),
      ),
      [from, to] = endpoints.map((x) => x.stop),
      via = draftVia.map((v) => ({
        ...v,
        resolved: resolveStop(network, v.name, v.id),
      })),
      start = minuteValue(form.elements.time.value);
    if (!form.elements.operators.value) {
      inlineStatus.innerHTML = ui("route_search_ui_067");
      openFilter();
      return;
    }
    const invalid = endpoints.findIndex((x) => !x.stop),
      badVia = via.findIndex((v) => !v.resolved.stop);
    if (invalid >= 0 || badVia >= 0 || !Number.isFinite(start)) {
      const input =
        invalid >= 0
          ? form.elements[["from", "to"][invalid]]
          : badVia >= 0
            ? form.querySelector(`[data-via-index="${badVia}"]`)
            : form.elements.time;
      inlineStatus.innerHTML = ui("route_search_ui_068");
      dateChanged();
      if (
        navigation.tab === "now" &&
        navigation.route.type === "root" &&
        input.matches("[data-stop-input]")
      ) {
        autocomplete.show(input);
      } else if (
        navigation.tab !== "search" ||
        navigation.route.type !== "root"
      ) {
        invalidField = input;
        navigation.root("search");
      } else {
        input.focus();
        if (input.matches("[data-stop-input]")) autocomplete.show(input);
      }
      return;
    }
    autocomplete.close();

    inlineStatus.innerHTML = "";
    const job = {
      revision: ++searchRevision,
      controller,
      routes: [],
      boarding: [],
      status: "",
      order:
        snapshots.get(Number(resultFrame?.dataset.searchRevision))?.order ??
        [...snapshots.values()].at(-1)?.order ??
        "arrival",
    };
    runningJobs.add(job);
    lastJob = job;
    slot.job = job;
    slot.revision = job.revision;
    // Status updates belong to this search, whichever slot is on screen.
    const status = {
      set innerHTML(html) {
        job.status = html;
        publish(job);
      },
    };
    job.description = `${from.name}${via.length ? ` → ${via.map((v) => v.resolved.stop.name).join(" → ")}` : ""} → ${to.name} · ${form.elements.date.value} ${searchClockLabel(captureInput())}`;
    form.elements.from.value = displayStopName(from);
    form.elements.to.value = displayStopName(to);
    form.elements.fromId.value = from.id;
    form.elements.toId.value = to.id;
    via.forEach((v, i) => {
      draftVia[i].id = v.resolved.stop.id;
      draftVia[i].name = v.resolved.stop.name;
      form.querySelector(`[data-via-index="${i}"]`).value =
        v.resolved.stop.name;
    });
    const requestInput = captureInput();
    job.input = requestInput;
    slot.input = requestInput;
    navigation.remember("search-input", requestInput);
    persistSlots();
    navigation.push("results", { revision: job.revision });
    saveSearchPair(searchStorage(), requestInput);
    historyView();
    const request = {
      from: from.id,
      to: to.id,
      date: form.elements.date.value,
      start,
      timeMode: form.elements.timeMode.value,
      via: via.map((v) => ({ stop: v.resolved.stop.id, dwell: v.dwell })),
      buffer: Number(form.elements.buffer.value),
      maxWalk: Number(form.elements.maxWalk.value),
      trainType: form.elements.trainType.value,
      operators: form.elements.operators.value.split(","),
      walkSpeed: form.elements.walkSpeed.value,
    };
    if (previousDeparture) request.previousDeparture = true;
    job.request = request;
    status.innerHTML = ui("route_search_ui_069");
    document.dispatchEvent(new Event("mymap-search-started"));
    try {
      const { feeds, missing } = await loadFeeds(request.date, signal, network);
      const nextDate = nextDaySearch(
        request.date,
        request.start,
        request.timeMode,
      );
      if (nextDate && !signal.aborted) {
        const next = await loadFeeds(nextDate, signal, network);
        feeds.push(...next.feeds);
      }
      if (signal.aborted) return;
      if (!feeds.length) throw userFacingError(ui("route_search_ui_070"));
      feedContexts.set(job.revision, {
        feeds,
        request,
        nextDay: Boolean(nextDate),
      });
      while (feedContexts.size > 5)
        feedContexts.delete(feedContexts.keys().next().value);
      const base = {
        ...network,
        services: [],
        mode: "timetable",
        source: ui("route_search_ui_071"),
      };
      status.innerHTML = ui("route_search_ui_072");
      const { planned, feedMeta } = await planInWorker(
        base,
        feeds,
        request,
        passState(settings),
        signal,
      );
      if (signal.aborted) return;
      const relevantMissing = relevantMissingOperators(
        missing,
        planned,
        from.type,
        to.type,
        from.id,
        to.id,
      );
      if (!planned.length) {
        const missingNote = relevantMissing.length
          ? ui("route_search_ui_073", [
              esc(relevantMissing.map(x =>
                operatorLabel[x.operator] ?? x.operator).join("・")),
            ])
          : "";
        const actions = searchRecoveryOptions(requestInput)
          .map(option => `<button type="button" class="secondary-action" data-c6-recovery="${esc(option.id)}">${esc(ui(`c6_recovery_${option.id}`))}</button>`)
          .join("");
        // Missing timetables, not the conditions, are why nothing was found:
        // offer to try again first.
        status.innerHTML = relevantMissing.length
          ? ui("route_search_data_missing", [
              esc(
                relevantMissing
                  .map((x) => operatorLabel[x.operator] ?? x.operator)
                  .join("・"),
              ),
            ])
          : ui("route_search_ui_086", [
              missingNote + `<div class="c6-search-recovery" role="group" aria-label="${esc(ui("c6_recovery_title"))}">${actions}</div>`,
            ]);
        return;
      }
      const mapped = mergeTimetableFeeds(network, feeds, {
        date: request.date,
      });
      job.boarding = planned.map((r) =>
        r.legs.map((l) => {
          const ride =
            l.kind === "ride"
              ? scheduledJourney(l, mapped, network, request.date)
              : null;
          return ride;
        }),
      );
      job.routes = planned.map((r) => ({
        ...r,
        realtimeSource: "schedule",
      }));
      publish(job);
      persistSnapshots();
      status.innerHTML = ui("route_search_ui_074");
      const live =
        request.date === tokyoNow().date
          ? await loadRealtime(network, request, signal)
          : {};
      if (signal.aborted) return;
      const current = tokyoNow(),
        { planned: adjusted } = await planInWorker(
          base,
          feeds,
          request,
          passState(settings),
          signal,
          {
            action: "realtime",
            journey: planned,
            realtime: live,
            realtimeContext: {
              nowMinute: request.date === current.date ? current.minute : null,
              nowEpoch: Date.now(),
            },
          },
        );
      if (signal.aborted) return;
      job.boarding = adjusted.map((r) =>
        r.legs.map((l) =>
          l.kind === "ride"
            ? scheduledJourney(l, mapped, network, request.date)
            : null,
        ),
      );
      const warnings = feedWarnings(
        feedMeta.filter((m) =>
          planned.some((r) =>
            r.legs.some(
              (l) =>
                l.kind === "ride" &&
                l.operator === m.operator &&
                (!m.route || m.route === l.route),
            ),
          ),
        ),
      );
      status.innerHTML = `${warnings.map((w) => `<p class="planner-warning">${esc(w)}</p>`).join("")}${relevantMissing.length ? ui("route_search_ui_075", [esc(relevantMissing.map((x) => operatorLabel[x.operator] ?? x.operator).join("・"))]) : ""}`;
      job.routes = adjusted;
      publish(job);
      persistSnapshots();
    } catch (err) {
      if (!signal.aborted)
        status.innerHTML = ui("route_search_ui_076", [esc(userError(err))]);
    } finally {
      runningJobs.delete(job);
      if (slot.job === job) slot.job = null;
      renderSlots();
    }
  });
  function persistSnapshots() {
    navigation.remember(
      "search-data",
      [...snapshots.values()].map(({ status, ...data }) => data),
    );
  }
  function search(input, { review = false } = {}) {
    restoreSearch();
    applyInput(input);
    incomingInput = captureInput();
    navigation.remember("search-input", incomingInput);
    navigation.root("search");
    if (!review) form.requestSubmit();
  }
  function replan(avoid = [], options = {}) {
    const plan = options.plan ?? getItinerary?.(),
      ride = getCurrentRide?.(),
      current = tokyoNow(),
      stopId =
        options.stopId ??
        (itineraryDestinationChanged(plan, ride)
          ? ride?.userDestination?.id
          : getRecoveryStop?.()) ??
        ride?.userDestination?.id,
      fallback =
        ride && !plan
          ? {
              ...captureInput(),
              fromId: stopId ?? ride.from,
              toId: ride.userDestination?.id ?? ride.to,
              via: [],
            }
          : ([...snapshots.values()].at(-1)?.input ?? captureInput());
    try {
      const recovery = recoveryInput({
        plan,
        input: plan?.input ?? fallback,
        ride,
        stopId,
        now: current,
        network,
        avoid,
        delay: getRideDelay?.() ?? 0,
        atStop: options.atStop === true,
      });
      if (recovery) {
        const { needsDepartureTime, ...input } = recovery;
        search(input, { review: options.review || needsDepartureTime });
        if (needsDepartureTime)
          inlineStatus.innerHTML = `<p class="planner-warning" role="status">${ui("recovery_time_confirmation")}</p>`;
      } else {
        navigation.root("search");
        inlineStatus.textContent = ui("route_search_ui_077");
      }
    } catch (error) {
      navigation.root("search");
      inlineStatus.innerHTML = `<p class="planner-warning" role="status">${esc(userError(error))}</p>`;
    }
  }
  dateChanged();
  return {
    search,
    replan,
    restoreShared() {
      const input = readSharedSearch(location.href, network);
      if (!input) return;
      restoredSearch = true;
      incomingInput = input;
      applyInput(input);
      const url = new URL(location.href);
      url.searchParams.delete("routeSearch");
      history.replaceState(history.state, "", url);
      inlineStatus.textContent = ui("route_search_ui_078");
      navigation.root("search");
    },
    openInput(input) {
      if (!input) return;
      restoreSearch();
      applyInput(input);
      navigation.remember("search-input", captureInput());
      incomingInput = input;
      navigation.root("search");
    },
    open(to) {
      restoreSearch();
      if (to) {
        form.elements.to.value = to;
        form.elements.toId.value = "";
      }
      navigation.root("search");
    },
    setFrom(value) {
      const stop = network.stops.get(value);
      form.elements.from.value = stop?.name ?? String(value ?? "");
      form.elements.fromId.value = stop?.id ?? "";
      const current = tokyoNow();
      form.elements.date.value = current.date;
      form.elements.time.value = current.time;
      form.elements.timeMode.value = "departure";
      incomingInput = captureInput();
      navigation.root("search");
    },
  };
}
