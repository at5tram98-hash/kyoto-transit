// Line identity badges shared by every screen. Kyoto City Bus loop routes
// (循環系統, the 200 series) carry orange route plates and every other city
// route a blue one; Kyoto Bus routes use the company's own route colours.
// Rail legs show the line symbol (K = 烏丸線, B = 近鉄京都線). Colours are
// tokens in vnext.css keyed by data-line.
import { esc } from "./vnext-state.js";
import { ui } from "./locale.js";

const plain = (route) =>
  String(route ?? "")
    .normalize("NFKC")
    .replace(/系統$/, "")
    .trim();

export function isLoopRoute(route) {
  const r = plain(route);
  return /^20[1-8]$/.test(r) || /循環/.test(r);
}

// The colour family of a service: citybus-loop, citybus, kyotobus,
// kyotobus-express, kyotobus-temp, subway, kintetsu or through.
export function lineKind({ operator, operatingCompany, route, lineId } = {}) {
  const company = operatingCompany ?? operator;
  if (operator === "through") return "through";
  if (lineId === "K" || company === "subway") return "subway";
  if (lineId === "B" || company === "kintetsu") return "kintetsu";
  const r = plain(route);
  if (company === "kyotobus")
    return /^特/.test(r) ? "kyotobus-express" : /臨時/.test(r) ? "kyotobus-temp" : "kyotobus";
  return isLoopRoute(r) ? "citybus-loop" : "citybus";
}

const RAIL = {
  subway: ["K", "line_karasuma"],
  kintetsu: ["B", "line_kintetsu"],
  through: ["K", "line_through"],
};

// A solid route plate (bus) or line symbol with name (rail).
// options.name: show the rail line name next to the symbol (default true).
// options.size: "regular" | "small" | "large".
export function lineBadge(
  service = {},
  { name = true, size = "regular", label, className = "" } = {},
) {
  const kind = lineKind(service),
    sizeClass = `${size === "regular" ? "" : ` ${size}`}${className ? ` ${className}` : ""}`;
  if (RAIL[kind]) {
    const [symbol, key] = RAIL[kind],
      line = ui(key);
    return `<span class="line-badge rail${sizeClass}" data-line="${kind}"><i aria-hidden="true">${symbol}</i>${name ? `<span>${esc(label ?? line)}</span>` : `<span class="sr-only">${esc(label ?? line)}</span>`}</span>`;
  }
  const route = plain(service.route) || ui("line_bus");
  return `<span class="line-badge bus${sizeClass}" data-line="${kind}"${label ? ` aria-label="${esc(label)}"` : ""}>${esc(route)}</span>`;
}
