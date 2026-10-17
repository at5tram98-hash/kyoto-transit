// One short recognition window across candidate generation and ride validation.
let owner = null;
export function acquireAudioWindow(token) {
  if (owner) return false;
  owner = token;
  return true;
}
export function releaseAudioWindow(token) {
  if (owner === token) owner = null;
}
export async function microphoneAlreadyGranted() {
  if (!globalThis.navigator) return false;
  try {
    const status = await navigator.permissions?.query({ name: "microphone" });
    if (status) return status.state === "granted";
  } catch {}
  try {
    return Boolean(
      (await navigator.mediaDevices?.enumerateDevices?.())?.some(
        (device) => device.kind === "audioinput" && device.label?.trim(),
      ),
    );
  } catch {
    return false;
  }
}
