import { ui, displayStopName } from "./locale.js";
import { readSavedPlaces } from "./saved-places.js";
import { stopSuggestions, stopTypeLabel } from "./route-search-model.js";
import { readSearchPairs } from "./search-history.js";
import { icon, nearest } from "./vnext-state.js";

// A single full-screen editor owns suggestions. Values commit to the existing
// form; cancellation retains the original input and never creates a new store.
export function mountStopAutocomplete({ container, list, network, onSelect }) {
  let active = null,
    rows = [],
    index = -1;
  const dialog = document.createElement("dialog");
  dialog.className = "sheet suggestion-screen";
  dialog.id = `${list.id}-screen`;
  dialog.setAttribute("aria-label", ui("stop_autocomplete_001"));
  dialog.innerHTML = ui("stop_autocomplete_002");
  const editor = dialog.querySelector("input");
  const home = list.parentElement;
  dialog.querySelector(".suggestion-body").append(list);
  document.body.append(dialog);
  list.role = "listbox";
  list.setAttribute("aria-label", ui("stop_autocomplete_003"));
  editor.setAttribute("role", "combobox");
  editor.setAttribute("aria-autocomplete", "list");
  editor.setAttribute("aria-controls", list.id);
  function close() {
    if (active) {
      active.setAttribute("aria-expanded", "false");
      active.removeAttribute("aria-activedescendant");
    }
    if (dialog.open) dialog.close();
    list.hidden = true;
    rows = [];
    index = -1;
  }
  dialog.addEventListener("close", () => {
    if (active) active.setAttribute("aria-expanded", "false");
    list.hidden = true;
  });
  function bind(input) {
    input.setAttribute("aria-haspopup", "dialog");
    input.setAttribute("aria-controls", dialog.id);
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("autocomplete", "off");
  }
  function render() {
    const q = editor.value.trim();
    let pairs = { history: [], favorites: [] };
    try {
      pairs = readSearchPairs(localStorage);
    } catch {}
    const pairStops = (key) =>
      pairs[key]
        .flatMap((p) => [p.toId, p.fromId])
        .map((id) => network.stops.get(id))
        .filter(Boolean);
    const candidates = stopSuggestions(network, q);
    const matches = (stop) => !q || candidates.some((s) => s.id === stop.id);
    const seen = new Set();
    const groups = [
      [ui("stop_autocomplete_004"), pairStops("history")],
      [
        ui("stop_autocomplete_005"),
        [
          ...readSavedPlaces()
            .map((id) => network.stops.get(id))
            .filter(Boolean),
          ...pairStops("favorites"),
        ],
      ],
      [
        ui("stop_autocomplete_006"),
        nearest()
          .all.slice(0, 5)
          .map((s) => s.stop),
      ],
      [
        ui("stop_autocomplete_007"),
        candidates.filter((stop) => !stop.facilityName),
      ],
      [
        ui("stop_autocomplete_008"),
        candidates.filter((stop) => stop.facilityName),
      ],
    ];
    rows = [];
    index = -1;
    list.replaceChildren();
    for (const [label, stops] of groups) {
      const group = stops.filter(
        (s) => matches(s) && !seen.has(s.id) && seen.add(s.id),
      );
      if (!group.length) continue;
      const heading = document.createElement("p");
      heading.className = "suggestion-section";
      heading.role = "presentation";
      heading.textContent = label;
      list.append(heading);
      for (const stop of group) {
        const i = rows.push(stop) - 1;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "stop-suggestion";
        button.id = `${list.id}-${i}`;
        button.role = "option";
        button.tabIndex = -1;
        button.dataset.stopId = stop.id;
        button.dataset.operator = stop.type;
        button.setAttribute("aria-selected", "false");
        const symbol = document.createElement("span");
        symbol.className = "transport-icon";
        symbol.innerHTML = icon(stop.type.includes("bus") ? "bus" : "train");
        const copy = document.createElement("span"),
          name = document.createElement("b"),
          meta = document.createElement("small");
        name.textContent = displayStopName(stop);
        meta.textContent = `${stop.facilityName ? ui("stop_autocomplete_009", [stop.facilityName]) : ""}${stopTypeLabel(stop)} · ${(stop.lines ?? []).join("・")}${/^[KBA]\d+$/.test(stop.id) ? ` · ${stop.id}` : ""}`;
        copy.append(name, meta);
        button.append(symbol, copy);
        list.append(button);
      }
    }
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = ui("stop_autocomplete_010");
      list.append(empty);
    }
    list.hidden = false;
    editor.setAttribute("aria-expanded", "true");
    editor.removeAttribute("aria-activedescendant");
  }
  function show(input) {
    active = input;
    editor.value = input.value;
    if (!dialog.open) dialog.showModal();
    input.setAttribute("aria-expanded", "true");
    render();
    editor.focus({ preventScroll: true });
    editor.select();
  }
  function choose(stop) {
    if (!active || !stop) return;
    const input = active;
    input.value = displayStopName(stop);
    onSelect(input, stop);
    close();
    input.focus({ preventScroll: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  container.addEventListener("click", (e) => {
    if (e.target.matches("[data-stop-input]")) show(e.target);
  });
  container.addEventListener("input", (e) => {
    if (e.target.matches("[data-stop-input]") && !e.isComposing) {
      onSelect(e.target, null);
      show(e.target);
    }
  });
  container.addEventListener("compositionend", (e) => {
    if (e.target.matches("[data-stop-input]")) show(e.target);
  });
  const draftChanged = () => {
    if (active) {
      active.value = editor.value;
      onSelect(active, null);
      active.dispatchEvent(new Event("change", { bubbles: true }));
    }
    render();
  };
  editor.addEventListener("input", (e) => {
    if (!e.isComposing) draftChanged();
  });
  editor.addEventListener("compositionend", draftChanged);
  dialog
    .querySelector("[data-suggestion-cancel]")
    .addEventListener("click", close);
  dialog.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!rows.length) return;
      index =
        (index + (e.key === "ArrowDown" ? 1 : rows.length - 1) + rows.length) %
        rows.length;
      list
        .querySelectorAll("[role=option]")
        .forEach((b) =>
          b.setAttribute(
            "aria-selected",
            String(b.dataset.stopId === rows[index].id),
          ),
        );
      const selected = list.querySelector(`#${CSS.escape(list.id)}-${index}`);
      editor.setAttribute("aria-activedescendant", selected.id);
      selected.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (index >= 0) choose(rows[index]);
      else if (rows.length === 1) choose(rows[0]);
    }
  });
  list.addEventListener("pointerdown", (e) => {
    if (e.target.closest("[data-stop-id]")) e.preventDefault();
  });
  list.addEventListener("click", (e) =>
    choose(
      network.stops.get(e.target.closest("[data-stop-id]")?.dataset.stopId),
    ),
  );
  return {
    bind,
    show,
    close,
    dispose() {
      close();
      home.append(list);
      dialog.remove();
    },
  };
}
