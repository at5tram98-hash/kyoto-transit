import { navigation } from "./navigation.js";
import { setupSheetGestures } from "./context-sheet.js";
import { readSearchPairs, saveSearchPair } from "./search-history.js";
import { CAPTURE_API } from "./live.js";
import { normalize } from "./network.js";
import { formatTime } from "./router.js";
import { scheduledJourney, boardingAvailable } from "./journey-session.js";
import { applyRealtime, mergeTimetableFeeds } from "./search-core.js";
import { getCached, putCached } from "./realtime.js";
import { relevantMissingOperators } from "./arrival-stability.js";
import { loadNorth3Snapshot, north3Feed } from "./north3-feed.js";

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const yen = (n) =>
  Number.isFinite(n) ? `${Math.round(n).toLocaleString("ja-JP")}円` : "—";
const dot = (source) =>
  `<i class="source-dot ${source === "live" ? "live" : source === "prediction" ? "prediction" : "schedule"}" aria-hidden="true"></i>`;
const operatorLabel = {
  subway: "地下鉄烏丸線",
  kintetsu: "近鉄京都線",
  through: "烏丸線・近鉄直通",
  citybus: "京都市バス",
  kyotobus: "京都バス",
};
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
  const r = await fetch(u, { signal, cache: "no-store" });
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
}
const minuteValue = (value) => {
  const m = String(value).match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const exactStops = (network, value) => {
  const q = normalize(value);
  return [...network.stops.values()].filter((s) =>
    [s.name, s.fullName, ...(s.aliases ?? [])]
      .filter(Boolean)
      .some((n) => normalize(n) === q),
  );
};
function resolvePair(network, fromValue, toValue) {
  const from = exactStops(network, fromValue),
    to = exactStops(network, toValue);
  if (!from.length || !to.length) return [null, null];
  const typeScore = (a, b) =>
    a.type === b.type
      ? 3
      : (a.type === "subway" && b.type === "kintetsu") ||
          (a.type === "kintetsu" && b.type === "subway")
        ? 2
        : 0;
  let best = [from[0], to[0]],
    score = -1;
  for (const a of from)
    for (const b of to) {
      const s =
        typeScore(a, b) +
        (a.id === "B01" && b.type === "kintetsu" ? 2 : 0) +
        (b.id === "B01" && a.type === "kintetsu" ? 2 : 0);
      if (s > score) {
        score = s;
        best = [a, b];
      }
    }
  return best;
}
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
    const data = await api("/api/static/feed", { operator, date }, signal);
    await putCached(key, { data, savedAt: Date.now() });
    return { data, cached: false };
  } catch (error) {
    const cached = await getCached(key);
    if (cached?.data) return { data: cached.data, cached: true };
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
async function planInWorker(base, feeds, request, passes, signal) {
  const payload = { base, feeds, request, passes },
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
      if (data.ok)
        finish(resolve, {
          planned: data.planned ?? [],
          feedMeta: data.feedMeta ?? [],
        });
      else finish(reject, Error(data.error ?? "経路探索に失敗しました。"));
    };
    worker.onerror = (event) =>
      finish(
        reject,
        Error(event.message || "経路探索Workerを起動できませんでした。"),
      );
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.postMessage({ id, ...payload });
  });
}
function routeHTML(
  route,
  network,
  rides = [],
  routeIndex = 0,
  current,
  detail = false,
) {
  const name = (id) => network.stops.get(id)?.name ?? id;
  const available = route.legs
    .map((leg, i) => ({ leg, i }))
    .filter(({ i }) => rides[i]);
  const first = available[0];
  const line = route.legs
    .filter((l) => l.kind === "ride")
    .map((l) =>
      l.route ? `${l.route}系統` : (operatorLabel[l.operator] ?? l.label),
    )
    .join(" → ");
  const walk = route.legs
    .filter((l) => l.kind === "walk")
    .reduce((sum, l) => sum + l.minutes, 0);
  const legs = route.legs
    .map((leg, legIndex) => {
      if (leg.kind !== "ride")
        return `<div class="planner-leg walk"><time>${formatTime(leg.depart)}</time><span class="planner-line"></span><div><b>${leg.kind === "walk" ? "徒歩" : "待ち"} ${leg.minutes}分</b><small>${esc(name(leg.from))}${leg.kind === "walk" ? ` → ${esc(name(leg.to))}` : ""}</small></div></div>`;
      const ride = rides[legIndex];
      return `<div class="planner-leg ride"><time>${formatTime(leg.depart)}</time><span class="planner-line"></span><div><b>${esc(leg.route ? `${leg.route}系統` : (operatorLabel[leg.operator] ?? leg.label))}</b><small>${esc(name(leg.from))} → ${esc(name(leg.to))}</small><small>${esc(leg.destination ?? "行先未確認")}行 · ${formatTime(leg.arrive)}着${leg.realtime?.delay ? ` · +${leg.realtime.delay}分` : ""}</small>${ride && boardingAvailable(ride, current) ? `<button class="plain-action planner-board" data-board-route="${routeIndex}" data-board-leg="${legIndex}">この便に乗車中 · 案内を開始 ›</button>` : ""}${ride && first?.i !== legIndex ? `<button class="plain-action" data-arm-route="${routeIndex}" data-arm-leg="${legIndex}">この区間で案内を準備 ›</button>` : ""}</div></div>`;
    })
    .join("");
  return `<article class="planner-result"><div class="planner-result-head"><span class="planner-badge">${esc(route.optionLabel ?? "候補")}</span><span class="planner-quality">${dot(route.realtimeSource ?? "schedule")}${route.realtimeSource === "live" ? "運行情報反映" : "時刻表"}</span></div><div class="planner-times"><strong>${formatTime(route.start)}</strong><span>→</span><strong>${formatTime(route.time)}</strong><small><b>${route.duration}</b>分</small></div><p class="planner-route-summary">${esc(line)}</p><div class="planner-metrics"><span>乗換 ${route.transfers}回</span><span>徒歩 ${walk}分</span><span>追加 <b>${yen(route.fare.additional)}</b>${route.fare.additional !== route.fare.normal ? `<small>通常 ${yen(route.fare.normal)}</small>` : ""}</span></div><div class="planner-result-actions">${detail ? `<div class="planner-timeline">${legs}</div>${first ? `<div class="screen-bottom-action"><button class="primary-action" data-arm-route="${routeIndex}" data-arm-leg="${first.i}">この経路を使う</button></div>` : ""}` : `<button class="native-row planner-open-route" data-open-route="${routeIndex}"><span>経路詳細</span><span class="chevron">›</span></button>`}</div></article>`;
}
export function mountRouteSearch({
  network,
  settings,
  tokyoNow,
  onBoard,
  onArm,
  onCurrentLocation,
}) {
  const root = document.querySelector("#route-search-root"),
    timetable = document.querySelector("#timetable-root");
  if (!root) return { show() {}, setFrom() {}, openBoard() {} };
  const stopOptions = [...network.stops.values()]
    .map((s) => `<option value="${esc(s.name)}"></option>`)
    .join("");
  let controller = null,
    lastMode = "route",
    boarding = [],
    adjustedRoutes = [],
    resultStatus = "",
    requestDescription = "",
    searchRevision = 0;
  const now = tokyoNow();
  root.innerHTML = `<section id="planner-search"><form class="planner-form" id="planner-form"><datalist id="planner-stops">${stopOptions}</datalist><div class="planner-place-pair"><label><span>出発</span><input name="from" list="planner-stops" value="丸太町" autocomplete="off" required></label><button type="button" class="planner-swap" aria-label="出発と到着を入れ替える">⇅</button><label><span>到着</span><input name="to" list="planner-stops" value="国際会館" autocomplete="off" required></label></div><details class="planner-conditions"><summary><span>日時・検索条件</span><span id="planner-date-summary">${esc(now.time)} 出発</span></summary><div class="planner-date-row"><label><span>日付</span><input type="date" name="date" value="${now.date}" required></label><label><span>時刻</span><input type="time" name="time" value="${now.time}" required></label><label><span>指定</span><select name="timeMode"><option value="departure">出発</option><option value="arrival">到着</option></select></label></div><details class="planner-options"><summary>検索条件</summary><div><label><span>近鉄</span><select name="trainType"><option value="all">普通・急行</option><option value="local">普通のみ</option><option value="express">急行のみ</option></select></label><label><span>乗換余裕</span><select name="buffer"><option value="1">1分</option><option value="3" selected>3分</option><option value="5">5分</option><option value="10">10分</option></select></label><label><span>徒歩上限</span><select name="maxWalk"><option value="10">10分</option><option value="20" selected>20分</option><option value="30">30分</option></select></label></div></details></details><button class="primary-action planner-submit" type="submit">経路を検索</button></form><div class="search-shortcuts"><button type="button" class="secondary-action" data-search-current>現在地から</button><button type="button" class="secondary-action" data-search-save>行き先を保存</button></div><div id="search-history"></div><div id="search-inline-status" aria-live="polite"></div></section>`;
  const inlineStatus = root.querySelector("#search-inline-status"),
    form = root.querySelector("#planner-form");
  const conditions = form.querySelector(".planner-conditions"),
    filter = document.createElement("dialog");
  filter.id = "search-filter";
  filter.className = "sheet";
  filter.setAttribute("aria-labelledby", "search-filter-title");
  filter.innerHTML =
    '<button type="button" class="sheet-drag-handle" aria-label="下へドラッグして閉じる"><span></span></button><div class="sheet-header"><h2 id="search-filter-title">日時・検索条件</h2><button class="sheet-close" type="button" data-search-filter-done aria-label="完了">✓</button></div><div class="sheet-body planner-form"></div>';
  const summary = conditions.querySelector("summary"),
    dateSummary = summary.querySelector("#planner-date-summary");
  const openFilter = document.createElement("button");
  openFilter.type = "button";
  openFilter.className = "planner-conditions";
  openFilter.innerHTML = "<span>日時・検索条件</span>";
  openFilter.append(dateSummary);
  conditions
    .querySelectorAll("input,select")
    .forEach((el) => el.setAttribute("form", "planner-form"));
  filter
    .querySelector(".sheet-body")
    .append(...[...conditions.children].filter((el) => el !== summary));
  conditions.replaceWith(openFilter);
  document.body.append(filter);
  openFilter.addEventListener("click", () => filter.showModal());
  filter
    .querySelector("[data-search-filter-done]")
    .addEventListener("click", () => filter.close());
  setupSheetGestures();
  let resultFrame = null,
    snapshots = new Map(),
    restoredSearch = false;
  function validSnapshot(x) {
    return (
      x &&
      Number.isSafeInteger(x.revision) &&
      Array.isArray(x.routes) &&
      Array.isArray(x.boarding) &&
      x.routes.length <= 12 &&
      x.routes.every(
        (r) =>
          [
            r.start,
            r.time,
            r.duration,
            r.transfers,
            r.fare?.additional,
            r.fare?.normal,
          ].every(Number.isFinite) &&
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
    if (inputs && typeof inputs === "object")
      for (const name of [
        "from",
        "to",
        "date",
        "time",
        "timeMode",
        "trainType",
        "buffer",
        "maxWalk",
      ]) {
        if (typeof inputs[name] === "string" && inputs[name].length < 200)
          form.elements[name].value = inputs[name];
      }
    const saved = navigation.recalled("search-data");
    if (Array.isArray(saved))
      for (const x of saved.slice(-5))
        if (validSnapshot(x)) {
          snapshots.set(x.revision, { ...x, status: "" });
          searchRevision = Math.max(searchRevision, x.revision);
        }
  }
  function publish() {
    snapshots.set(searchRevision, {
      revision: searchRevision,
      routes: adjustedRoutes,
      boarding,
      description: requestDescription,
      status: resultStatus,
    });
    while (snapshots.size > 5) snapshots.delete(snapshots.keys().next().value);
    renderResults();
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
    resultFrame.querySelector("[data-planner-status]").innerHTML =
      data?.status ?? '<p class="empty-state">経路を再検索してください。</p>';
    resultFrame.querySelector("[data-planner-results]").innerHTML = (
      data?.routes ?? []
    )
      .map((r, i) => routeHTML(r, network, data.boarding[i], i, tokyoNow()))
      .join("");
  }
  function handleRouteAction(e) {
    const b = e.target.closest("button");
    if (!b) return;
    const revision = Number(
        b.closest("[data-search-revision]")?.dataset.searchRevision,
      ),
      rides = snapshots.get(revision)?.boarding;
    if (b.dataset.openRoute !== undefined)
      navigation.push("route", {
        index: Number(b.dataset.openRoute),
        revision,
      });
    if (b.dataset.armRoute !== undefined) {
      const ride =
        rides?.[Number(b.dataset.armRoute)]?.[Number(b.dataset.armLeg)];
      if (ride) onArm?.(ride);
    }
    if (b.dataset.boardRoute !== undefined) {
      const ride =
        rides?.[Number(b.dataset.boardRoute)]?.[Number(b.dataset.boardLeg)];
      if (ride && boardingAvailable(ride, tokyoNow())) onBoard?.(ride);
    }
  }
  const searchHome = root.parentElement;
  navigation.register("search", {
    title: "経路検索",
    singleton: true,
    create() {
      root.hidden = false;
      return root;
    },
    onShow({ element }) {
      restoreSearch();
      root.hidden = false;
      element.append(root);
    },
    onFocus() {
      form.elements.to.focus({ preventScroll: true });
    },
    capture() {
      navigation.remember(
        "search-input",
        Object.fromEntries(
          [
            "from",
            "to",
            "date",
            "time",
            "timeMode",
            "trainType",
            "buffer",
            "maxWalk",
          ].map((name) => [name, form.elements[name].value]),
        ),
      );
    },
    onDispose({ element }) {
      if (root.parentElement === element) {
        root.hidden = true;
        searchHome.append(root);
      }
    },
  });
  navigation.register("results", {
    title: "検索結果",
    singleton: true,
    create({ element }) {
      element.innerHTML =
        '<p class="source-caption search-request"></p><div data-planner-status aria-live="polite"></div><div data-planner-results></div>';
      element.addEventListener("click", handleRouteAction);
    },
    onShow({ element, route }) {
      restoreSearch();
      element.dataset.searchRevision = route.params.revision;
      resultFrame = element;
      renderResults();
    },
    onDispose({ element }) {
      if (resultFrame === element) resultFrame = null;
    },
  });
  navigation.register("route", {
    title: "経路詳細",
    create({ element }) {
      element.addEventListener("click", handleRouteAction);
    },
    onShow({ element, route }) {
      restoreSearch();
      const i = route.params.index,
        data = snapshots.get(route.params.revision);
      element.dataset.searchRevision = route.params.revision;
      if (!data?.routes[i]) {
        element.innerHTML =
          '<p class="empty-state">経路を再検索してください。</p>';
        return;
      }
      element.innerHTML = routeHTML(
        data.routes[i],
        network,
        data.boarding[i],
        i,
        tokyoNow(),
        true,
      );
    },
  });
  function historyView() {
    const pairs = readSearchPairs(searchStorage());
    root.querySelector("#search-history").innerHTML =
      `<details class="search-history"><summary>履歴・よく使う行き先</summary>${["favorites", "history"].map((key) => `<div><p class="source-caption">${key === "favorites" ? "よく使う行き先" : "検索履歴"}</p>${pairs[key].map((pair, i) => `<button type="button" class="native-row" data-history-kind="${key}" data-history-index="${i}">${esc(pair.from)} → ${esc(pair.to)}</button>`).join("") || '<p class="source-note">まだありません</p>'}</div>`).join("")}</details>`;
  }
  historyView();
  function setMode(mode) {
    lastMode = mode;
  }
  root.addEventListener("click", (e) => {
    const quick = e.target.closest("[data-history-kind]");
    if (quick) {
      const pair =
        readSearchPairs(searchStorage())[quick.dataset.historyKind]?.[
          Number(quick.dataset.historyIndex)
        ];
      if (pair) {
        form.elements.from.value = pair.from;
        form.elements.to.value = pair.to;
      }
    }
    if (e.target.closest("[data-search-current]")) {
      const stop = onCurrentLocation?.();
      if (stop) form.elements.from.value = stop.name;
    }
    if (e.target.closest("[data-search-save]")) {
      saveSearchPair(
        searchStorage(),
        { from: form.elements.from.value, to: form.elements.to.value },
        { favorite: true },
      );
      historyView();
    }
    if (e.target.closest(".planner-swap")) {
      const fromInput = form.elements.from,
        toInput = form.elements.to,
        temp = fromInput.value;
      fromInput.value = toInput.value;
      toInput.value = temp;
    }
  });
  const dateChanged = () => {
    root.querySelector("#planner-date-summary").textContent =
      `${form.elements.date.value} ${form.elements.time.value} ${form.elements.timeMode.value === "arrival" ? "到着" : "出発"}`;
  };
  form.addEventListener("change", dateChanged);
  filter.addEventListener("change", dateChanged);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (filter.open) filter.close();
    const active = document.activeElement;
    if (active instanceof HTMLInputElement) active.blur();
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal,
      [from, to] = resolvePair(
        network,
        form.elements.from.value,
        form.elements.to.value,
      ),
      start = minuteValue(form.elements.time.value);

    if (!from || !to || !Number.isFinite(start)) {
      inlineStatus.innerHTML =
        '<p class="planner-warning">駅・停留所と時刻を確認してください。</p>';
      return;
    }
    inlineStatus.innerHTML = "";
    searchRevision++;
    adjustedRoutes = [];
    boarding = [];
    requestDescription = `${from.name} → ${to.name} · ${form.elements.date.value} ${form.elements.time.value}`;
    navigation.push("results", { revision: searchRevision });
    saveSearchPair(searchStorage(), { from: from.name, to: to.name });
    historyView();
    const request = {
      from: from.id,
      to: to.id,
      date: form.elements.date.value,
      start,
      timeMode: form.elements.timeMode.value,
      via: [],
      buffer: Number(form.elements.buffer.value),
      maxWalk: Number(form.elements.maxWalk.value),
      trainType: form.elements.trainType.value,
    };
    status.innerHTML = '<p class="loading-note">時刻データを読み込み中…</p>';
    try {
      const { feeds, missing } = await loadFeeds(request.date, signal, network);
      if (signal.aborted) return;
      if (!feeds.length)
        throw Error("この区間の時刻データを取得できませんでした。");
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
        status.innerHTML = `<p class="planner-warning">この条件で利用できる経路がありません。</p>${relevantMissing.length ? `<p class="source-caption">必要な時刻データを取得できません: ${esc(relevantMissing.map((x) => operatorLabel[x.operator] ?? x.operator).join("・"))}</p>` : ""}`;
        return;
      }
      status.innerHTML = '<p class="loading-note">運行状況を反映中…</p>';
      const live = await loadRealtime(network, request, signal);
      if (signal.aborted) return;
      const current = tokyoNow(),
        adjusted = planned.map((r) =>
          applyRealtime(r, live, {
            nowMinute: request.date === current.date ? current.minute : null,
          }),
        ),
        warnings = feedWarnings(
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
      const mapped = mergeTimetableFeeds(network, feeds);
      boarding = planned.map((r) =>
        r.legs.map((l) => {
          const ride =
            l.kind === "ride"
              ? scheduledJourney(l, mapped, network, request.date)
              : null;
          return ride;
        }),
      );
      adjustedRoutes = adjusted;
      publish();
      navigation.remember(
        "search-data",
        [...snapshots.values()].map(({ status, ...data }) => data),
      );
    } catch (err) {
      if (!signal.aborted)
        status.innerHTML = `<p class="planner-warning">${esc(err.message)}</p>`;
    }
  });
  setMode("route");
  return {
    show() {
      setMode(lastMode);
    },
    openBoard() {},
    open(to) {
      if (to) form.elements.to.value = to;
      navigation.push("search");
    },
    setFrom(value) {
      const stop = network.stops.get(value);
      form.elements.from.value = stop?.name ?? String(value ?? "");
      const current = tokyoNow();
      form.elements.date.value = current.date;
      form.elements.time.value = current.time;
      form.elements.timeMode.value = "departure";
      setMode("route");
      navigation.push("search");
    },
  };
}
