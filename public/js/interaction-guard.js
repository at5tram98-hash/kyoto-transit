const MAP_SELECTOR =
  ".route-map-host,.map-host,[data-map],.maplibregl-map,.maplibregl-canvas-container";

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

export function installInteractionGuard() {
  installGestureGuard();
}
