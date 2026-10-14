// Only explicit official status can establish normal/delay. An announcement
// link or a missing feed never means that the current route is unaffected.
export function operationStatus(line) {
  if (
    !line?.fetchedAt ||
    !Number.isFinite(Date.parse(line.fetchedAt)) ||
    ["unavailable", "unconfirmed"].includes(line.status)
  )
    return { kind: "unknown", label: "未確認", symbol: "?", rank: 1 };
  if (
    ["delay", "delayed", "suspended", "stopped", "disrupted"].includes(
      line.status,
    )
  )
    return { kind: "danger", label: "遅延・運休", symbol: "!", rank: 3 };
  if (["notice", "warning", "partial"].includes(line.status))
    return { kind: "warning", label: "お知らせ", symbol: "!", rank: 2 };
  if (line.status === "normal")
    return { kind: "success", label: "平常運行", symbol: "✓", rank: 0 };
  return { kind: "unknown", label: "未確認", symbol: "?", rank: 1 };
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
      title: "移動する経路を選択",
      detail: "検索した経路・乗車中の路線を優先表示します",
    };
  const relevant = ids.map((id) => lines.find((l) => l.id === id));
  const states = relevant.map(operationStatus);
  const rank = Math.max(...states.map((s) => s.rank));
  const i = states.findIndex((s) => s.rank === rank);
  return {
    kind: states[i].kind,
    title:
      rank === 0
        ? "影響なし"
        : rank === 1
          ? "一部の運行状況が未確認"
          : (relevant[i]?.name ?? "運行情報を確認"),
    detail:
      rank === 0
        ? "対象路線の公式情報は平常運行です"
        : (relevant[i]?.summary ?? "最新情報を確認できない路線があります"),
  };
}
