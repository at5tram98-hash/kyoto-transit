import { stopSuggestions, stopTypeLabel } from "./route-search-model.js";

// One list belongs to one search screen; hidden screens never own a popup.
export function mountStopAutocomplete({ container, list, network, onSelect }) {
  let active = null,
    rows = [],
    index = -1;
  list.role = "listbox";
  list.setAttribute("aria-label", "駅・停留所の候補");
  list.hidden = true;
  function close() {
    if (active) {
      active.setAttribute("aria-expanded", "false");
      active.removeAttribute("aria-activedescendant");
    }
    list.hidden = true;
    rows = [];
    index = -1;
  }
  function bind(input) {
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("autocomplete", "off");
  }
  function show(input) {
    if (active !== input) close();
    active = input;
    rows = stopSuggestions(network, input.value);
    const box = input.getBoundingClientRect(),
      parent = container.getBoundingClientRect();
    list.style.top = `${box.bottom - parent.top + container.scrollTop}px`;
    list.style.maxHeight = `${Math.max(96, Math.min(280, (globalThis.visualViewport?.height ?? innerHeight) - box.bottom - 16))}px`;
    index = -1;
    list.replaceChildren();
    for (const [i, stop] of rows.entries()) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "stop-suggestion";
      b.id = `${list.id}-${i}`;
      b.role = "option";
      b.tabIndex = -1;
      b.dataset.stopId = stop.id;
      b.setAttribute("aria-selected", "false");
      const name = document.createElement("b"),
        meta = document.createElement("small");
      name.textContent = stop.name;
      meta.textContent = `${stopTypeLabel(stop)} · ${(stop.lines ?? []).join("・")}${/^[KBA]\d+$/.test(stop.id) ? ` · ${stop.id}` : ""}`;
      b.append(name, meta);
      list.append(b);
    }
    list.hidden = !rows.length;
    input.setAttribute("aria-expanded", String(rows.length > 0));
    input.removeAttribute("aria-activedescendant");
  }
  function choose(stop) {
    if (!active || !stop) return;
    const input = active;
    input.value = stop.name;
    onSelect(input, stop);
    close();
    input.focus({ preventScroll: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  container.addEventListener("input", (e) => {
    const input = e.target.closest("[data-stop-input]");
    if (input) {
      onSelect(input, null);
      if (!e.isComposing) show(input);
    }
  });
  container.addEventListener("compositionend", (e) => {
    if (e.target.matches("[data-stop-input]")) show(e.target);
  });
  container.addEventListener("focusin", (e) => {
    if (e.target !== active) close();
  });
  container.addEventListener("focusout", () =>
    queueMicrotask(() => {
      if (!container.contains(document.activeElement)) close();
    }),
  );
  container.addEventListener("keydown", (e) => {
    if (e.target !== active || e.isComposing) return;
    if (e.key === "Escape") {
      close();
      e.preventDefault();
      return;
    }
    if (list.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      index =
        (index + (e.key === "ArrowDown" ? 1 : rows.length - 1) + rows.length) %
        rows.length;
      [...list.children].forEach((b, i) =>
        b.setAttribute("aria-selected", String(i === index)),
      );
      active.setAttribute("aria-activedescendant", list.children[index].id);
      list.children[index].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && index >= 0) {
      e.preventDefault();
      choose(rows[index]);
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
  return { bind, show, close };
}
