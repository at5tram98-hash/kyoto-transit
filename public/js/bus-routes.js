// Metadata extends the shared bus view, including future verified route variants.
export const NORTH3 = Object.freeze({
  route: "北3",
  en: "North 3",
  color: "#2867d8",
  source: "https://www2.city.kyoto.lg.jp/kotsu/busdia/keitou/kto/N0030.htm",
  effectiveFrom: "2026-03-20",
  operators: ["citybus", "kyotobus"],
  operatingConditions:
    "括弧付きの便は京都バス運行。京都産業大学休校日は運休。休校日の確定情報がない場合は要確認。",
  names: [
    "北大路バスターミナル（地下鉄北大路駅）",
    "烏丸北大路",
    "東元町",
    "上賀茂橋",
    "上賀茂御薗橋",
    "御薗口町",
    "朝露ヶ原町",
    "柊野別れ",
    "ゴルフ場前",
    "京都産大前",
  ],
  shape: [
    [135.758218, 35.044298],
    [135.759311, 35.043625],
    [135.757552, 35.050013],
    [135.75492, 35.05317],
    [135.750644, 35.057008],
    [135.750645, 35.058709],
    [135.749905, 35.060953],
    [135.750417, 35.064797],
    [135.75166, 35.067515],
    [135.756387, 35.07182],
  ],
  shapeEstimated: true,
});
export function routeConfigFor(route, variant) {
  if (route !== NORTH3.route)
    return variant
      ? { route, ...variant, variantUnverified: variant.verified !== true }
      : null;
  return variant
    ? { ...NORTH3, ...variant, variantUnverified: variant.verified !== true }
    : NORTH3;
}
export function busOperatingCompany(entry) {
  return (
    entry?.operatingCompany ??
    entry?.operator ??
    (/京都バス|共同運行/.test(entry?.note ?? "") ? "kyotobus" : "citybus")
  );
}
