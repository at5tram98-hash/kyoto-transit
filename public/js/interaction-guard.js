const MAP_SELECTOR =
  ".route-map,.route-map-host,.map-host,[data-map],.maplibregl-map,.maplibregl-canvas-container";

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
  // Pointer activation must not leave the browser's focus ring behind; Tab and
  // directional keyboard navigation restore a visible, accessible focus state.
  document.addEventListener(
    "pointerdown",
    () => {
      document.documentElement.dataset.inputModality = "pointer";
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        ["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          event.key,
        )
      )
        document.documentElement.dataset.inputModality = "keyboard";
    },
    true,
  );
}
