import { formatTime } from "./router.js";

// Export the selected journey's actual model, including changed trips and fares.
// The image contains no GPS history, tiles, or unsupported platform data.
export async function routeImage(route, network, input) {
  const tokens = getComputedStyle(document.documentElement);
  const color = (name) => tokens.getPropertyValue(name).trim();
  const lines = [];
  const name = (id) => network.stops.get(id)?.name ?? id;
  lines.push({ text: `${input.from} → ${input.to}`, kind: "title" });
  lines.push({
    text: `${formatTime(route.legs[0]?.kind === "ride" ? route.legs[0].depart : route.start)} → ${formatTime(route.time)} · ${input.date}`,
    kind: "time",
  });
  lines.push({
    text: `乗換${route.transfers}回 · 追加${route.fare.additional ?? "未確認"}${Number.isFinite(route.fare.additional) ? "円" : ""} · 通常${route.fare.normal ?? "未確認"}${Number.isFinite(route.fare.normal) ? "円" : ""}`,
    kind: "meta",
  });
  route.legs.forEach((leg) => {
    if (leg.kind === "ride") {
      lines.push({
        text: `${formatTime(leg.depart)} 発 ${name(leg.from)}`,
        kind: "station",
        operator: leg.operatingCompany ?? leg.operator,
      });
      lines.push({
        text: `${leg.label ?? leg.route ?? "交通機関"}${leg.route ? ` ${leg.route}系統` : ""} · ${leg.destination ?? ""}${leg.category === "express" ? " · 急行" : ""}`,
        kind: "body",
        operator: leg.operatingCompany ?? leg.operator,
      });
      if (leg.platform)
        lines.push({ text: `${leg.platform}のりば`, kind: "body" });
      lines.push({
        text: `${formatTime(leg.arrive)} 着 ${name(leg.to)}`,
        kind: "station",
        operator: leg.operatingCompany ?? leg.operator,
      });
      if (leg.realtime)
        lines.push({
          text: `${leg.realtime.source === "live" ? "便別実測" : "遅れの推定"} ${leg.realtime.delay > 0 ? "+" : ""}${leg.realtime.delay}分`,
          kind: "meta",
        });
    } else
      lines.push({
        text: `${formatTime(leg.depart)} ${leg.kind === "walk" ? "徒歩" : leg.kind === "dwell" ? "滞在" : "待ち"} ${leg.minutes}分 · ${name(leg.from)}`,
        kind: "body",
        operator: "walk",
      });
  });
  lines.push({
    text: "MyMap · 出力時点の検索結果です。実際の運行と時刻は最新情報をご確認ください。",
    kind: "meta",
  });
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  if (!ctx) throw Error("この端末では経路画像を作成できません");
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
  if (height > 16000) throw Error("経路が長いため、共有リンクをご利用ください");
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
  if (!blob) throw Error("経路画像を作成できません");
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
