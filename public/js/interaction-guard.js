const MAP_SELECTOR = ".route-map-host,.map-host,[data-map],.maplibregl-map,.maplibregl-canvas-container";

const isMapTarget = (target) => Boolean(target?.closest?.(MAP_SELECTOR));

function installGestureGuard() {
  for (const type of ["gesturestart", "gesturechange", "gestureend"])
    document.addEventListener(
      type,
      (event) => {
        if (!isMapTarget(event.target)) event.preventDefault();
      },
      { passive: false },
    );
}

function ensureRouteSearchEntry() {
  const form = document.querySelector("#quick-journey-form");
  if (!form || form.querySelector("[data-open-search]")) return;
  const entry = document.createElement("button");
  entry.type = "button";
  entry.className = "quick-advanced-search";
  entry.dataset.openSearch = "";
  entry.setAttribute("aria-label", "詳細な経路検索を開く");
  entry.innerHTML = '<span aria-hidden="true">⇄</span><small>詳細</small>';
  form.querySelector(".quick-destination")?.append(entry);
}

export function installInteractionGuard() {
  installGestureGuard();
  ensureRouteSearchEntry();
  const nowSearch = document.querySelector("#now-search");
  if (nowSearch)
    new MutationObserver(() => requestAnimationFrame(ensureRouteSearchEntry)).observe(
      nowSearch,
      { childList: true, subtree: true },
    );
}
