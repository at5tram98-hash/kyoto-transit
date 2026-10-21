// iOS/iPadOS Safari delivers devicemotion only after
// DeviceMotionEvent.requestPermission() is called from a user activation
// (click / touchend). The request is made only from the explicit Now-tab
// control; afterwards a stored grant is re-activated on the rider's next tap in
// a new page session (iOS answers it without showing a dialog again).
//
// Only an explicit "denied" answer to the rider's own tap is remembered as
// denied. A re-activation that fails (no activation, interrupted, or iOS
// declining silently) never overwrites the rider's grant; it is retried on
// the next tap instead.
const KEY = "mymap-motion-permission";
const RETRIES = 5;

const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const write = (value) => {
  try {
    localStorage.setItem(KEY, value);
  } catch {}
};
const requestable = () =>
  typeof globalThis.DeviceMotionEvent?.requestPermission === "function";

let active = false,
  listening = false;
const changed = () =>
  globalThis.document?.dispatchEvent?.(new CustomEvent("mymap-motion-permission"));

// Motion events arriving is the ground truth, whatever the API answered.
function watchDelivery(target = globalThis) {
  if (listening || typeof target.addEventListener !== "function") return;
  listening = true;
  const delivered = (event) => {
    if (!event.acceleration && !event.accelerationIncludingGravity) return;
    target.removeEventListener("devicemotion", delivered);
    if (!active) {
      active = true;
      if (requestable()) write("granted");
      changed();
    }
  };
  target.addEventListener("devicemotion", delivered, { passive: true });
}

export function motionPermissionState() {
  if (!requestable()) return "not-required";
  if (active) return "granted";
  const stored = read();
  return stored === "denied" ? "denied" : stored === "granted" ? "restoring" : "prompt";
}

async function ask() {
  const result = await globalThis.DeviceMotionEvent.requestPermission();
  if (result === "granted") {
    active = true;
    write("granted");
    watchDelivery();
  }
  return result;
}

// The rider tapped the explicit control.
export async function requestMotionPermission() {
  if (!requestable()) return "not-required";
  try {
    const result = await ask();
    if (result !== "granted") write("denied");
    changed();
    return result;
  } catch {
    // Not an answer from the rider; keep whatever was stored.
    changed();
    return "unavailable";
  }
}

// Re-activate a grant the rider already gave, on their next taps.
export function restoreMotionPermission(target = globalThis) {
  watchDelivery();
  if (!requestable() || read() !== "granted" || typeof target.addEventListener !== "function")
    return;
  let attempts = 0;
  const stop = () => {
    target.removeEventListener("click", restore, true);
    target.removeEventListener("touchend", restore, true);
  };
  const restore = () => {
    if (active || attempts >= RETRIES) return stop();
    attempts++;
    // Called synchronously inside the activation; the answer is awaited after.
    ask()
      .then((result) => {
        if (result === "granted") {
          stop();
          changed();
        }
      })
      .catch(() => {});
  };
  target.addEventListener("click", restore, true);
  target.addEventListener("touchend", restore, true);
}
