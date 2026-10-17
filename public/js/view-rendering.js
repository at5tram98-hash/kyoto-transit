import { ui } from "./locale.js";
import { animateState as animate } from "./navigation-motion.js";
// Preserve DOM nodes when the visible content has not changed.
const markup = new WeakMap();
export function updateHTML(element, html) {
  if (markup.get(element) === html || element.innerHTML === html) {
    markup.set(element, html);
    return false;
  }
  element.innerHTML = html;
  markup.set(element, html);
  return true;
}

const rowViews = new WeakMap();
const fields = [
  "service",
  "destination",
  "minutes",
  "delay",
  "details",
  "source",
  "second",
];
// Compare the presentation, not timestamps or diagnostic metadata. Unchanged
// responses must not replace rows, restart their animations, or announce them.
export function updateArrivalRows(root, rows, present) {
  const previous = [...root.children].filter((el) => el.dataset.key);
  const old = new Map(previous.map((el) => [el.dataset.key, el]));
  if (!rows.length) {
    if (previous.length) {
      root.replaceChildren();
      markup.delete(root);
    }
    return;
  }
  markup.delete(root);
  const motion =
    !document.hidden &&
    !root.closest("[hidden]") &&
    !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const reordered = previous.some(
    (el, i) => el.dataset.key !== String(rows[i]?.key),
  );
  const positions =
    motion && reordered
      ? new Map(previous.map((el) => [el, el.getBoundingClientRect().top]))
      : new Map();
  [...root.children]
    .filter((el) => !el.dataset.key)
    .forEach((el) => el.remove());
  let before = root.firstElementChild;

  rows.forEach((row, index) => {
    const key = String(row.key),
      view = present(row);
    let el = old.get(key),
      created = !el;
    if (created) {
      el = document.createElement("article");
      el.className = "arrival-line";
      el.dataset.key = key;
      el.innerHTML =
        '<div class="arrival-service" data-field="service"></div>' +
        '<div class="arrival-dest" data-field="destination"></div>' +
        '<strong class="arrival-minutes" data-field="minutes"></strong>' +
        '<span class="arrival-delay" data-field="delay"></span>' +
        '<div class="arrival-details" data-field="details"></div>' +
        '<div class="arrival-source" data-field="source"></div>' +
        '<div class="arrival-second" data-field="second" hidden></div>' +
        '<div class="arrival-approach" data-field="approach" hidden></div>' +
        ui("view_rendering_006");
      const toggle = el.querySelector(".arrival-toggle");
      toggle.addEventListener("click", () => {
        const expanded = el.classList.toggle("expanded");
        toggle.setAttribute("aria-expanded", String(expanded));
      });
      rowViews.set(el, {});
    }
    const cached = rowViews.get(el);
    el.classList.toggle("imminent", Boolean(view.imminent));
    el.classList.toggle("delayed", Boolean(view.delayed));
    el.dataset.operator = view.operator ?? "citybus";
    const toggle = el.querySelector(".arrival-toggle");
    if (toggle)
      toggle.setAttribute(
        "aria-label",
        ui("view_rendering_004", [
          row.route ?? row.label ?? "",
          row.dest ?? "",
          el.classList.contains("expanded")
            ? ui("view_rendering_001")
            : ui("view_rendering_002"),
        ]),
      );
    for (const field of fields) {
      if (cached[field] === view[field]) continue;
      const target = el.querySelector(`[data-field="${field}"]`);
      target.innerHTML = view[field] ?? "";
      target.hidden = !view[field];
      if (field === "minutes" && !created && motion && index < 12) {
        animate(target, [
          { opacity: 0.4, transform: "translateY(4px)" },
          { opacity: 1, transform: "translateY(0)" },
        ]);
      }
      cached[field] = view[field];
    }
    const approach = el.querySelector('[data-field="approach"]');
    approach.hidden = !Number.isFinite(view.stopsAway);
    if (!approach.hidden) {
      if (!approach.firstElementChild) {
        approach.innerHTML =
          ui("view_rendering_007") +
          '<div class="arrival-track" aria-hidden="true">' +
          '<div class="arrival-track-stops">' +
          "<i></i>".repeat(7) +
          "</div>" +
          '<div class="arrival-track-position"><span class="arrival-track-vehicle">' +
          '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="15" rx="4"/><path d="M4 11h16M8 19v2m8-2v2M8 15h.01M16 15h.01"/></svg>' +
          "</span></div></div>";
      }
      const position = `${(1 - Math.min(6, Math.max(0, view.stopsAway)) / 6) * 100}%`;
      if (cached.position !== position)
        approach.style.setProperty("--approach-position", position);
      cached.position = position;
      const label = ui("view_rendering_005", [
        view.approachLabel ?? ui("view_rendering_003"),
        Math.max(0, Math.round(view.stopsAway)),
      ]);
      if (approach.getAttribute("aria-label") !== label)
        approach.setAttribute("aria-label", label);
    }
    if (el !== before) root.insertBefore(el, before);
    before = el.nextElementSibling;
    old.delete(key);
    if (created && motion && index < 12) {
      animate(
        el,
        [
          { opacity: 0, transform: "translateY(6px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { delay: Math.min(index, 5) * 20 },
      );
    }
  });
  for (const el of old.values()) el.remove();
  if (positions.size) {
    const moves = [...positions]
      .filter(([el]) => el.parentElement === root)
      .map(([el, top]) => [el, top - el.getBoundingClientRect().top]);
    for (const [el, delta] of moves) {
      if (Math.abs(delta) > 1 && Math.abs(delta) < 160) {
        animate(el, [
          { transform: `translateY(${delta}px)` },
          { transform: "translateY(0)" },
        ]);
      }
    }
  }
}

// Nearby buttons retain identity while GPS changes distance or the next bus.
// Only the four visible location records are keyed; this is not a screen store.
export function updateNearbyPanel(element, html) {
  if (markup.get(element) === html) return;
  const template = document.createElement("template");
  template.innerHTML = html;
  const next = template.content.querySelector(".nearby-guide"),
    current = element.querySelector(".nearby-guide");
  if (!next || !current) {
    updateHTML(element, html);
    return;
  }
  const focus = document.activeElement;
  const old = new Map(
    [...current.querySelectorAll("[data-nearby-key]")].map((node) => [
      node.dataset.nearbyKey,
      node,
    ]),
  );
  let before = current.querySelector("[data-nearby-key]");
  for (const item of [...next.querySelectorAll("[data-nearby-key]")]) {
    const existing = old.get(item.dataset.nearbyKey),
      node = existing ?? item;
    if (existing) {
      updateHTML(
        existing.querySelector("[data-nearby-copy]"),
        item.querySelector("[data-nearby-copy]").innerHTML,
      );
      updateHTML(
        existing.querySelector("[data-nearby-departures]"),
        item.querySelector("[data-nearby-departures]").innerHTML,
      );
    }
    if (node !== before) current.insertBefore(node, before);
    before = node.nextElementSibling;
    old.delete(item.dataset.nearbyKey);
  }
  for (const node of old.values()) node.remove();
  if (
    focus instanceof HTMLElement &&
    focus.isConnected &&
    element.contains(focus)
  )
    focus.focus({ preventScroll: true });
  markup.set(element, html);
}
