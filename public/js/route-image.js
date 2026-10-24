import { formatTime } from "./router.js";
import { ui, displayStopName, placeName, placeNameEntries, userFacingError, appLocale } from "./locale.js";
import { englishNameReplacer } from "./english-names.js";
import { settings } from "./vnext-state.js";

// Export the selected journey's actual model, including changed trips and fares.
// The image contains no GPS history, tiles, or unsupported platform data.
export async function routeImage(route, network, input) {
  const tokens = getComputedStyle(document.documentElement);
  const color = (name) => tokens.getPropertyValue(name).trim();
  const lines = [];
  const name = (id) => displayStopName(network.stops.get(id)) || id;
  const yen = (v) => (Number.isFinite(v) ? ui("route_image_yen", [v]) : ui("route_image_unknown"));
  lines.push({ text: `${input.from} → ${input.to}`, kind: "title" });
  lines.push({
    text: `${formatTime(route.legs[0]?.kind === "ride" ? route.legs[0].depart : route.start)} → ${formatTime(route.time)} · ${input.date}`,
    kind: "time",
  });
  lines.push({
    text: ui("route_image_meta", [route.transfers, yen(route.fare.additional), yen(route.fare.normal)]),
    kind: "meta",
  });
  route.legs.forEach((leg) => {
    if (leg.kind === "ride") {
      lines.push({
        text: ui("route_image_depart", [formatTime(leg.depart), name(leg.from)]),
        kind: "station",
        operator: leg.operatingCompany ?? leg.operator,
      });
      lines.push({
        text: `${leg.route ? ui("route_image_route", [leg.route]) : (placeName(leg.label) ?? ui("route_image_service"))} · ${placeName(leg.destination) ?? ""}${leg.category === "express" ? ui("service_express_suffix") : ""}`,
        kind: "body",
        operator: leg.operatingCompany ?? leg.operator,
      });
      if (leg.platform)
        lines.push({ text: ui("transfer_platform", [leg.platform]), kind: "body" });
      lines.push({
        text: ui("route_image_arrive", [formatTime(leg.arrive), name(leg.to)]),
        kind: "station",
        operator: leg.operatingCompany ?? leg.operator,
      });
      if (leg.realtime)
        lines.push({
          text: ui(leg.realtime.source === "live" ? "route_image_live" : "route_image_estimate", [`${leg.realtime.delay > 0 ? "+" : ""}${leg.realtime.delay}`]),
          kind: "meta",
        });
    } else
      lines.push({
        text: `${formatTime(leg.depart)} ${ui(leg.kind === "walk" ? "transfer_walk" : leg.kind === "dwell" ? "transfer_stay" : "transfer_wait", [leg.minutes])} · ${name(leg.from)}`,
        kind: "body",
        operator: "walk",
      });
  });
  lines.push({
    text: ui("route_image_note"),
    kind: "meta",
  });
  // The image is drawn, not rendered as page text, so rail names are
  // translated here for the English UI.
  if (appLocale(settings) === "en") {
    const english = englishNameReplacer(placeNameEntries());
    for (const line of lines) line.text = english(line.text);
  }
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  if (!ctx) throw userFacingError(ui("route_image_unsupported"));
  const width = 760,
    padding = 36,
    wrapped = [];
  for (const line of lines) {
    const size =
      line.kind === "title"
        ? 28
        : line.kind === "time"
          ? 28
          : line.kind === "meta"
            ? 18
            : 23;
    ctx.font = `${line.kind === "station" ? 700 : 500} ${size}px sans-serif`;
    let text = "";
    for (const char of line.text) {
      if (
        text &&
        ctx.measureText(text + char).width > width - padding * 2 - 12
      ) {
        wrapped.push({ ...line, text, size });
        text = "";
      }
      text += char;
    }
    if (text) wrapped.push({ ...line, text, size });
  }
  const height =
    padding * 2 + wrapped.reduce((sum, line) => sum + line.size * 1.65, 0);
  if (height > 16000) throw userFacingError(ui("route_image_too_long"));
  canvas.width = width * 2;
  canvas.height = Math.ceil(height) * 2;
  ctx.scale(2, 2);
  ctx.fillStyle = color("--surface-primary");
  ctx.fillRect(0, 0, width, height);
  const palette = Object.fromEntries(
    ["subway", "kintetsu", "through", "citybus", "kyotobus", "walk"].map(
      (key) => [key, color(`--color-${key}`)],
    ),
  );
  let y = padding;
  for (const line of wrapped) {
    ctx.font = `${line.kind === "station" ? 700 : 500} ${line.size}px sans-serif`;
    ctx.fillStyle = line.kind === "meta" ? color("--muted") : color("--text");
    if (line.operator) {
      ctx.fillStyle = palette[line.operator] ?? palette.walk;
      ctx.fillRect(padding - 12, y, 4, line.size * 1.25);
      ctx.fillStyle = color("--text");
    }
    ctx.fillText(line.text, padding, y + line.size);
    y += line.size * 1.65;
  }
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw userFacingError(ui("route_image_failed"));
  return blob;
}
export async function downloadRouteImage(route, network, input) {
  const blob = await routeImage(route, network, input),
    url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `MyMap-${input.date}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
