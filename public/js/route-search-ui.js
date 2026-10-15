import { downloadRouteImage } from "./route-image.js";
import { mountSearchHome } from "./route-search-home.js";
import { esc, icon } from "./vnext-state.js";
import { routeHTML, operatorLabel } from "./route-search-view.js";
import { navigation } from "./navigation.js";
import { setupSheetGestures } from "./context-sheet.js";
import {
  readSearchPairs,
  saveSearchPair,
  removeSearchPair,
} from "./search-history.js";
import { mountStopAutocomplete } from "./stop-autocomplete.js";
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
} from "./journey-plan.js";
import { mergeTimetableFeeds } from "./search-core.js";
import { getCached, putCached } from "./realtime.js";
import { relevantMissingOperators } from "./arrival-stability.js";
import { loadNorth3Snapshot, north3Feed } from "./north3-feed.js";

const searchStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};
let plannerSequence = 0;
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
      throw Object.assign(
        Error(data?.error ?? "データを取得できませんでした。"),
        { status: r.status, code: data?.code },
      );
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
            warning: `保存した${operatorLabel[operator] ?? "交通機関"}の時刻表で検索しています。ダイヤ変更をご確認ください。`,
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
        .map(
          (m) => m.warning ?? `${m.operator}の時刻データを確認してください。`,
        ),
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
      } else finish(reject, Error(data.error ?? "経路探索に失敗しました。"));
    };
    worker.onerror = (event) =>
      finish(
        reject,
        Error(event.message || "経路探索Workerを起動できませんでした。"),
      );
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
  onItineraryAdvance,
}) {
  const root = document.querySelector("#route-search-root");
  if (!root) return { show() {}, setFrom() {}, openBoard() {} };
  let controller = null,
    boarding = [],
    adjustedRoutes = [],
    resultStatus = "",
    requestDescription = "",
    searchRevision = 0,
    previousSearch = false,
    requestInput = null,
    requestOrder = "arrival",
    invalidField = null,
    incomingInput = null;
  const feedContexts = new Map();
  const inputSubscribers = new Set();
  let originExplicit = Boolean(navigation.recalled("search-input")?.from);
  let activeRequest = null;
  const now = tokyoNow();
  root.innerHTML = `<section id="planner-search"><form class="planner-form" id="planner-form"><input type="hidden" name="fromId" value=""><input type="hidden" name="toId" value=""><div class="planner-place-pair"><label class="planner-place-field"><span class="place-label">出発</span><input name="from" data-stop-input value="" placeholder="出発地を入力" autocomplete="off" required></label><div class="planner-place-tools"><button class="planner-add-via" type="button" data-add-via>＋ 経由</button><button type="button" class="planner-current" data-search-current aria-label="現在地を出発地にする">${icon("location")}</button><button type="button" class="planner-swap" aria-label="出発と到着を入れ替える">⇅</button></div><div id="planner-via"></div><label class="planner-place-field"><span class="place-label">到着</span><input name="to" data-stop-input value="" autocomplete="off" placeholder="駅・バス停・施設を入力" required></label></div><div id="planner-suggestions" class="stop-suggestions" hidden></div><button class="planner-date-entry" type="button" data-search-date>${icon("now")}<span id="planner-date-summary">${esc(now.time)} 出発</span><small>日時⌄</small></button><button class="planner-conditions" type="button" data-search-filter>${icon("train")}<span id="planner-condition-summary">普通・急行 · 乗換3分</span><small>検索条件⌄</small></button><button class="planner-submit" type="submit">検索</button></form><div id="search-history"></div><div id="search-inline-status" aria-live="polite"></div></section>`;
  const inlineStatus = root.querySelector("#search-inline-status"),
    form = root.querySelector("#planner-form");
  function makeSearchSheet(id, title, body) {
    const dialog = document.createElement("dialog");
    dialog.id = id;
    dialog.className = "sheet";
    dialog.dataset.detent = "medium";
    dialog.setAttribute("aria-labelledby", `${id}-title`);
    dialog.innerHTML = `<button type="button" class="sheet-drag-handle" aria-label="高さを変更・下へドラッグして閉じる"><span></span></button><div class="sheet-header"><h2 id="${id}-title">${title}</h2><button class="sheet-close" type="button" data-search-sheet-done aria-label="完了">✓</button></div><div class="sheet-body planner-form">${body}</div>`;
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
        dialog.close("apply");
      });
    document.body.append(dialog);
    return dialog;
  }
  const dateSheet = makeSearchSheet(
    "search-date",
    "日時",
    `<div class="planner-date-row"><label><span>日付</span><input type="date" name="date" value="${now.date}" required></label><label><span>時刻</span><input type="time" name="time" value="${now.time}" required></label><label><span>指定</span><select name="timeMode"><option value="departure">出発</option><option value="arrival">到着</option></select></label></div>`,
  );
  const filter = makeSearchSheet(
    "search-filter",
    "詳細条件",
    `<div class="planner-filter-fields"><label><span>近鉄の列車</span><select name="trainType"><option value="all">普通・急行</option><option value="local">普通のみ</option><option value="express">急行のみ</option></select></label><label><span>乗換余裕</span><select name="buffer"><option value="1">1分</option><option value="3" selected>3分</option><option value="5">5分</option><option value="10">10分</option></select></label><label><span>徒歩上限</span><select name="maxWalk"><option value="10">10分</option><option value="20" selected>20分</option><option value="30">30分</option></select></label></div>`,
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
    dateSheet.returnValue = "";
    dateSheet.showModal();
  }
  root
    .querySelector("[data-search-date]")
    .addEventListener("click", () => openDate());
  dateSheet.addEventListener("close", () => {
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
  root
    .querySelector("[data-search-filter]")
    .addEventListener("click", () => filter.showModal());
  filter.addEventListener("close", () =>
    navigation.remember("search-input", captureInput()),
  );
  setupSheetGestures();
  let draftVia = [];
  const autocomplete = mountStopAutocomplete({
    container: form,
    list: form.querySelector("#planner-suggestions"),
    network,
    onSelect(input, stop) {
      if (input.name === "from") originExplicit = true;
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
        .map(
          (v, i) =>
            `<div class="planner-via-row"><label><span>経由${i + 1}</span><input data-stop-input data-via-index="${i}" name="via${i}" value="${esc(v.name)}" placeholder="駅・停留所"></label><button class="plain-action" type="button" data-remove-via="${i}" aria-label="経由${i + 1}を削除">−</button><label class="planner-via-dwell"><span>滞在</span><select data-dwell-index="${i}" aria-label="経由${i + 1}の滞在時間">${[
              ...new Set([0, 5, 10, 15, 30, 60, 120, 180, v.dwell]),
            ]
              .sort((a, b) => a - b)
              .map(
                (n) =>
                  `<option value="${n}" ${n === v.dwell ? "selected" : ""}>${n}分</option>`,
              )
              .join("")}</select></label></div>`,
        )
        .join("") +
      (draftVia.length
        ? '<p class="source-caption">経由地で降車し、指定した時間滞在します。0分でも乗換余裕を確保して次の便を探します。</p>'
        : "");
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
      "trainType",
      "buffer",
      "maxWalk",
    ])
      if (typeof input[name] === "string" && input[name].length < 200)
        form.elements[name].value = input[name];
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
    const saved = navigation.recalled("search-data");
    if (Array.isArray(saved))
      for (const x of saved.slice(-5))
        if (validSnapshot(x)) {
          snapshots.set(x.revision, { ...x, status: "" });
          searchRevision = Math.max(searchRevision, x.revision);
        }
  }
  function publish() {
    const previous = snapshots.get(searchRevision);
    snapshots.set(searchRevision, {
      revision: searchRevision,
      routes: adjustedRoutes,
      boarding,
      description: requestDescription,
      status: resultStatus,
      input: requestInput,
      request: activeRequest,
      order: previous?.order ?? requestOrder,
      routeVersions: adjustedRoutes.map(
        (_, i) => previous?.routeVersions?.[i] ?? 0,
      ),
    });
    while (snapshots.size > 5) snapshots.delete(snapshots.keys().next().value);
    renderResults();
    navigation.refresh();
  }
  const status = {
    set innerHTML(html) {
      resultStatus = html;
      publish();
    },
    get innerHTML() {
      return resultStatus;
    },
  };
  function renderResults() {
    if (!resultFrame) return;
    const revision = Number(resultFrame.dataset.searchRevision),
      data = snapshots.get(revision);
    resultFrame.querySelector(".search-request").textContent =
      data?.description ?? "";
    updateHTML(
      resultFrame.querySelector("[data-planner-status]"),
      data?.status ?? '<p class="empty-state">経路を再検索してください。</p>',
    );
    resultFrame.querySelectorAll("[data-result-order]").forEach((button) => {
      const selected =
        button.dataset.resultOrder === (data?.order ?? "arrival");
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    resultFrame.querySelector("[data-result-clock]").textContent = data?.input
      ? `${data.input.time} ${data.input.timeMode === "arrival" ? "到着" : "出発"}`
      : "—";
    resultFrame.querySelector("[data-result-date]").textContent = data?.input
      ?.date
      ? new Intl.DateTimeFormat("ja-JP", {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "long",
          day: "numeric",
          weekday: "short",
        }).format(new Date(`${data.input.date}T12:00:00+09:00`))
      : "";
    resultFrame.querySelector("[data-result-places]").textContent = data?.input
      ? `${data.input.from} → ${data.input.to}`
      : "検索結果";
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
    updateHTML(
      resultFrame.querySelector("[data-planner-results]"),
      sortedRouteIndexes(data?.routes ?? [], data?.order)
        .map((i, position) =>
          routeHTML(
            data.routes[i],
            network,
            data.boarding[i],
            i,
            tokyoNow(),
            false,
            {
              position: position + 1,
              recommendations: ["arrival", "transfers", "fare"].filter(
                (key) => {
                  const value = (r) =>
                    key === "arrival"
                      ? r.time
                      : key === "transfers"
                        ? r.transfers
                        : r.fare.additional;
                  return (
                    Number.isFinite(value(data.routes[i])) &&
                    value(data.routes[i]) ===
                      Math.min(
                        ...data.routes.map(value).filter(Number.isFinite),
                      )
                  );
                },
              ),
            },
          ),
        )
        .join(""),
    );
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
        controller?.abort();
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
        if (feedback)
          feedback.textContent =
            "後続の接続がありません。別の便を選んでください。";
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
    if (!input)
      throw Error(
        "検索条件を再取得できません。元の経路へ戻って再検索してください。",
      );
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
    };
  }
  async function choiceContext(data, legIndex, signal) {
    const request = requestFor(data);
    let context = feedContexts.get(data.revision);
    if (!context) {
      const loaded = await loadFeeds(request.date, signal, network);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!loaded.feeds.length)
        throw Error(
          "この運行日の公式時刻表を取得できません。元の経路は保持しています。",
        );
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
      return snapshots.get(revision);
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
      data.routes[params.index] = journey;
      data.boarding[params.index] = rides;
      data.routeVersions ??= data.routes.map(() => 0);
      data.routeVersions[params.index] =
        (data.routeVersions[params.index] ?? 0) + 1;
      data.status =
        '<p class="source-caption">選択した便から後続の接続・運賃を再計算しました。</p>';
      renderResults();
      persistSnapshots();
    },
  });
  function renderItinerary({ element }) {
    const plan = getItinerary?.();
    if (!plan) {
      updateHTML(
        element,
        '<p class="empty-state">案内中の旅程はありません。</p>',
      );
      return;
    }
    const action = itineraryAction(plan),
      riding = plan.phase === "riding",
      walking = plan.phase === "walking",
      changed = itineraryDestinationChanged(plan, getCurrentRide?.());
    updateHTML(
      element,
      `<p class="source-caption">${riding ? "乗車中" : walking ? "降車後の徒歩・滞在" : plan.phase === "arrived" ? "旅程を終了" : "次の便の案内を準備"} · ${esc(network.stops.get(action.current.to)?.name ?? action.current.to)}で降車予定</p>${changed ? '<p class="planner-warning">降車地点を変更したため、以下は元の旅程です。後続区間は再検索してください。</p>' : ""}${routeHTML(plan.route, network, [], 0, tokyoNow(), true, { readOnly: true, hideActions: true })}${plan.phase !== "arrived" ? `<footer class="screen-bottom-action"><button class="primary-action" ${riding || walking ? "data-itinerary-next" : "data-board-armed"}>${changed ? "降車して変更した旅程を終了" : walking ? "目的地に到着しました" : riding ? (action.final ? "降車してこの区間を終了" : "降車して次の区間へ") : "この便に乗車中 · 案内を開始"}</button></footer>` : ""}`,
    );
  }
  navigation.register("journey", {
    title: "旅程",
    create({ element }) {
      element.addEventListener("click", (event) => {
        if (event.target.closest("[data-itinerary-next]"))
          onItineraryAdvance?.();
      });
    },
    onShow: renderItinerary,
    update: renderItinerary,
  });
  navigation.register("root:search", {
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
    title: "検索",
    onShow() {
      queueMicrotask(() => navigation.root("search"));
    },
  });
  navigation.register("results", {
    title: "検索結果",
    singleton: true,
    create({ element }) {
      element.innerHTML = `<button type="button" class="result-places" data-result-places data-edit-search aria-label="出発・到着と検索条件を変更"></button><div class="result-departure-toolbar"><button type="button" class="departure-neighbor" data-previous-departure hidden>‹ 1本前</button><button type="button" class="result-search-condition" data-edit-date aria-label="日時を変更"><time data-result-date></time><time data-result-clock></time><span class="search-request sr-only"></span></button><button type="button" class="departure-neighbor" data-next-departure hidden>1本後 ›</button></div><div class="result-order" role="group" aria-label="経路の表示順"><button type="button" data-result-order="arrival" aria-label="早い・到着が早い順" aria-pressed="true"><i class="route-rank arrival" aria-hidden="true">早</i><span>時間順</span></button><button type="button" data-result-order="transfers" aria-label="楽・乗換が少ない順" aria-pressed="false"><i class="route-rank transfers" aria-hidden="true">楽</i><span>回数順</span></button><button type="button" data-result-order="fare" aria-label="安い・追加運賃が安い順" aria-pressed="false"><i class="route-rank fare" aria-hidden="true">安</i><span>料金順</span></button></div><div data-planner-status aria-live="polite"></div><div data-planner-results></div>`;
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
          navigation.root(navigation.tab === "now" ? "now" : "search");
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
    },
    onHide({ element }) {
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
      element.innerHTML =
        '<p class="empty-state">経路を再検索してください。</p>';
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
    title: "経路詳細",
    create({ element }) {
      element.addEventListener("click", handleRouteAction);
      const auxiliaryAction = async (e) => {
        const data = snapshots.get(Number(element.dataset.searchRevision)),
          feedback = element.querySelector("[data-route-feedback]");
        if (!data?.input) return;
        if (e.target.closest("[data-save-route]")) {
          saveSearchPair(searchStorage(), data.input, { favorite: true });
          historyView();
          feedback.textContent = "よく使う行き先に保存しました。";
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
            feedback.textContent = "経路画像を保存しました。";
          } catch (error) {
            feedback.textContent = error.message;
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
              await navigator.share({ title: "MyMap 経路検索", text, url });
            else if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(url);
              feedback.textContent =
                "検索条件のリンクをコピーしました。開いた先で最新の経路を検索できます。";
            } else throw Error("clipboard");
          } catch (err) {
            if (err.name !== "AbortError") {
              feedback.replaceChildren(
                document.createTextNode(
                  "このリンクから同じ条件で検索できます。",
                ),
              );
              const link = document.createElement("input");
              link.readOnly = true;
              link.value = url;
              link.setAttribute("aria-label", "共有する検索条件のリンク");
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
    onShow: renderRouteDetail,
    update: renderRouteDetail,
  });
  function historyView() {
    const pairs = readSearchPairs(searchStorage()),
      open = root.querySelector(".search-history")?.open ?? false;
    root.querySelector("#search-history").innerHTML =
      `<details class="search-history" ${open ? "open" : ""}><summary tabindex="0">履歴・よく使う行き先</summary>${["favorites", "history"].map((key) => `<div><p class="source-caption">${key === "favorites" ? "よく使う行き先" : "検索履歴"}</p>${pairs[key].map((pair, i) => `<div class="search-history-row"><button type="button" class="native-row" data-history-kind="${key}" data-history-index="${i}">${esc(pair.from)} → ${esc(pair.to)}${pair.via?.length ? `<small>経由 ${esc(pair.via.map((v) => v.name).join("・"))}</small>` : ""}</button><button type="button" class="plain-action" data-delete-kind="${key}" data-delete-index="${i}" aria-label="${esc(pair.from)}から${esc(pair.to)}の${key === "favorites" ? "保存" : "履歴"}を削除">削除</button></div>`).join("") || '<p class="source-note">まだありません</p>'}</div>`).join("")}</details>`;
  }
  historyView();
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
      inlineStatus.textContent = "削除しました。";
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
  const dateChanged = () => {
    root.querySelector("#planner-date-summary").textContent =
      `${form.elements.date.value === tokyoNow().date ? "今日" : form.elements.date.value} ${form.elements.time.value} ${form.elements.timeMode.value === "arrival" ? "到着" : "出発"}`;
    root.querySelector("#planner-condition-summary").textContent =
      `${{ all: "普通・急行", local: "普通のみ", express: "急行のみ" }[form.elements.trainType.value]} · 乗換${form.elements.buffer.value}分 · 徒歩${form.elements.maxWalk.value}分以内`;
    for (const listener of inputSubscribers) listener();
  };
  form.addEventListener("change", (e) => {
    if (e.target.dataset.dwellIndex !== undefined) {
      const v = draftVia[Number(e.target.dataset.dwellIndex)];
      if (v) v.dwell = Number(e.target.value);
    }
    dateChanged();
  });
  form.addEventListener("input", dateChanged);
  filter.addEventListener("change", dateChanged);
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
    controller?.abort();
    controller = new AbortController();
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
    const invalid = endpoints.findIndex((x) => !x.stop),
      badVia = via.findIndex((v) => !v.resolved.stop);
    if (invalid >= 0 || badVia >= 0 || !Number.isFinite(start)) {
      const input =
        invalid >= 0
          ? form.elements[["from", "to"][invalid]]
          : badVia >= 0
            ? form.querySelector(`[data-via-index="${badVia}"]`)
            : form.elements.time;
      inlineStatus.innerHTML =
        '<p class="planner-warning">駅・停留所を候補から選択してください。同名の地点は交通機関を確認してください。</p>';
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
    requestOrder =
      snapshots.get(Number(resultFrame?.dataset.searchRevision))?.order ??
      [...snapshots.values()].at(-1)?.order ??
      "arrival";
    searchRevision++;
    adjustedRoutes = [];
    boarding = [];
    requestDescription = `${from.name}${via.length ? ` → ${via.map((v) => v.resolved.stop.name).join(" → ")}` : ""} → ${to.name} · ${form.elements.date.value} ${form.elements.time.value} ${form.elements.timeMode.value === "arrival" ? "到着" : "出発"}`;
    form.elements.from.value = from.name;
    form.elements.to.value = to.name;
    form.elements.fromId.value = from.id;
    form.elements.toId.value = to.id;
    via.forEach((v, i) => {
      draftVia[i].id = v.resolved.stop.id;
      draftVia[i].name = v.resolved.stop.name;
      form.querySelector(`[data-via-index="${i}"]`).value =
        v.resolved.stop.name;
    });
    requestInput = captureInput();
    navigation.remember("search-input", requestInput);
    navigation.push("results", { revision: searchRevision });
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
    };
    if (previousDeparture) request.previousDeparture = true;
    activeRequest = request;
    status.innerHTML = '<p class="loading-note">時刻データを読み込み中…</p>';
    document.dispatchEvent(new Event("mymap-search-started"));
    try {
      const { feeds, missing } = await loadFeeds(request.date, signal, network);
      if (signal.aborted) return;
      if (!feeds.length)
        throw Error("この区間の時刻データを取得できませんでした。");
      feedContexts.set(searchRevision, { feeds, request });
      while (feedContexts.size > 3)
        feedContexts.delete(feedContexts.keys().next().value);
      const base = {
        ...network,
        services: [],
        mode: "timetable",
        source: "静的時刻表",
      };
      status.innerHTML = '<p class="loading-note">最適な経路を計算中…</p>';
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
        status.innerHTML = `<p class="planner-warning">この条件で利用できる経路がありません。時刻・経由地・徒歩上限を変更してお試しください。</p>${relevantMissing.length ? `<p class="source-caption">必要な時刻データを取得できません: ${esc(relevantMissing.map((x) => operatorLabel[x.operator] ?? x.operator).join("・"))}</p>` : ""}`;
        return;
      }
      const mapped = mergeTimetableFeeds(network, feeds, {
        date: request.date,
      });
      boarding = planned.map((r) =>
        r.legs.map((l) => {
          const ride =
            l.kind === "ride"
              ? scheduledJourney(l, mapped, network, request.date)
              : null;
          return ride;
        }),
      );
      adjustedRoutes = planned.map((r) => ({
        ...r,
        realtimeSource: "schedule",
      }));
      publish();
      persistSnapshots();
      status.innerHTML = '<p class="loading-note">運行状況を反映中…</p>';
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
      boarding = adjusted.map((r) =>
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
      status.innerHTML = `${warnings.map((w) => `<p class="planner-warning">${esc(w)}</p>`).join("")}${relevantMissing.length ? `<p class="source-caption">この経路で必要な一部データを取得できません: ${esc(relevantMissing.map((x) => operatorLabel[x.operator] ?? x.operator).join("・"))}</p>` : ""}`;
      adjustedRoutes = adjusted;
      publish();
      persistSnapshots();
    } catch (err) {
      if (!signal.aborted)
        status.innerHTML = `<p class="planner-warning">${esc(err.message)}</p><button type="button" class="plain-action" data-retry-search>この条件で再試行</button>`;
    }
  });
  function persistSnapshots() {
    navigation.remember(
      "search-data",
      [...snapshots.values()].map(({ status, ...data }) => data),
    );
  }
  dateChanged();
  function syncLocation() {
    if (
      originExplicit ||
      form.elements.from.value ||
      document.querySelector(".suggestion-screen[open]")
    )
      return;
    const stop = onCurrentLocation?.({ silent: true });
    if (stop) {
      form.elements.from.value = stop.name;
      form.elements.fromId.value = stop.id;
      dateChanged();
    }
  }
  function homeField(name) {
    if (name === "from") originExplicit = true;
    const input = form.elements[name];
    if (input?.matches("[data-stop-input]")) autocomplete.show(input);
  }
  function rememberInput() {
    navigation.remember("search-input", captureInput());
    dateChanged();
  }
  function homeHistory() {
    const pairs = readSearchPairs(searchStorage());
    return [...pairs.favorites, ...pairs.history]
      .filter(
        (p, i, a) =>
          a.findIndex((q) => q.from === p.from && q.to === p.to) === i,
      )
      .slice(0, 3);
  }
  return {
    mountHome(host) {
      restoreSearch();
      mountSearchHome(host, {
        input: captureInput,
        dateLabel: () =>
          root.querySelector("#planner-date-summary").textContent,
        feedback: () => inlineStatus.textContent,
        history: homeHistory,
        mode: () => navigation.recalled("now-home-page") ?? "route",
        setMode: (mode) => navigation.remember("now-home-page", mode),
        subscribe: (listener) => inputSubscribers.add(listener),
        syncLocation,
        openField: homeField,
        openDate: () => root.querySelector("[data-search-date]").click(),
        openFilter: (name) => {
          filter.showModal();
          if (name) filter.querySelector(`[name="${name}"]`)?.focus();
        },
        openPass: () => navigation.push("setting", { id: "pass" }),
        current: () => {
          root.querySelector("[data-search-current]").click();
          rememberInput();
        },
        swap: () => {
          root.querySelector(".planner-swap").click();
          rememberInput();
        },
        addVia: () => {
          if (draftVia.length >= 3) return;
          draftVia.push({ name: "", id: "", dwell: 0 });
          renderVia();
          dateChanged();
          homeField(`via${draftVia.length - 1}`);
        },
        removeVia: (index) => {
          draftVia.splice(index, 1);
          renderVia();
          rememberInput();
        },
        useHistory: (index) => {
          const pair = homeHistory()[index];
          if (pair) {
            applyInput({ ...captureInput(), ...pair });
            rememberInput();
          }
        },
        submit: () => {
          syncLocation();
          const missing = ["from", "to"].find(
            (name) => !form.elements[name].value.trim(),
          );
          if (missing) {
            inlineStatus.textContent =
              missing === "from"
                ? "出発地を選択してください。"
                : "到着地を選択してください。";
            dateChanged();
            homeField(missing);
            return;
          }
          if (
            !form.elements.date.checkValidity() ||
            !form.elements.time.checkValidity()
          ) {
            dateSheet.showModal();
            return;
          }
          form.requestSubmit();
        },
      });
      syncLocation();
      dateChanged();
    },
    restoreShared() {
      const input = readSharedSearch(location.href, network);
      if (!input) return;
      restoredSearch = true;
      incomingInput = input;
      applyInput(input);
      const url = new URL(location.href);
      url.searchParams.delete("routeSearch");
      history.replaceState(history.state, "", url);
      inlineStatus.textContent =
        "共有された条件です。経路を検索して最新の時刻をご確認ください。";
      navigation.root("search");
    },
    openInput(input) {
      if (!input) return;
      restoreSearch();
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
