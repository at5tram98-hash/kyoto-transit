import { load } from "cheerio/slim";
import { officialText } from "./timetables.js";
const sources = [
  {
    id: "subway",
    name: "地下鉄烏丸線",
    routes: ["烏丸線"],
    url: "https://www.city.kyoto.lg.jp/kotsu/category/166-2-0-0-0-0-0-0-0-0.html",
  },
  {
    id: "kintetsu",
    name: "近鉄京都線・直通運転",
    routes: ["京都線", "奈良線", "烏丸線直通"],
    url: "https://www.kintetsu.jp/unkou/unkou.html",
  },
  {
    id: "citybus",
    name: "京都市バス",
    routes: [
      "10",
      "13",
      "43",
      "46",
      "78",
      "93",
      "202",
      "202八条口",
      "204",
      "205",
      "206",
      "208",
    ],
    url: "https://www.city.kyoto.lg.jp/kotsu/category/165-2-0-0-0-0-0-0-0-0.html",
  },
  {
    id: "kyotobus",
    name: "京都バス",
    routes: ["40", "特40", "直行40", "臨時"],
    url: "https://www.kyotobus.jp/",
  },
];
export function parseOperation(html, source) {
  const $ = load(html);
  $("script,style,nav,footer,header").remove();
  const text = $("body").text().normalize("NFKC").replace(/\s+/g, " ").trim();
  if (source.id === "kyotobus" && text.includes("通常通り運行しています"))
    return { status: "normal", summary: "通常通り運行しています", notices: [] };
  if (source.id === "kintetsu") {
    // The footer explains delay reporting; it is not an active disruption.
    const current = text.split("近鉄列車運行情報について")[0];
    if (/現在は\s*15分以上の列車の遅れはございません/.test(current))
      return {
        status: "normal",
        summary:
          "公式発表: 15分以上の列車の遅れはありません（15分未満は対象外）",
        notices: [],
      };
    if (/平常(?:通り|どおり)運行|通常(?:通り|どおり)運行/.test(current))
      return {
        status: "normal",
        summary: "公式サイトに平常運行の表示",
        notices: [],
      };
    const status = /運転(?:を)?見合わ|運転見合わせ|運休して/.test(current)
      ? "suspended"
      : /遅れが(?:出|発生)|遅延が(?:出|発生)/.test(current)
        ? "delay"
        : null;
    if (status) {
      const summary = $('font[size="+1"]')
        .text()
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim();
      return {
        status,
        summary: summary || "公式サイトに運行への影響が発表されています",
        notices: [{ title: "公式の運行情報", url: source.url }],
      };
    }
  }
  const seen = new Set();
  const notices = $("a")
    .map((_, a) => {
      const title = $(a).text().replace(/\s+/g, " ").trim();
      if (
        !/運休|遅延|遅れ|運転見合わせ|迂回|ダイヤ|運行経路|臨時経路変更/.test(
          title,
        ) ||
        title.length < 8
      )
        return null;
      let url;
      try {
        url = new URL($(a).attr("href") ?? "", source.url);
      } catch {
        return null;
      }
      if (!/^https?:$/.test(url.protocol) || seen.has(url.href)) return null;
      seen.add(url.href);
      return { title, url: url.href };
    })
    .get()
    .slice(0, 12);
  return {
    status: "unconfirmed",
    summary:
      source.id === "citybus"
        ? "公式の迂回・運休・臨時経路変更のお知らせ"
        : source.id === "subway"
          ? "交通局の公式運行お知らせ（便別の遅れは未確認）"
          : "運行状況の平常・異常を自動確定できませんでした",
    notices,
  };
}
export async function operationInformation(fetcher = fetch) {
  const lines = await Promise.all(
    sources.map(async (source) => {
      try {
        const html = await officialText(source.url, fetcher, 60);
        return {
          ...source,
          ...parseOperation(html, source),
          fetchedAt: new Date().toISOString(),
        };
      } catch (error) {
        const message = error.message.replace("公式時刻表", "公式の運行情報");
        return {
          ...source,
          status: "unavailable",
          summary: message,
          notices: [],
          fetchedAt: null,
        };
      }
    }),
  );
  return {
    kind: "operations",
    lines,
    fetchedAt: new Date().toISOString(),
    notice:
      "お知らせの掲載がなくても、各便の定刻運行を保証するものではありません。近鉄の公式運行情報は原則15分以上の遅れが対象です。",
  };
}
