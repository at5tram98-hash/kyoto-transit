import { ui } from "./locale.js";
// Only explicit official status can establish normal/delay. An announcement
// link or a missing feed never means that the current route is unaffected.
export function operationStatus(
  line,
  {
    now = Date.now(),
    online = globalThis.navigator?.onLine !== false,
    maxAge = 5 * 60 * 1000,
  } = {},
) {
  const fetchedAt = Date.parse(line?.fetchedAt ?? "");
  if (
    !online ||
    !line?.fetchedAt ||
    now - fetchedAt > maxAge ||
    fetchedAt - now > 60000 ||
    !Number.isFinite(fetchedAt) ||
    ["unavailable", "unconfirmed"].includes(line?.status)
  )
    return {
      kind: "unknown",
      label: ui("operation_status_001"),
      symbol: "—",
      rank: 1,
      reason: !online
        ? "offline"
        : !line?.fetchedAt || !Number.isFinite(fetchedAt)
          ? "unavailable"
          : now - fetchedAt > maxAge || fetchedAt - now > 60000
            ? "stale"
            : "unconfirmed",
    };
  if (
    ["delay", "delayed", "suspended", "stopped", "disrupted"].includes(
      line.status,
    )
  )
    return {
      kind: "danger",
      label: ui("operation_status_002"),
      symbol: "!",
      rank: 3,
    };
  if (["notice", "warning", "partial"].includes(line.status))
    return {
      kind: "warning",
      label: ui("operation_status_003"),
      symbol: "!",
      rank: 2,
    };
  if (line.status === "normal")
    return {
      kind: "success",
      label: ui("operation_status_004"),
      symbol: "✓",
      rank: 0,
    };
  return {
    kind: "unknown",
    label: ui("operation_status_005"),
    symbol: "—",
    rank: 1,
    reason: "unsupported",
  };
}
export function journeyOperationStatus(lines, operators) {
  const ids = [
    ...new Set(
      operators.flatMap((id) =>
        id === "through" ? ["subway", "kintetsu"] : [id],
      ),
    ),
  ];
  if (!ids.length)
    return {
      kind: "unknown",
      title: ui("operation_status_006"),
      detail: ui("operation_status_007"),
    };
  const relevant = ids.map((id) => lines.find((l) => l.id === id));
  const states = relevant.map(operationStatus);
  const rank = Math.max(...states.map((s) => s.rank));
  const i = states.findIndex((s) => s.rank === rank);
  return {
    kind: states[i].kind,
    title:
      rank === 0
        ? ui("operation_status_008")
        : rank === 1
          ? ui("operation_status_009")
          : (relevant[i]?.name ?? ui("operation_status_010")),
    detail:
      rank === 0
        ? ui("operation_status_011")
        : (relevant[i]?.summary ?? ui("operation_status_012")),
    reason: states[i].reason ?? null,
  };
}

const supportedOperators = ["subway", "kintetsu", "citybus", "kyotobus"];
export function operationIds(ids) {
  return [
    ...new Set(
      (Array.isArray(ids) ? ids : []).flatMap((id) =>
        id === "through" ? ["subway", "kintetsu"] : [id],
      ),
    ),
  ].filter((id) => supportedOperators.includes(id));
}
export function operationGroups(lines, current, favorites) {
  const used = new Set(operationIds(current)),
    saved = new Set(operationIds(favorites));
  return {
    current: lines.filter((l) => used.has(l.id)),
    favorites: lines.filter((l) => !used.has(l.id) && saved.has(l.id)),
    others: lines.filter((l) => !used.has(l.id) && !saved.has(l.id)),
  };
}
export function disruptedOperators(lines, ids, options) {
  const wanted = new Set(operationIds(ids));
  return lines
    .filter(
      (line) =>
        wanted.has(line.id) && operationStatus(line, options).kind === "danger",
    )
    .map((line) => line.id);
}
