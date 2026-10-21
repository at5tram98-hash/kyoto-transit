// iOS-style system components shared by every screen: a navigation-bar
// progress line, action sheets and pull-down (popover) menus. Visuals live in
// ios-components.css; motion respects Reduce Motion through the root flags.
import { esc } from "./vnext-state.js";
import { ui } from "./locale.js";

const reduced = () =>
  document.documentElement.dataset.reduceMotion === "true" ||
  matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- Navigation-bar progress -------------------------------------------
// Several jobs may run at once; the bar stays until the last one finishes,
// then completes to 100 % and fades like Safari's loading bar.
const jobs = new Set();
let bar = null,
  hideTimer = null;
function progressBar() {
  if (bar?.isConnected) return bar;
  bar = document.createElement("div");
  bar.className = "nav-progress";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-hidden", "true");
  bar.innerHTML = "<span></span>";
  (document.querySelector(".topbar") ?? document.body).append(bar);
  return bar;
}
export function startProgress(key) {
  jobs.add(key);
  const el = progressBar();
  clearTimeout(hideTimer);
  el.dataset.state = "running";
  el.removeAttribute("aria-hidden");
  el.setAttribute("aria-busy", "true");
}
export function endProgress(key) {
  jobs.delete(key);
  if (jobs.size || !bar) return;
  bar.dataset.state = "done";
  bar.removeAttribute("aria-busy");
  hideTimer = setTimeout(
    () => {
      if (!jobs.size && bar) {
        bar.dataset.state = "idle";
        bar.setAttribute("aria-hidden", "true");
      }
    },
    reduced() ? 0 : 420,
  );
}
export async function withProgress(key, job) {
  startProgress(key);
  try {
    return await job;
  } finally {
    endProgress(key);
  }
}

// ---- Action sheet -------------------------------------------------------
// actionSheet({ title, message, actions: [{ id, label, role }] }) resolves
// to the chosen id, or null when cancelled (Cancel, backdrop, Escape).
export function actionSheet({ title = "", message = "", actions = [] } = {}) {
  document.querySelector("dialog.action-sheet[open]")?.close();
  const dialog = document.createElement("dialog");
  dialog.className = "action-sheet";
  dialog.setAttribute("aria-label", title || message || ui("ios_actions"));
  const header =
    title || message
      ? `<div class="action-sheet-header">${title ? `<b>${esc(title)}</b>` : ""}${message ? `<p>${esc(message)}</p>` : ""}</div>`
      : "";
  dialog.innerHTML = `<div class="action-sheet-group">${header}${actions
    .map(
      (a) =>
        `<button type="button" data-action-sheet-choice="${esc(a.id)}" class="${a.role === "destructive" ? "destructive" : ""}">${esc(a.label)}</button>`,
    )
    .join(
      "",
    )}</div><div class="action-sheet-group"><button type="button" class="cancel" data-action-sheet-cancel>${esc(ui("static_cancel_action"))}</button></div>`;
  document.body.append(dialog);
  return new Promise((resolve) => {
    let settled = false;
    // The choice takes effect immediately, as on iOS; the sheet then animates
    // away independently.
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
      if (!dialog.open) return;
      if (reduced()) return dialog.close();
      dialog.dataset.closing = "true";
      setTimeout(() => dialog.close(), 220);
    };
    dialog.addEventListener("click", (event) => {
      const choice = event.target.closest("[data-action-sheet-choice]");
      if (choice) finish(choice.dataset.actionSheetChoice);
      else if (
        event.target.closest("[data-action-sheet-cancel]") ||
        event.target === dialog
      )
        finish(null);
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        finish(null);
      },
      { once: true },
    );
    dialog.showModal();
    dialog.querySelector("[data-action-sheet-choice]")?.focus();
  });
}

// ---- Pull-down menu (popover) -----------------------------------------
// Anchored to its button, dismissed by outside tap, Escape or a choice.
export function popoverMenu(anchor, items, onChoose) {
  const id = `${anchor.id || "menu"}-popover`;
  let menu = document.getElementById(id);
  if (!menu) {
    menu = document.createElement("div");
    menu.id = id;
    menu.className = "pull-down-menu";
    menu.setAttribute("popover", "auto");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    menu.addEventListener("click", (event) => {
      const item = event.target.closest("[data-menu-choice]");
      if (!item) return;
      menu.hidePopover();
      onChoose?.(item.dataset.menuChoice, item);
    });
    menu.addEventListener("toggle", (event) =>
      anchor.setAttribute("aria-expanded", String(event.newState === "open")),
    );
  }
  menu.innerHTML = items
    .map(
      (item) =>
        `<button type="button" role="menuitem" data-menu-choice="${esc(item.id)}" ${Object.entries(
          item.attributes ?? {},
        )
          .map(([k, v]) => `${k}="${esc(v)}"`)
          .join(" ")}><span>${esc(item.label)}</span>${item.icon ?? ""}</button>`,
    )
    .join("");
  anchor.setAttribute("aria-haspopup", "menu");
  anchor.setAttribute("aria-controls", id);
  menu.showPopover();
  const rect = anchor.getBoundingClientRect(),
    width = menu.offsetWidth,
    height = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(rect.right - width, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - height - 8))}px`;
  menu.style.transformOrigin = "top right";
  menu.querySelector("button")?.focus();
  return menu;
}
