// Screen state is data; transport models and DOM are owned by their adapters.
export const NAV_TABS = ["now", "timetable", "operations", "settings"];
export const NAV_SCREENS = [
  "search",
  "results",
  "route",
  "departures",
  "journey",
  "stops",
  "station",
  "nearby",
  "map",
  "delay",
  "trains",
  "arrivals",
  "board",
  "trip",
  "operation",
  "setting",
];
export function navigationState(tab = "now") {
  return {
    version: 1,
    tab: NAV_TABS.includes(tab) ? tab : "now",
    sequence: 0,
    stacks: Object.fromEntries(NAV_TABS.map((t) => [t, []])),
  };
}
export function safeParams(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, v] of Object.entries(value).slice(0, 16)) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_]{0,35}$/.test(key) ||
      ["constructor", "prototype"].includes(key)
    )
      continue;
    if (
      (typeof v === "string" && v.length <= 2048) ||
      (typeof v === "number" && Number.isFinite(v)) ||
      typeof v === "boolean" ||
      v === null
    )
      out[key] = v;
  }
  return out;
}
export function restoreNavigation(value) {
  const out = navigationState(value?.tab);
  if (value?.version !== 1) return out;
  out.sequence =
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    value.sequence < 1e9
      ? value.sequence
      : 0;
  for (const tab of NAV_TABS) {
    const seen = new Set();
    for (const r of (Array.isArray(value.stacks?.[tab])
      ? value.stacks[tab]
      : []
    ).slice(0, 8)) {
      if (
        !NAV_SCREENS.includes(r?.type) ||
        typeof r.key !== "string" ||
        !new RegExp(`^${tab}:\\d+$`).test(r.key) ||
        !Number.isSafeInteger(Number(r.key.split(":")[1])) ||
        Number(r.key.split(":")[1]) >= 1e9 ||
        seen.has(r.key)
      )
        break;
      out.stacks[tab].push({
        type: r.type,
        key: r.key,
        params: safeParams(r.params),
      });
      seen.add(r.key);
      out.sequence = Math.max(out.sequence, Number(r.key.split(":")[1]));
    }
  }
  return out;
}
export const currentRoute = (s) =>
  s.stacks[s.tab].at(-1) ?? { type: "root", key: `root:${s.tab}`, params: {} };
export function navigationTransition(input, action) {
  const s = restoreNavigation(input),
    stack = s.stacks[s.tab];
  if (action.type === "tab" && NAV_TABS.includes(action.tab))
    s.tab = action.tab;
  else if (action.type === "push" && NAV_SCREENS.includes(action.screen)) {
    const params = safeParams(action.params),
      top = stack.at(-1);
    if (
      top?.type === action.screen &&
      JSON.stringify(top.params) === JSON.stringify(params)
    )
      return s;
    if (action.singleton) {
      const i = stack.findIndex((r) => r.type === action.screen);
      if (i >= 0) stack.splice(i);
    }
    if (stack.length >= 8) return s;
    stack.push({
      type: action.screen,
      key: `${s.tab}:${++s.sequence}`,
      params,
    });
  } else if (action.type === "pop") stack.pop();
  else if (action.type === "root") s.stacks[action.tab ?? s.tab] = [];
  return s;
}
export function swipeDecision({ dx, dy, velocity = 0, width }) {
  if (dx < 0 || Math.abs(dy) > Math.max(24, dx * 1.2)) return "cancel";
  return dx >= width * 0.33 || (dx >= 30 && velocity > 0.5) ? "pop" : "cancel";
}
