// iOS/iPadOS Safari delivers devicemotion only after
// DeviceMotionEvent.requestPermission() is called from a user gesture.
// The request is made only when the rider taps the explicit control in the
// Now tab; afterwards the stored grant is re-activated on the rider's next tap
// in a new page session (iOS answers it without showing a dialog again).
const KEY = "mymap-motion-permission";

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

let active = false;
export function motionPermissionState() {
  if (!requestable()) return "not-required";
  if (active) return "granted";
  return read() === "denied" ? "denied" : read() === "granted" ? "restoring" : "prompt";
}

export async function requestMotionPermission() {
  if (!requestable()) return "not-required";
  try {
    const result = await globalThis.DeviceMotionEvent.requestPermission();
    active = result === "granted";
    write(result === "granted" ? "granted" : "denied");
    return result;
  } catch {
    write("denied");
    return "denied";
  }
}

// Re-activate a grant the rider already gave, on their next tap.
export function restoreMotionPermission(target = globalThis) {
  if (!requestable() || read() !== "granted" || typeof target.addEventListener !== "function")
    return;
  const restore = () => {
    target.removeEventListener("pointerup", restore, true);
    void requestMotionPermission();
  };
  target.addEventListener("pointerup", restore, true);
}
