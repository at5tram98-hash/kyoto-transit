import { readOperationsCache, saveOperationsCache } from "./fast-data.js";
import { icon } from "./icons.js";
import { lineBadge } from "./line-badge.js";
import { ui, placeName, userFacingError, userError } from "./locale.js";
import {
  operationStatus,
  operationsFreshness,
  journeyOperationStatus,
  operationIds,
  operationGroups,
  disruptedOperators,
} from "./operation-status.js";
import { updateHTML } from "./view-rendering.js";
import { serviceEndHTML, serviceEndState } from "./service-end.js";
import { navigation } from "./navigation.js";
import { CAPTURE_API } from "./live.js";
import { searchStops } from "./network.js";
import { formatTime } from "./router.js";
import { officialTripLeg } from "./vehicle.js";
import { boardingAvailable, scheduledBoarding } from "./journey-session.js";
import { scheduledJourney } from "./journey-session.js";
import {
  loadNorth3Snapshot,
  north3Board,
  north3Feed,
  north3Day,
} from "./north3-feed.js";
let fallbackNetwork;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const transitSymbol = (bus) => icon(bus ? "bus" : "train");
const kind = (e) =>
  e.route ??
  (e.category === "express"
    ? ui("timetable_ui_001")
    : e.category === "local"
      ? ui("timetable_ui_002")
      : e.category === "other"
        ? ui("timetable_ui_003")
        : ui("timetable_ui_004"));
export async function officialData(path, params = {}, signal) {
  const localStop = fallbackNetwork?.stops.get(params.stop);
  if (
    localStop?.lines?.includes(ui("timetable_ui_005")) &&
    (path === "/timetable/options" ||
      String(params.direction).startsWith("north3:"))
  ) {
    const snapshot = await loadNorth3Snapshot();
    if (signal?.aborted) throw signal.reason;
    const name = localStop.fullName ?? localStop.name;
    if (path === "/timetable/options") {
      const row = snapshot.rows.find((r) => r.name === name);
      if (row) {
        const boards = ["north", "south"]
          .filter((direction) =>
            north3Board(snapshot, name, direction, "weekday"),
          )
          .map((direction) => ({
            key: `north3:${direction}`,
            label: ui("timetable_ui_074", [
              direction === "north"
                ? ui("timetable_ui_006")
                : ui("timetable_ui_007"),
            ]),
            routes: [ui("timetable_ui_008")],
          }));
        // Retain every existing direction and append the locally available route.
        let remote = [];
        try {
          const url = new URL(path, CAPTURE_API);
          url.searchParams.set("stop", params.stop);
          const r = await fetch(url, {
            signal: signal ?? AbortSignal.timeout(4000),
          });
          if (r.ok) remote = (await r.json()).boards ?? [];
        } catch {
          if (signal?.aborted) throw signal.reason;
        }
        return {
          stop: params.stop,
          name: localStop.name,
          operator: "citybus",
          boards: [...remote, ...boards],
        };
      }
    } else if (path === "/timetable") {
      const day = params.day === "auto" ? north3Day(params.date) : params.day;
      if (!day) throw userFacingError(ui("timetable_ui_009"));
      const direction = params.direction.split(":")[1],
        board = north3Board(snapshot, name, direction, day);
      if (!board) throw userFacingError(ui("timetable_ui_010"));
      return {
        ...board,
        entries: board.entries.map((entry, i) => ({
          ...entry,
          tripId: `north3:${params.date}:${direction}:${i}`,
        })),
      };
    }
  }
  const url = new URL(path, CAPTURE_API);
  for (const [k, v] of Object.entries(params))
    if (v !== null && v !== undefined) url.searchParams.set(k, v);
  const timeout = AbortSignal.timeout(20000),
    r = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    }),
    d = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(Error(`HTTP ${r.status}`), {
      status: r.status,
      detail: d.error,
      fallback: ui("timetable_ui_011"),
    });
  return d;
}
export const dayLabel = {
  weekday: ui("timetable_ui_012"),
  saturday: ui("timetable_ui_013"),
  holiday: ui("timetable_ui_014"),
  weekday_a: ui("timetable_ui_015"),
  weekday_b: ui("timetable_ui_016"),
  wednesday_a: ui("timetable_ui_017"),
};
export function stopTable(
  stops,
  { shift = 0, now = -Infinity, nextId = null } = {},
) {
  return `<ol class="stop-timeline">${stops
    .map((s, i) => {
      const time = s.arrival ?? s.time ?? s.departure,
        late = Number.isFinite(time) && time + shift < now;
      return `<li class="${late ? "passed" : ""} ${s.id === nextId ? "next-stop" : ""}"><span class="timeline-dot"></span><span><b>${esc(s.name)}</b>${i === stops.length - 1 ? ui("timetable_ui_018") : s.id === nextId ? ui("timetable_ui_019") : ""}</span><time>${Number.isFinite(time) ? formatTime(Math.round(time + shift)) : "—"}${shift && Number.isFinite(time) ? ui("timetable_ui_020", [formatTime(time)]) : ""}</time></li>`;
    })
    .join("")}</ol>`;
}
// Today's board after its last departure (or in the small hours before the
// first): today's service has ended.
function endBanner(board, today, minute) {
  if (!today || !board?.entries?.length) return "";
  const departs = board.entries.map((e) => e.depart).filter(Number.isFinite);
  if (!departs.length) return "";
  const day = { first: Math.min(...departs), last: Math.max(...departs) };
  return serviceEndHTML(serviceEndState(day, minute), day);
}

export function mountTimetables({
  network,
  getState,
  getNearby = () => [],
  now,
  setTab,
  onBoard,
  loadSubwayFeed,
}) {
  fallbackNetwork = network;
  const root = document.querySelector("#timetable-root");
  let chosen = null,
    options = null,
    board = null,
    controller,
    job = 0,
    tripController,
    tripJob = 0,
    activeTrip = null,
    boardForToday = false;
  root.innerHTML = ui("timetable_ui_021");
  const boardElement = root.querySelector("#timetable-board"),
    tripElement = root.querySelector("#timetable-trip");
  const $ = (s) =>
    s === "#timetable-board"
      ? boardElement
      : s === "#timetable-trip"
        ? tripElement
        : (root.querySelector(s) ??
          boardElement.querySelector(s) ??
          tripElement.querySelector(s));
  navigation.register("board", {
    title: (r) =>
      network.stops.get(r.params.stopId)?.name ?? ui("timetable_ui_022"),
    singleton: true,
    create() {
      boardElement.hidden = false;
      return boardElement;
    },
    onShow({ element, route }) {
      element.append(boardElement);
      boardElement.hidden = false;
      if (chosen !== route.params.stopId || !options)
        return select(route.params.stopId);
    },
    onDispose({ element }) {
      if (boardElement.parentElement === element) {
        boardElement.hidden = true;
        root.append(boardElement);
      }
    },
  });
  navigation.register("trip", {
    title: ui("timetable_ui_023"),
    singleton: true,
    create() {
      tripElement.hidden = false;
      return tripElement;
    },
    async onShow({ element, route }) {
      element.append(tripElement);
      tripElement.hidden = false;
      if (!board || chosen !== route.params.stopId) {
        tripElement.querySelector("#timetable-trip-content").innerHTML =
          ui("timetable_ui_024");
        await select(route.params.stopId);
      }
      if (!board) {
        tripElement.querySelector("#timetable-trip-content").innerHTML =
          ui("timetable_ui_025");
        return;
      }
      const index = route.params.tripId
        ? board?.entries.findIndex((e) => e.tripId === route.params.tripId)
        : route.params.index;
      if (!Number.isInteger(index) || index < 0) {
        tripElement.querySelector("#timetable-trip-content").innerHTML =
          ui("timetable_ui_026");
        return;
      }
      if (!activeTrip || tripElement.dataset.index !== String(index))
        return openTrip(index);
    },
    onHide() {
      tripController?.abort();
    },
    onDispose({ element }) {
      if (tripElement.parentElement === element) {
        tripElement.hidden = true;
        root.append(tripElement);
      }
    },
  });

  function closeTrip() {
    tripController?.abort();
    tripJob++;
    activeTrip = null;
  }

  function list() {
    const q = $("#timetable-search").value.trim(),
      favorites = getState().favorites ?? [],
      saved = favorites.map((id) => network.stops.get(id)).filter(Boolean),
      nearby = getNearby()
        .map((x) => x.stop)
        .filter((s) => s && !favorites.includes(s.id))
        .slice(0, 5);
    const section = (title, stops) =>
      stops.length
        ? `<h2 class="native-section-label">${title}</h2>${rows(stops)}`
        : "";
    $("#timetable-stop-list").innerHTML = q
      ? section(ui("timetable_ui_027"), searchStops(network, q).slice(0, 50)) ||
        ui("timetable_ui_028")
      : section(ui("timetable_ui_029"), saved) +
        section(ui("timetable_ui_030"), nearby) +
        ui("timetable_ui_075", [
          [
            ["subway", ui("timetable_ui_031")],
            ["kintetsu", ui("timetable_ui_032")],
            ["citybus", ui("timetable_ui_033")],
            ["kyotobus", ui("timetable_ui_034")],
          ]
            .map(
              ([id, label]) =>
                `<button class="native-row" data-timetable-line="${id}" data-operator="${id}"><span class="transport-icon">${transitSymbol(id.includes("bus"))}</span><span><b>${label}</b></span><span class="chevron">›</span></button>`,
            )
            .join(""),
        ]);
  }
  navigation.register("timetable-line", {
    title: (route) =>
      ({
        subway: ui("timetable_ui_035"),
        kintetsu: ui("timetable_ui_036"),
        citybus: ui("timetable_ui_037"),
        kyotobus: ui("timetable_ui_038"),
      })[route.params.id] ?? ui("timetable_ui_039"),
    onShow({ element, route }) {
      element.innerHTML = rows(
        [...network.stops.values()].filter((s) => s.type === route.params.id),
      );
    },
    create({ element }) {
      element.addEventListener("click", (e) => {
        const b = e.target.closest("[data-timetable-stop]");
        if (b) navigation.push("board", { stopId: b.dataset.timetableStop });
      });
    },
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-timetable-line]");
    if (b) navigation.push("timetable-line", { id: b.dataset.timetableLine });
  });
  function rows(stops) {
    return `<div class="native-list">${stops.map((s) => `<button class="native-row" data-timetable-stop="${esc(s.id)}"><span class="transport-icon" data-operator="${esc(s.type)}">${transitSymbol(s.type.includes("bus"))}</span><span><b>${esc(s.name)}</b>${s.type.includes("bus") ? `<small class="row-line-badges" aria-label="${esc(s.lines.join("・"))}">${s.lines.map((r) => lineBadge({ operator: s.type, route: r }, { size: "small" })).join("")}</small>` : `<small>${esc(s.lines.join("・"))}</small>`}</span><span class="chev">›</span></button>`).join("")}</div>`;
  }
  async function select(id) {
    if (chosen !== id) {
      options = null;
      board = null;
    }
    chosen = id;
    closeTrip();

    controller?.abort();
    controller = new AbortController();
    const current = ++job;

    $("#timetable-board").hidden = false;
    $("#timetable-board").innerHTML = ui("timetable_ui_040");
    try {
      const data = await officialData(
        "/timetable/options",
        { stop: id },
        controller.signal,
      );
      if (current !== job) return;
      options = data;
      boardElement.dataset.operator =
        options.operator ?? network.stops.get(id)?.type;
      $("#timetable-board").innerHTML = ui("timetable_ui_041", [
        esc(options.name),
        options.boards
          .map((b) => `<option value="${esc(b.key)}">${esc(b.label)}</option>`)
          .join(""),
        Object.entries(dayLabel)
          .map(([k, v]) => `<option value="${k}">${v}</option>`)
          .join(""),
        ["weekday", "saturday", "holiday"]
          .map(
            (day) =>
              `<button type="button" data-board-day="${day}" aria-pressed="false">${dayLabel[day]}</button>`,
          )
          .join(""),
      ]);
      const saved = navigation.recalled("timetable-selection");
      if (saved?.stopId === id) {
        if (options.boards.some((b) => b.key === saved.direction))
          $("#timetable-direction").value = saved.direction;
        if (saved.day === "auto" || dayLabel[saved.day])
          $("#timetable-day").value = saved.day;
      }
      await loadBoard();
    } catch (e) {
      if (current === job && !controller.signal.aborted)
        $("#timetable-board").innerHTML =
          `<p class="empty-note">${esc(userError(e))}</p>`;
    }
  }
  async function loadBoard() {
    closeTrip();
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal,
      current = ++job,
      direction = $("#timetable-direction").value,
      day = $("#timetable-day").value;
    navigation.remember("timetable-selection", {
      stopId: chosen,
      direction,
      day,
    });
    boardElement
      .querySelectorAll("[data-board-day]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.boardDay === day)),
      );
    $("#timetable-entries").innerHTML = ui("timetable_ui_042");
    try {
      const data = await officialData(
        "/timetable",
        { stop: chosen, direction, day, date: now().date },
        signal,
      );
      if (current !== job) return;
      board = data;
      if (Array.isArray(board.dayKeys)) {
        boardElement
          .querySelectorAll("[data-board-day]")
          .forEach(
            (button) =>
              (button.disabled = !board.dayKeys.includes(
                button.dataset.boardDay,
              )),
          );
        [...$("#timetable-day").options].forEach(
          (option) =>
            (option.disabled =
              option.value !== "auto" && !board.dayKeys.includes(option.value)),
        );
      }
      boardElement
        .querySelectorAll("[data-board-day]")
        .forEach((b) =>
          b.setAttribute(
            "aria-pressed",
            String(b.dataset.boardDay === (day === "auto" ? board.day : day)),
          ),
        );
      boardForToday = day === "auto";
      const hours = new Map();
      for (const e of board.entries) {
        const h = Math.floor(e.depart / 60);
        if (!hours.has(h)) hours.set(h, []);
        hours.get(h).push(e);
      }
      $("#timetable-entries").innerHTML = ui("timetable_ui_079", [
        esc(dayLabel[board.day] ?? board.day),
        board.platform ? ui("timetable_ui_043", [esc(board.platform)]) : "",
        esc(board.effective ?? ""),
        hours.size
          ? `${endBanner(board, boardForToday, now().minute)}<div class="hour-table">${[...hours].map(([h, entries]) => ui("timetable_ui_076", [h % 24, entries.map((e) => `<button class="minute-cell ${e.category === "express" ? "express" : ""}${boardForToday && e.depart < now().minute ? " passed" : ""}" ${e.tripId || (options.operator === "subway" && boardForToday) ? `data-timetable-entry="${board.entries.indexOf(e)}"` : "disabled"} aria-label="${formatTime(e.depart)} ${esc(placeName(e.destination))} ${esc(kind(e))}"><b>${String(e.depart % 60).padStart(2, "0")}</b>${e.category || e.route ? `<small>${esc(kind(e))}</small>` : ""}${e.originating === true || /当駅始発|この駅始発/.test(e.note ?? "") ? ui("timetable_ui_044") : ""}${e.platform ? ui("timetable_ui_045", [esc(e.platform)]) : ""}${e.destination ? `<span>${esc(placeName(e.destination))}</span>` : ""}${e.operatingCompany === "kyotobus" ? ui("timetable_ui_046") : ""}</button>`).join("")])).join("")}</div>`
          : ui("timetable_ui_047"),
        board.cached ? ui("timetable_ui_048") : ui("timetable_ui_049"),
        new Date(board.fetchedAt).toLocaleTimeString("ja-JP", {
          timeZone: "Asia/Tokyo",
          hour: "2-digit",
          minute: "2-digit",
        }),
        esc(board.sourceURL),
        board.dayRequired ? ui("timetable_ui_050") : "",
      ]);
    } catch (e) {
      if (current === job && !controller.signal.aborted)
        $("#timetable-entries").innerHTML =
          `<p class="empty-note">${esc(userError(e))}</p>`;
    }
  }
  root.addEventListener("input", (e) => {
    if (e.target.id === "timetable-search") {
      list();
    }
  });
  boardElement.addEventListener("click", (e) => {
    const b = e.target.closest("[data-board-day]");
    if (b) {
      $("#timetable-day").value = b.dataset.boardDay;
      void loadBoard();
    }
  });
  boardElement.addEventListener("change", (e) => {
    if (["timetable-direction", "timetable-day"].includes(e.target.id))
      loadBoard();
  });
  async function openTrip(index) {
    const entry = board?.entries?.[Number(index)];
    if (!entry) return;
    closeTrip();
    tripController = new AbortController();
    const signal = tripController.signal,
      current = ++tripJob,
      id = chosen,
      direction = $("#timetable-direction").value,
      serviceDate = now().date,
      today = boardForToday;
    $("#timetable-trip-content").innerHTML = ui("timetable_ui_051");
    tripElement.dataset.index = String(index);
    try {
      let trip, ride;
      if (direction.startsWith("north3:")) {
        const snapshot = await loadNorth3Snapshot(),
          feed = north3Feed(snapshot, network, serviceDate, {
            day: board.day,
            schoolDay: true,
          });
        const service = feed?.services.find(
          (s) => s.id === `north3-${direction.split(":")[1]}`,
        );
        ride =
          service &&
          scheduledJourney(
            { serviceId: service.id, tripId: entry.tripId, from: id },
            feed,
            network,
            serviceDate,
          );
        if (!ride) throw userFacingError(ui("timetable_ui_052"));
        trip = {
          title: ui("timetable_ui_053", [ride.destination]),
          stops: ride.officialStops,
        };
      } else if (options.operator === "subway") {
        const feed = await loadSubwayFeed?.();
        if (signal.aborted || current !== tripJob) return;
        ride = scheduledBoarding(
          feed,
          {
            stopId: id,
            date: serviceDate,
            depart: entry.depart,
            destination: entry.destination,
            direction,
            tripId: entry.tripId,
          },
          network,
        );
        if (!ride) throw userFacingError(ui("timetable_ui_054"));
        trip = {
          title: ui("timetable_ui_055", [ride.destination]),
          stops: ride.officialStops,
        };
      } else {
        trip = await officialData(
          "/timetable/trip",
          { stop: id, direction, day: board.day, trip: entry.tripId },
          signal,
        );
        ride = officialTripLeg(
          {
            ...trip,
            operator: trip.operator ?? options.operator,
            boardStop: id,
            date: serviceDate,
          },
          network,
        );
      }
      if (
        signal.aborted ||
        current !== tripJob ||
        navigation.route.type !== "trip"
      )
        return;
      activeTrip = today ? ride : null;
      $("#timetable-trip-content").innerHTML = ui("timetable_ui_077", [
        esc(trip.title),
        activeTrip && boardingAvailable(activeTrip, now())
          ? ui("timetable_ui_056")
          : "",
        stopTable(trip.stops),
        today ? "" : ui("timetable_ui_057"),
      ]);
    } catch (err) {
      if (!signal.aborted && current === tripJob)
        $("#timetable-trip-content").innerHTML = ui("timetable_ui_058", [
          esc(userError(err)),
          index,
        ]);
    }
  }
  const handleClick = (e) => {
    if (
      e.currentTarget === root &&
      e.target.closest("#timetable-board,#timetable-trip")
    )
      return;
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.timetableStop)
      navigation.push("board", { stopId: b.dataset.timetableStop });
    else if (b.hasAttribute("data-timetable-back")) {
      controller?.abort();
      job++;

      list();
    } else if (b.hasAttribute("data-close-trip")) navigation.pop();
    else if (b.dataset.timetableEntry !== undefined)
      navigation.push("trip", {
        index: Number(b.dataset.timetableEntry),
        stopId: chosen,
        tripId: board.entries[Number(b.dataset.timetableEntry)]?.tripId ?? null,
      });
    else if (b.dataset.retryTrip !== undefined) openTrip(b.dataset.retryTrip);
    else if (
      b.hasAttribute("data-board-trip") &&
      activeTrip &&
      boardingAvailable(activeTrip, now())
    ) {
      const ride = activeTrip;
      onBoard?.(ride);
    }
  };
  [root, boardElement, tripElement].forEach((el) =>
    el.addEventListener("click", handleClick),
  );
  list();
  return {
    select(id) {
      navigation.root("timetable");
      navigation.push("board", { stopId: id });
    },
    show() {
      list();
    },
  };
}
export function mountOperations({
  getUsedOperators = () => [],
  getCurrentOperators = getUsedOperators,
  onReplan,
  getFavorites = () => [],
  setFavorites = () => {},
} = {}) {
  const root = document.querySelector("#operations-root");
  let last = 0,
    pending = null,
    latest = null;
  const versions = new WeakMap();
  const isSaved = (id) => operationIds(getFavorites()).includes(id);
  const bookmark =
    icon("bookmark");
  function detail(element, route) {
    const lines =
      latest?.lines?.filter(
        (l) =>
          !route.params.id || operationIds([route.params.id]).includes(l.id),
      ) ?? [];
    updateHTML(
      element,
      lines.length ? lines.map(operationHTML).join("") : ui("timetable_ui_059"),
    );
  }
  navigation.register("operation", {
    title: ui("timetable_ui_060"),
    create({ element, route }) {
      element.addEventListener("click", (e) => {
        const save = e.target.closest("[data-operation-save]");
        if (save) {
          const id = save.dataset.operationSave,
            ids = operationIds(getFavorites());
          setFavorites(
            ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
          );
          detail(element, route);
          renderOverview();
        }
        const avoid = e.target.closest("[data-operation-avoid]");
        if (avoid) onReplan?.([avoid.dataset.operationAvoid]);
        if (e.target.closest("[data-operation-retry]"))
          void refresh(true).then(() => detail(element, route));
      });
    },
    async onShow({ element, route }) {
      const version = (versions.get(element) ?? 0) + 1;
      versions.set(element, version);
      if (!latest) updateHTML(element, ui("timetable_ui_061"));
      else detail(element, route);
      await refresh();
      if (versions.get(element) === version) detail(element, route);
    },
    onHide({ element }) {
      versions.set(element, (versions.get(element) ?? 0) + 1);
    },
    update({ element, route }) {
      if (latest) detail(element, route);
    },
  });
  function operationHTML(l) {
    const status = operationStatus(l),
      saved = isSaved(l.id);
    return ui("timetable_ui_081", [
      status.kind,
      esc(l.name),
      esc(status.label),
      esc(l.summary),
      esc(l.id),
      saved,
      bookmark,
      saved ? ui("timetable_ui_062") : ui("timetable_ui_063"),
      esc(l.id),
      (l.routes ?? []).map((r) => `<span>${esc(r)}</span>`).join(""),
      l.notices?.length
        ? `<ul class="operation-notices">${l.notices.map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)} ›</a></li>`).join("")}</ul>`
        : "",
      l.fetchedAt
        ? ui("timetable_ui_080") +
          new Date(l.fetchedAt).toLocaleTimeString("ja-JP", {
            timeZone: "Asia/Tokyo",
            hour: "2-digit",
            minute: "2-digit",
          })
        : ui("timetable_ui_064"),
    ]);
  }
  // Show the last status at once (up to six hours old, with its time) while
  // the latest is fetched, instead of a blank loading screen.
  const cachedOperations = readOperationsCache(6 * 3600_000);
  if (cachedOperations?.lines?.length) {
    latest = cachedOperations;
    queueMicrotask(() => renderOverview());
  } else root.innerHTML = ui("timetable_ui_065");
  async function refresh(force = false) {
    if (pending) return pending;
    if (!force && latest && Date.now() - last < 60000) return;
    root.setAttribute("aria-busy", "true");
    setRefreshing(true);
    pending = (async () => {
      try {
        const d = await officialData("/operations");
        last = Date.now();
        latest = d;
        saveOperationsCache(d);
        renderOverview();
      } catch (e) {
        if (!latest) root.innerHTML = ui("timetable_ui_066", [esc(userError(e, "operations_unavailable"))]);
        else {
          renderOverview();
          root.insertAdjacentHTML("afterbegin", ui("timetable_ui_067"));
        }
      } finally {
        pending = null;
        root.removeAttribute("aria-busy");
        setRefreshing(false);
      }
    })();
    return pending;
  }
  // The refresh button says it is working (and cannot be pressed twice)
  // until the official pages answer, then returns to "Refresh".
  // The label only changes when the answer takes longer than 250 ms, so a
  // cached reply does not make the button text flicker.
  let refreshLabelTimer = 0;
  function setRefreshing(on) {
    clearTimeout(refreshLabelTimer);
    const button = root.querySelector("[data-operations-refresh]");
    if (!button) return;
    if (on)
      refreshLabelTimer = setTimeout(() => {
        const current = root.querySelector("[data-operations-refresh]");
        if (!pending || !current) return;
        current.dataset.label ??= current.textContent;
        current.textContent = ui("operations_refreshing");
        current.disabled = true;
      }, 250);
    else if (button.dataset.label) {
      button.textContent = button.dataset.label;
      delete button.dataset.label;
    }
    button.disabled = on;
    button.toggleAttribute("aria-busy", on);
  }
  function freshnessHTML() {
    const fresh = operationsFreshness(latest);
    return fresh
      ? `<time class="operations-updated" datetime="${new Date(fresh.fetchedAt).toISOString()}"${fresh.stale ? ' data-stale="true"' : ""}>${esc(fresh.label)}</time>`
      : "";
  }
  function renderOverview() {
    if (!latest) return;
    const groups = operationGroups(
        latest.lines,
        getUsedOperators(),
        getFavorites(),
      ),
      selected = groups.current,
      others = groups.others,
      saved = groups.favorites,
      summary = journeyOperationStatus(latest.lines, getCurrentOperators()),
      list = (lines) =>
        `<div class="native-list">${lines
          .map((l) => {
            const status = operationStatus(l);
            return `<button class="native-row operation-row" data-operation-id="${esc(l.id)}" data-status="${status.kind}"><span class="operation-indicator" aria-label="${status.label}">${status.symbol}</span><span><b>${esc(l.name)}</b><small>${esc(l.summary)}</small></span><span class="chevron">›</span></button>`;
          })
          .join("")}</div>`;
    updateHTML(
      root,
      ui("timetable_ui_078", [
        summary.kind,
        summary.kind === "success"
          ? "✓ "
          : summary.kind === "danger"
            ? "! "
            : "",
        esc(summary.title),
        esc(summary.detail),
        getCurrentOperators().length
          ? `<button type="button" class="plain-action" data-operations-replan>${disruptedOperators(latest.lines, getCurrentOperators()).length ? ui("timetable_ui_068") : ui("timetable_ui_069")}</button>`
          : "",
        selected.length ? ui("timetable_ui_070", [list(selected)]) : "",
        saved.length ? ui("timetable_ui_071", [list(saved)]) : "",
        selected.length || saved.length
          ? ui("timetable_ui_072")
          : ui("timetable_ui_073"),
        list(others),
        esc(latest.notice),
        freshnessHTML(),
      ]),
    );
  }
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-operations-replan]"))
      onReplan?.(
        disruptedOperators(latest?.lines ?? [], getCurrentOperators()),
      );
    if (e.target.closest("[data-operations-refresh]")) refresh(true);
    if (e.target.closest("[data-operations-arrivals]"))
      navigation.push("arrivals");
    const b = e.target.closest("[data-operation-id]");
    if (b) navigation.push("operation", { id: b.dataset.operationId });
  });
  return {
    async show() {
      await refresh();
      renderOverview();
    },
  };
}
