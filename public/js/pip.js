// Picture in Picture for approach and riding information. A canvas is
// painted once a second and shown through a muted video (canvas stream),
// which is how Safari on iPhone and Chrome present PiP for web pages.
// Starting requires the rider's tap; nothing here starts on its own.
import { state, tokyoNow } from "./vnext-state.js";
import { ui, displayStopName } from "./locale.js";
import { lineKind } from "./line-badge.js";

const W = 640,
  H = 360;
let canvas = null,
  video = null,
  timer = null,
  active = false;

export function pipSupported(doc = globalThis.document) {
  const v = doc?.createElement?.("video"),
    c = doc?.createElement?.("canvas");
  return Boolean(
    c?.captureStream &&
      (doc?.pictureInPictureEnabled ||
        typeof v?.webkitSetPresentationMode === "function"),
  );
}
export const pipActive = () => active;

function token(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
const lineColor = (kind) =>
  token(`--line-${kind}`, kind === "citybus-loop" ? "#c95a00" : "#0b5cb5");

function plate(ctx, x, y, text, color, h = 54) {
  ctx.font = `800 ${Math.round(h * 0.62)}px -apple-system, "Hiragino Sans", sans-serif`;
  const w = Math.max(h * 1.4, ctx.measureText(text).width + 24);
  ctx.fillStyle = color;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, 8);
  else ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
  ctx.textAlign = "left";
  return w;
}
function fit(ctx, text, max, size, weight = 700) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px -apple-system, "Hiragino Sans", sans-serif`;
    s -= 2;
  } while (ctx.measureText(text).width > max && s > 14);
}

// What to show: the ride when riding, else the nearest stop's approaches.
export function pipContent(now = tokyoNow()) {
  const ride = state.ride,
    model = state.heroModel;
  if (ride && model) {
    const bus = ["citybus", "kyotobus"].includes(ride.operator);
    return {
      kind: "ride",
      plate: bus ? String(ride.route ?? "") : model.lineId === "B" ? "B" : "K",
      color: bus
        ? lineColor(lineKind({ operator: ride.operator, route: ride.route }))
        : model.lineId === "B"
          ? token("--line-kintetsu", "#c8102e")
          : token("--line-subway", "#138a48"),
      title: displayStopName(model.nextStation) || "—",
      label: ui(model.nextIsDestination ? "pip_next_alight" : "pip_next"),
      detail: Number.isFinite(model.minutes)
        ? ui("pip_minutes", [model.minutes])
        : ui("pip_time_unknown"),
      footer: model.nextIsDestination
        ? ui(bus ? "pip_press_stop" : "pip_get_off")
        : model.userDestination
          ? ui(bus ? "pip_destination_bus" : "pip_destination_rail", [
              displayStopName(model.userDestination),
              model.remainingStops,
            ])
          : ui("pip_bound", [ride.destination ?? ""]),
      alert: Boolean(model.nextIsDestination),
    };
  }
  const live = state.busLive;
  const rows = (live?.results ?? [])
    .filter((r) => Number.isFinite(r.stopsAway) || Number.isFinite(r.minutes) || Number.isFinite(r.scheduledDeparture))
    .slice(0, 3)
    .map((r) => ({
      plate: String(r.route ?? ""),
      color: lineColor(lineKind({ operator: r.operator ?? "citybus", route: r.route })),
      dest: r.dest ?? "",
      value: Number.isFinite(r.stopsAway)
        ? ui("pip_stops_away", [r.stopsAway])
        : Number.isFinite(r.minutes)
          ? ui("pip_minutes", [r.minutes])
          : ui("pip_scheduled", [
              `${String(Math.floor(r.scheduledDeparture / 60) % 24).padStart(2, "0")}:${String(r.scheduledDeparture % 60).padStart(2, "0")}`,
            ]),
    }));
  return {
    kind: "approach",
    title: live?.stop ?? ui("pip_no_stop"),
    rows,
    clock: `${String(Math.floor(now.minute / 60) % 24).padStart(2, "0")}:${String(now.minute % 60).padStart(2, "0")}`,
  };
}

export function paintPip(ctx, content) {
  ctx.fillStyle = "#0b0e13";
  ctx.fillRect(0, 0, W, H);
  if (content.kind === "ride") {
    ctx.fillStyle = content.color;
    ctx.fillRect(0, 0, W, 10);
    const pw = plate(ctx, 28, 34, content.plate, content.color);
    ctx.fillStyle = content.alert ? "#ff3b30" : "#ffb21f";
    ctx.font = '700 26px -apple-system, "Hiragino Sans", sans-serif';
    ctx.textBaseline = "middle";
    ctx.fillText(content.label, 28 + pw + 18, 61);
    ctx.fillStyle = "#f6f7f9";
    fit(ctx, content.title, W - 56, 84, 800);
    ctx.textBaseline = "alphabetic";
    ctx.fillText(content.title, 28, 200);
    ctx.fillStyle = "#ffb21f";
    ctx.font = '800 40px -apple-system, "Hiragino Sans", sans-serif';
    ctx.fillText(content.detail, 28, 262);
    ctx.fillStyle = "#8c939e";
    fit(ctx, content.footer, W - 56, 26, 600);
    ctx.fillText(content.footer, 28, 318);
    return;
  }
  ctx.fillStyle = "#8c939e";
  ctx.font = '600 24px -apple-system, "Hiragino Sans", sans-serif';
  ctx.textBaseline = "alphabetic";
  ctx.fillText(content.clock, W - 100, 48);
  ctx.fillStyle = "#f6f7f9";
  fit(ctx, content.title, W - 150, 38, 800);
  ctx.fillText(content.title, 28, 52);
  if (!content.rows.length) {
    ctx.fillStyle = "#8c939e";
    ctx.font = '600 28px -apple-system, "Hiragino Sans", sans-serif';
    ctx.fillText(ui("pip_no_approach"), 28, 190);
    return;
  }
  content.rows.forEach((row, i) => {
    const y = 82 + i * 92;
    const pw = plate(ctx, 28, y, row.plate, row.color, 60);
    ctx.fillStyle = "#f6f7f9";
    fit(ctx, row.dest, W - 28 - pw - 200, 30, 700);
    ctx.textBaseline = "middle";
    ctx.fillText(row.dest, 28 + pw + 16, y + 30);
    ctx.fillStyle = "#ffb21f";
    ctx.font = '800 34px -apple-system, "Hiragino Sans", sans-serif';
    ctx.textAlign = "right";
    ctx.fillText(row.value, W - 28, y + 30);
    ctx.textAlign = "left";
  });
}

export function refreshPip() {
  if (!active || !canvas) return;
  try {
    paintPip(canvas.getContext("2d"), pipContent());
  } catch {}
}

export async function startPip() {
  if (active) return true;
  if (!pipSupported()) return false;
  canvas ??= Object.assign(document.createElement("canvas"), { width: W, height: H });
  refreshPip();
  paintPip(canvas.getContext("2d"), pipContent());
  if (!video) {
    video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.className = "pip-source";
    video.setAttribute("aria-hidden", "true");
    document.body.append(video);
    video.addEventListener("leavepictureinpicture", stopPip);
    video.addEventListener("webkitpresentationmodechanged", () => {
      if (video.webkitPresentationMode !== "picture-in-picture") stopPip();
    });
  }
  video.srcObject = canvas.captureStream(2);
  try {
    await video.play();
    if (document.pictureInPictureEnabled && video.requestPictureInPicture)
      await video.requestPictureInPicture();
    else video.webkitSetPresentationMode("picture-in-picture");
  } catch {
    return false;
  }
  active = true;
  clearInterval(timer);
  timer = setInterval(refreshPip, 1000);
  document.dispatchEvent(new CustomEvent("mymap-pip", { detail: { active } }));
  return true;
}

export function stopPip() {
  if (!active && !timer) return;
  active = false;
  clearInterval(timer);
  timer = null;
  try {
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else if (video?.webkitPresentationMode === "picture-in-picture")
      video.webkitSetPresentationMode("inline");
  } catch {}
  video?.pause?.();
  if (video) video.srcObject = null;
  document.dispatchEvent(new CustomEvent("mymap-pip", { detail: { active } }));
}

export function togglePip() {
  return active ? (stopPip(), Promise.resolve(false)) : startPip();
}
