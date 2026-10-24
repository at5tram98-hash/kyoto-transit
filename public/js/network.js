import { stationEnglish } from "./station-names.js";
import { registerPlaceName } from "./locale.js";
// 駅・停留所カタログと、リアルタイム取得に失敗した場合の補助経路データ。
// 発車間隔・所要時間は補助値であり、経路検索では静的ダイヤを優先する。
export const SUBWAY_NAMES =
  "国際会館 松ヶ崎 北山 北大路 鞍馬口 今出川 丸太町 烏丸御池 四条 五条 京都 九条 十条 くいな橋 竹田".split(
    " ",
  );
export const SUBWAY_KM = [
  0, 1.6, 2.6, 3.8, 4.6, 5.4, 6.9, 7.6, 8.5, 9.3, 10.3, 11.1, 11.8, 13, 13.7,
];
export const KINTETSU_NAMES =
  "京都 東寺 十条 上鳥羽口 竹田 伏見 近鉄丹波橋 桃山御陵前 向島 小倉 伊勢田 大久保 久津川 寺田 富野荘 新田辺 興戸 三山木 近鉄宮津 狛田 新祝園 木津川台 山田川 高の原 平城 大和西大寺 新大宮 近鉄奈良".split(
    " ",
  );
export const KINTETSU_KM = [
  0, 0.9, 1.5, 2.5, 3.6, 4.9, 6, 6.5, 8.6, 11.4, 12.7, 13.6, 14.6, 15.9, 17.4,
  19.6, 21.1, 22.4, 23.1, 24.4, 26.7, 28.2, 29.2, 30.8, 33.5, 34.6, 37.3, 39,
];
export const subwayIds = SUBWAY_NAMES.map(
  (_, i) => `K${String(i + 1).padStart(2, "0")}`,
);
export const kintetsuIds = KINTETSU_NAMES.map((_, i) =>
  i === 4 ? "K15" : i > 25 ? `A${i + 1}` : `B${String(i + 1).padStart(2, "0")}`,
);
const expressIndexes = new Set([0, 1, 4, 6, 7, 11, 15, 20, 23, 25, 26, 27]);
export const shortName = (name) => name.replace(/（.*?）/g, "").trim();
export const normalize = (name) =>
  name
    .normalize("NFKC")
    .replace(/[\s・･（）()]/g, "")
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export function createNetwork(catalog) {
  const stops = new Map();
  const services = [];
  const walks = [];
  subwayIds.forEach((id, i) =>
    stops.set(id, {
      id,
      name: SUBWAY_NAMES[i],
      type: "subway",
      lines: ["烏丸線"],
      subwayKm: SUBWAY_KM[i],
      aliases: [],
    }),
  );
  kintetsuIds.forEach((id, i) => {
    if (stops.has(id))
      Object.assign(stops.get(id), {
        kintetsuKm: KINTETSU_KM[i],
        lines: ["烏丸線", "近鉄京都線"],
      });
    else
      stops.set(id, {
        id,
        name: KINTETSU_NAMES[i],
        type: "kintetsu",
        lines: [i > 25 ? "近鉄奈良線" : "近鉄京都線"],
        kintetsuKm: KINTETSU_KM[i],
        aliases: [],
      });
  });
  stops.get("B07").aliases = ["丹波橋", "近鉄丹波橋駅"];
  for (const stop of stops.values()) {
    const english = stationEnglish[stop.id];
    if (english) {
      stop.en = english;
      registerPlaceName(stop.name, english);
      stop.aliases.push(
        english,
        english.replaceAll("-", " "),
        `${english} Station`,
        stop.id,
      );
    }
  }
  const busIds = new Map();
  const busStop = (name) => {
    const key = shortName(name);
    if (busIds.has(key)) return busIds.get(key);
    const id = `bus-${busIds.size + 1}`;
    busIds.set(key, id);
    stops.set(id, {
      id,
      name: key,
      fullName: name,
      type: "citybus",
      lines: [],
      aliases: [name],
    });
    return id;
  };
  function pairService(
    id,
    label,
    operator,
    ids,
    offsets,
    interval,
    extra = {},
  ) {
    for (const reverse of [false, true]) {
      const s = reverse ? [...ids].reverse() : ids;
      const o = reverse
        ? [...offsets].reverse().map((x) => offsets.at(-1) - x)
        : offsets;
      services.push({
        id: `${id}-${reverse ? "up" : "down"}`,
        label,
        operator,
        stops: s,
        offsets: o,
        headway: interval,
        first: 330 + (reverse ? 4 : 0),
        last: 1380,
        category: "local",
        prototype: true,
        ...extra,
      });
    }
  }
  pairService(
    "subway",
    "烏丸線",
    "subway",
    subwayIds,
    subwayIds.map((_, i) => i * 2),
    8,
  );
  pairService(
    "k-local",
    "近鉄京都・奈良線",
    "kintetsu",
    kintetsuIds,
    kintetsuIds.map((_, i) => i * 2.5),
    15,
  );
  const exp = kintetsuIds.filter((_, i) => expressIndexes.has(i));
  pairService(
    "k-express",
    "近鉄京都・奈良線",
    "kintetsu",
    exp,
    exp.map((id) => Math.round(stops.get(id).kintetsuKm * 1.1)),
    15,
    { category: "express" },
  );
  // 直通便も地下鉄線内は各駅停車。近鉄京都駅には入らない。
  for (const category of ["local", "express"]) {
    const south = kintetsuIds
      .slice(5)
      .filter((id) => category === "local" || exp.includes(id));
    const all = [...subwayIds, ...south];
    const offsets = all.map((id, i) =>
      i < 15
        ? i * 2
        : 28 +
          Math.round(
            (stops.get(id).kintetsuKm - 3.6) *
              (category === "local" ? 1.8 : 1.1),
          ),
    );
    pairService(
      `through-${category}`,
      "烏丸線・近鉄直通",
      "through",
      all,
      offsets,
      30,
      { category, through: true },
    );
  }
  for (const [route, entry] of Object.entries(catalog).sort(([a], [b]) => {
    const old = ["10", "13", "43", "78", "202", "204", "205", "206", "208"];
    return (
      (old.indexOf(a) < 0 ? 100 + Number(a) : old.indexOf(a)) -
      (old.indexOf(b) < 0 ? 100 + Number(b) : old.indexOf(b))
    );
  })) {
    let ids = [...new Set(entry.names.map(busStop))];
    ids.forEach((id) => {
      if (!stops.get(id).lines.includes(route)) stops.get(id).lines.push(route);
    });
    // 停留所一覧は方向差・入出庫便を含む。循環幹線と枝を分離する。
    if (route === "202")
      ids = ids.filter(
        (id) => stops.get(id).name !== "京都駅八条口アバンティ前",
      );
    if (["202", "204", "205", "206", "208"].includes(route)) ids.push(ids[0]);
    pairService(
      `bus-${route}`,
      `${route}系統`,
      "citybus",
      ids,
      ids.map((_, i) => i * 2),
      route === "43" || route === "78" ? 30 : 12,
      { route, source: entry.source },
    );
    if (route === "202") {
      const names = [
        "九条車庫前",
        "地下鉄九条駅前",
        "京都駅八条口アバンティ前",
      ];
      const branch = names.map((n) => busIds.get(n));
      if (branch.every(Boolean))
        pairService(
          "bus-202-eight",
          "202系統・八条口",
          "citybus",
          branch,
          [0, 2, 5],
          30,
          { route: "202", source: entry.source },
        );
    }
  }
  for (const [id, name] of [
    ["kyotobus-kokusai", "国際会館駅前"],
    ["ksu", "京都産業大学前"],
  ])
    stops.set(id, {
      id,
      name,
      type: "kyotobus",
      ...(id === "ksu" ? { facilityName: "京都産業大学" } : {}),
      officialId: id === "ksu" ? "7475_1" : "91_1",
      lines: ["40", "特40", "直行40"],
      aliases: id === "ksu" ? ["京都産業大学", "京産大"] : [],
    });
  pairService(
    "kyotobus-40",
    "京都バス40系統",
    "kyotobus",
    ["kyotobus-kokusai", "ksu"],
    [0, 15],
    15,
    { route: "40" },
  );

  // 京都バス「臨時」丸太町線（川端丸太町〜嵯峨瀬戸川町）。停留所順・公式停留所ID・
  // 区間所要分は京都バス公式の便データ（運賃・停留所時刻JSON）から転記した。
  const temporary = [
    ["kyotobus-kawabata-marutamachi", "川端丸太町", "6070_3", 0, ["神宮丸太町駅"]],
    ["kyotobus-kawaramachi-marutamachi", "河原町丸太町", "5_4", 3],
    ["kyotobus-saibansho-mae", "裁判所前", "202_1", 5],
    ["kyotobus-karasuma-marutamachi", "烏丸丸太町", "51_1", 6, ["地下鉄丸太町駅", "烏丸丸太町（地下鉄丸太町駅）"], "烏丸丸太町（地下鉄丸太町駅）"],
    ["kyotobus-bunkacho-mae", "文化庁前・府庁前", "201_2", 8],
    ["kyotobus-horikawa-marutamachi", "堀川丸太町", "184_2", 11],
    ["kyotobus-marutamachi-chiekoin", "丸太町智恵光院", "200_2", 13],
    ["kyotobus-senbon-marutamachi", "千本丸太町", "152_2", 16],
    ["kyotobus-marutamachi-shichihonmatsu", "丸太町七本松", "251_2", 17],
    ["kyotobus-marutamachi-onmaedori", "丸太町御前通", "250_2", 18],
    ["kyotobus-nishinokyo-enmachi", "西ノ京円町", "249_2", 21, ["JR円町駅", "西ノ京円町（ＪＲ円町駅）"], "西ノ京円町（ＪＲ円町駅）"],
    ["kyotobus-hakuraku-cho", "伯楽町", "606_2", 22],
    ["kyotobus-nishinokyo-badaicho", "西ノ京馬代町", "607_2", 23],
    ["kyotobus-kitsuji-minamimachi", "木辻南町", "608_2", 24],
    ["kyotobus-myoshinji-mae", "妙心寺前", "609_2", 25],
    ["kyotobus-hanazono-ekimae", "花園駅前", "610_2", 26],
    ["kyotobus-hanazono-oginocho", "花園扇野町", "765_2", 28],
    ["kyotobus-tokiwa-nakanocho", "常盤仲之町", "7717_2", 30],
    ["kyotobus-tokiwa-saganokoko", "常盤・嵯峨野高校前", "718_2", 32],
    ["kyotobus-tokiwano-shogakko", "常磐野小学校前", "719_2", 33],
    ["kyotobus-uzumasa-kitarocho", "太秦北路町", "720_2", 34],
    ["kyotobus-uzumasa-kaibicho", "太秦開日町", "721_2", 36],
    ["kyotobus-hirosawa-goshonouchi", "広沢御所ノ内町", "722_2", 37],
    ["kyotobus-saga-chugaku", "嵯峨中学前", "723_2", 38],
    ["kyotobus-saga-arashiyama-ekimae", "嵯峨嵐山駅前", "727_2", 40, ["JR嵯峨嵐山駅"]],
    ["kyotobus-saga-setogawacho", "嵯峨瀬戸川町", "724_2", 41],
  ];
  for (const [id, name, officialId, , aliases = [], fullName] of temporary)
    stops.set(id, {
      id,
      name,
      ...(fullName ? { fullName } : {}),
      type: "kyotobus",
      officialId,
      lines: ["臨時"],
      aliases,
    });
  pairService(
    "kyotobus-marutamachi-temp",
    "京都バス臨時",
    "kyotobus",
    temporary.map(([id]) => id),
    temporary.map(([, , , offset]) => offset),
    30,
    { route: "臨時" },
  );

  const connect = (a, b, minutes) => {
    if (a && b) {
      walks.push({ from: a, to: b, minutes }, { from: b, to: a, minutes });
    }
  };
  connect("K11", "B01", 8);
  connect("K01", "kyotobus-kokusai", 5);
  connect("K07", "kyotobus-karasuma-marutamachi", 2);
  for (const [a, name, mins] of [
    ["K04", "北大路バスターミナル", 4],
    ["K04", "烏丸北大路", 5],
    ["K07", "烏丸丸太町", 4],
    ["K09", "四条烏丸", 4],
    ["K10", "烏丸五条", 4],
    ["K11", "京都駅前", 5],
    ["K11", "京都駅八条口", 8],
    ["K12", "地下鉄九条駅前", 4],
    ["B02", "九条近鉄前", 6],
  ])
    connect(a, busIds.get(name), mins);
  return {
    stops,
    services,
    walks,
    catalog,
    busIds,
    mode: "fallback",
    source: "補助経路データ",
  };
}

export function searchStops(network, query, type = "all") {
  const q = normalize(query);
  return [...network.stops.values()]
    .filter(
      (s) =>
        (type === "all" ||
          (type === "rail"
            ? ["subway", "kintetsu"].includes(s.type)
            : s.type.includes("bus"))) &&
        (!q ||
          [s.name, s.fullName, ...s.aliases, ...s.lines]
            .filter(Boolean)
            .some((n) => normalize(n).includes(q))),
    )
    .sort((a, b) =>
      normalize(a.name) === q ? -1 : normalize(b.name) === q ? 1 : 0,
    );
}
