import { ui } from "./locale.js";
import { foldbackJourney } from "./boarding.js";
import {
  foldbackMeetingPoints,
  nextFoldbackStop,
} from "./foldback-meetings.js";
import { formatMinute } from "./vnext-core.js";
import {
  $,
  esc,
  icon,
  ensureSubwayFeed,
  state,
  tokyoNow,
  haptic,
  rideKey,
  toast,
} from "./vnext-state.js";
import { officialData } from "./timetable-ui.js";
import {
  foldbackCandidates,
  reverseDirection,
  stopTime,
  assessFoldback,
  foldbackServiceDay,
  journeyClock,
} from "./journey-core.js";
import { renderNow } from "./vnext-view.js";

let version = 0,
  controller = null,
  choices = [],
  selected = null,
  opener = null,
  meetingController = null,
  baseChoiceCount = 0;
const category = (entry) =>
  entry.category === "express"
    ? ui("vnext_foldback_001")
    : entry.category === "local"
      ? ui("vnext_foldback_002")
      : entry.category === "other"
        ? ui("vnext_foldback_003")
        : ui("vnext_foldback_004");
function invalidate() {
  version++;
  controller?.abort();
  meetingController?.abort();
  controller = null;
  choices = [];
  baseChoiceCount = 0;
  selected = null;
}
function replaceBody(html) {
  invalidate();
  $("#foldback-body").innerHTML = html;
  $("#foldback-body").scrollTop = 0;
}
const clock = () => journeyClock(state.foldbackRide, tokyoNow());
function stops() {
  return foldbackCandidates(
    state.foldbackRide,
    clock().minute,
    state.rideShift,
  );
}
const options = (items) =>
  items
    .map(
      (s) =>
        `<option value="${esc(s.id)}">${esc(s.name)}${Number.isFinite(stopTime(s)) ? ui("vnext_foldback_005", [formatMinute(Math.round(stopTime(s) + state.rideShift))]) : ui("vnext_foldback_006")}</option>`,
    )
    .join("");
const bufferField = () => ui("vnext_foldback_007");

export function openFoldback() {
  const ride = state.ride;
  if (!ride || ["citybus", "kyotobus"].includes(ride.operator)) return;
  state.foldbackRide = ride;
  const dialog = $("#foldback-sheet");
  if (!dialog.open) opener = document.activeElement;
  replaceBody(
    ui("vnext_foldback_051", [
      [
        ["station", "fold", ui("vnext_foldback_008"), ui("vnext_foldback_009")],
        ["train", "train", ui("vnext_foldback_010"), ui("vnext_foldback_011")],
        ["next", "bolt", ui("vnext_foldback_012"), ui("vnext_foldback_013")],
      ]
        .map(
          ([mode, symbol, title, detail]) =>
            `<button class="choice-row" data-foldback-mode="${mode}"><span class="choice-icon">${icon(symbol)}</span><span><b>${title}</b><small>${detail}</small></span><span>›</span></button>`,
        )
        .join(""),
    ]),
  );
  if (!dialog.open) dialog.showModal();
  $("#foldback-body [data-foldback-mode]")?.focus({ preventScroll: true });
}
function showMode(mode) {
  const items = stops(),
    train = mode === "train";
  $("#foldback-sheet").dataset.foldbackMode = mode;
  replaceBody(
    ui("vnext_foldback_052", [
      train ? ui("vnext_foldback_014") : ui("vnext_foldback_015"),
      train ? ui("vnext_foldback_016") : ui("vnext_foldback_017"),
      train ? ui("vnext_foldback_018") : ui("vnext_foldback_019"),
      train ? "target-station" : "fold-station",
      options(items),
      bufferField(),
      train ? "data-load-target-trains" : "data-foldback-search",
      items.length ? "" : "disabled",
      train ? ui("vnext_foldback_020") : ui("vnext_foldback_021"),
      train ? "target-trains" : "fold-result",
    ]),
  );
  const select = $("#foldback-body select");
  if (mode === "next") {
    const next = nextFoldbackStop(items, state.heroModel);
    if (next) {
      select.value = next.id;
      void load("next");
    } else {
      $("#foldback-body [data-foldback-search]").disabled = true;
      $("#fold-result").innerHTML = ui("vnext_foldback_022");
    }
  } else select?.focus({ preventScroll: true });
}
async function reverseBoard(stopId, signal) {
  const ride = state.foldbackRide,
    reverse = reverseDirection(ride, stopId);
  if (!reverse) throw Error(ui("vnext_foldback_023"));
  const data = await officialData(
      "/timetable/options",
      { stop: stopId },
      signal,
    ),
    board = data.boards?.find((x) => x.key === reverse);
  if (!board) throw Error(ui("vnext_foldback_024"));
  const now = clock(),
    stop = ride.officialStops?.find((s) => s.id === stopId),
    arrival = Number.isFinite(stopTime(stop))
      ? stopTime(stop) + state.rideShift
      : now.minute;
  const days = [{ date: now.date, offset: 0 }];
  if (arrival + Number($("#fold-buffer").value) >= 1440)
    days.push(foldbackServiceDay(now.date, Math.max(1440, arrival)));
  const tables = await Promise.all(
    days.map(async (day) => {
      const table = await officialData(
        "/timetable",
        { stop: stopId, direction: board.key, day: "auto", date: day.date },
        signal,
      );
      return (table.entries ?? []).map((entry) => ({
        ...entry,
        serviceDepart: entry.depart,
        depart: entry.depart + day.offset,
        day: table.day,
        date: day.date,
        sourceURL: table.sourceURL,
      }));
    }),
  );
  const unique = new Map(
    tables
      .flat()
      .filter((e) => Number.isFinite(e.depart))
      .map((e) => [`${e.depart}|${e.tripId ?? ""}|${e.destination ?? ""}`, e]),
  );
  return {
    board,
    entries: [...unique.values()].sort((a, b) => a.depart - b.depart),
  };
}
async function load(mode) {
  const train = mode === "train",
    root = $(train ? "#target-trains" : "#fold-result"),
    select = $(train ? "#target-station" : "#fold-station");
  if (!root || !select) return;
  invalidate();
  const job = version,
    id = select.value,
    ride = state.foldbackRide,
    buffer = Number($("#fold-buffer").value),
    now = clock();
  const stop = ride?.officialStops?.find((s) => s.id === id);
  root.innerHTML = ui("vnext_foldback_025");
  root.setAttribute("aria-busy", "true");
  controller = new AbortController();
  const request = controller,
    timer = setTimeout(() => request.abort(), 20000);
  const current = () =>
    job === version &&
    $("#foldback-sheet").open &&
    ride === state.ride &&
    root.isConnected;
  try {
    const { board, entries } = await reverseBoard(id, request.signal);
    if (!current()) return;
    choices = entries
      .filter(
        (entry) =>
          entry.depart >= now.minute &&
          (train ||
            assessFoldback(stop, entry.depart, {
              shift: state.rideShift,
              buffer,
              now: now.minute,
            }).slack >= 0),
      )
      .slice(0, train ? 16 : 8)
      .map((entry) => ({ ...entry, stopId: id, direction: board.key, buffer }));
    baseChoiceCount = choices.length;
    if (!Number.isFinite(stopTime(stop)) && !train) {
      root.innerHTML = ui("vnext_foldback_026");
      return;
    }
    root.innerHTML = choices.length
      ? `<div class="fold-step"><span>2</span><b>${train ? ui("vnext_foldback_027") : ui("vnext_foldback_028")}</b></div><p class="fold-direction">${esc(board.label)}</p><div class="fold-results">${choices
          .map((entry, i) => {
            const assessment = assessFoldback(stop, entry.depart, {
              shift: state.rideShift,
              buffer,
              now: now.minute,
            });
            return ui("vnext_foldback_053", [
              i,
              formatMinute(entry.depart),
              esc(entry.destination ?? board.label),
              esc(category(entry)),
              entry.tripId ? ui("vnext_foldback_029", [esc(entry.tripId)]) : "",
              assessment.status,
              assessment.status === "unknown"
                ? ui("vnext_foldback_030")
                : assessment.slack < 0
                  ? ui("vnext_foldback_031")
                  : ui("vnext_foldback_032", [Math.floor(assessment.slack)]),
            ]);
          })
          .join("")}</div>`
      : ui("vnext_foldback_033");
    if (mode === "next" && choices.length) evaluate(0);
  } catch (error) {
    if (current() && error.name !== "AbortError")
      root.innerHTML = ui("vnext_foldback_034", [
        esc(error.message),
        train ? "data-load-target-trains" : "data-foldback-search",
      ]);
    else if (current())
      root.innerHTML = ui("vnext_foldback_035", [
        train ? "data-load-target-trains" : "data-foldback-search",
      ]);
  } finally {
    clearTimeout(timer);
    if (current()) root.removeAttribute("aria-busy");
  }
}
function evaluate(index, entry = choices[index]) {
  if (!entry || state.foldbackRide !== state.ride) return;
  const buffer = Number($("#fold-buffer").value),
    stop = state.ride.officialStops?.find((s) => s.id === entry.stopId),
    assessment = assessFoldback(stop, entry.depart, {
      shift: state.rideShift,
      buffer,
      now: clock().minute,
    });
  selected = {
    ...entry,
    buffer,
    choiceIndex: index,
    rideKey: rideKey(state.ride),
  };
  const labels = {
    possible: ui("vnext_foldback_036"),
    tight: ui("vnext_foldback_037"),
    missed: ui("vnext_foldback_038"),
    unknown: ui("vnext_foldback_039"),
  };
  const root = $("#target-trains") ?? $("#fold-result");
  root.innerHTML = ui("vnext_foldback_054", [
    assessment.status,
    labels[assessment.status],
    esc(stop?.name ?? entry.stopId),
    esc(category(entry)),
    esc(entry.destination ?? ui("vnext_foldback_040")),
    Number.isFinite(assessment.arrival)
      ? formatMinute(Math.round(assessment.arrival))
      : ui("vnext_foldback_041"),
    formatMinute(entry.depart),
    buffer,
    Number.isFinite(assessment.slack)
      ? assessment.slack >= 0
        ? ui("vnext_foldback_042", [Math.floor(assessment.slack)])
        : ui("vnext_foldback_043", [Math.ceil(-assessment.slack)])
      : ui("vnext_foldback_044"),
    ["possible", "tight"].includes(assessment.status) ? "" : "disabled",
    $("#target-station") ? "data-load-target-trains" : "data-foldback-search",
  ]);
  root.querySelector(".target-result").focus();
  if ($("#foldback-sheet").dataset.foldbackMode === "train")
    void showMeetingPoints(selected, root);
  haptic();
}
async function showMeetingPoints(entry, root) {
  meetingController?.abort();
  const job = new AbortController();
  meetingController = job;
  const region = document.createElement("section");
  region.className = "foldback-meeting-points";
  region.innerHTML = ui("vnext_foldback_045");
  root.append(region);
  const timer = setTimeout(() => job.abort(), 12000);
  try {
    const reverse = await foldbackJourney(entry, {
      network: state.network,
      subwayFeed: await ensureSubwayFeed(),
      signal: job.signal,
    });
    if (job.signal.aborted || selected !== entry || !region.isConnected) return;
    choices.splice(baseChoiceCount);
    const points = foldbackMeetingPoints(state.ride, reverse, {
      minute: clock().minute,
      shift: state.rideShift,
      buffer: entry.buffer,
      offset: entry.depart - entry.serviceDepart,
      minIndex: state.heroModel?.index ?? 0,
    });
    region.innerHTML = ui("vnext_foldback_055", [
      points.length
        ? `<div class="native-list">${points
            .map((point) => {
              const choiceIndex = choices.length;
              choices.push({
                ...entry,
                stopId: point.stopId,
                depart: point.depart,
                serviceDepart: point.serviceDepart,
              });
              return ui("vnext_foldback_046", [
                choiceIndex,
                esc(point.name),
                formatMinute(Math.round(point.assessment.arrival)),
                formatMinute(point.depart),
                entry.buffer,
                Math.floor(point.assessment.slack),
              ]);
            })
            .join("")}</div>`
        : ui("vnext_foldback_047"),
    ]);
  } catch {
    if (!job.signal.aborted && selected === entry && region.isConnected)
      region.innerHTML = ui("vnext_foldback_048");
  } finally {
    clearTimeout(timer);
  }
}
function save() {
  if (!selected || selected.rideKey !== rideKey(state.ride)) return;
  const stop = state.ride.officialStops?.find((s) => s.id === selected.stopId),
    assessment = assessFoldback(stop, selected.depart, {
      shift: state.rideShift,
      buffer: selected.buffer,
      now: clock().minute,
    });
  if (!["possible", "tight"].includes(assessment.status)) {
    toast(ui("vnext_foldback_049"));
    evaluate(selected.choiceIndex, selected);
    return;
  }
  haptic();
  state.foldbackPlan = selected;
  $("#foldback-sheet").close();
  renderNow();
  toast(ui("vnext_foldback_050"));
}
export function setupFoldback() {
  const dialog = $("#foldback-sheet");
  dialog.addEventListener("close", () => {
    invalidate();
    const target = opener?.isConnected ? opener : $("#ride-foldback");
    target?.focus({ preventScroll: true });
    ((opener = null), (meetingController = null), (baseChoiceCount = 0));
  });
  dialog.addEventListener("change", (e) => {
    if (
      !["fold-station", "target-station", "fold-buffer"].includes(e.target.id)
    )
      return;
    invalidate();
    const root = $("#target-trains") ?? $("#fold-result");
    if (root) {
      root.innerHTML = "";
      root.removeAttribute("aria-busy");
    }
  });
  dialog.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (!button) return;
    if (button.dataset.foldbackMode) showMode(button.dataset.foldbackMode);
    else if (button.hasAttribute("data-foldback-home")) openFoldback();
    else if (button.hasAttribute("data-foldback-search")) void load("station");
    else if (button.hasAttribute("data-load-target-trains")) void load("train");
    else if (button.dataset.targetIndex !== undefined)
      evaluate(Number(button.dataset.targetIndex));
    else if (button.hasAttribute("data-save-foldback")) save();
    else if (button.hasAttribute("data-sheet-close")) dialog.close();
  });
}
