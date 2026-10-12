// Read-only release checks. curl respects the cloud environment's proxy policy.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const run = promisify(execFile),
  base = new URL(
    process.env.CAPTURE_API_URL ??
      "https://my-map-capture.at5tram98.workers.dev",
  ),
  site = new URL(
    process.env.APP_URL ?? "https://at5tram98-hash.github.io/kyoto-transit/",
  ),
  origin = process.env.APP_ORIGIN ?? "https://at5tram98-hash.github.io";
if ([base, site].some((url) => !["http:", "https:"].includes(url.protocol)))
  throw Error("HTTP(S) production URLs required");
const date = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const checks = [];
async function publishedFile(path) {
  const url = new URL(path, site);
  const { stdout } = await run(
    "curl",
    [
      "--silent",
      "--show-error",
      "--fail",
      "--location",
      "--max-time",
      "35",
      "--header",
      "Cache-Control: no-cache",
      url.href,
    ],
    { maxBuffer: 5 * 1024 * 1024 },
  );
  return stdout;
}
try {
  const html = await publishedFile("./"),
    version = html.match(/js\/vnext\.js\?v=([a-f0-9]{12})/)?.[1];
  if (!version) throw Error("公開HTMLのビルド番号を確認できません");
  if (
    process.env.EXPECTED_BUILD_VERSION &&
    version !== process.env.EXPECTED_BUILD_VERSION
  )
    throw Error(`公開版が一致しません: ${version}`);
  const [worker, module, stylesheet, bootstrap] = await Promise.all([
    publishedFile("sw.js"),
    publishedFile(`js/vnext.js?v=${version}`),
    publishedFile(`vnext-journey.css?v=${version}`),
    publishedFile(`js/bootstrap.js?v=${version}`),
  ]);
  if (!worker.includes(`const VERSION = "${version}"`))
    throw Error("公開HTMLとService Workerの版が一致しません");
  if (!module.includes(`./vnext-state.js?v=${version}`))
    throw Error("公開モジュールの版が一致しません");
  if (!stylesheet.includes(".journey-display"))
    throw Error("乗車画面のスタイルを取得できません");
  if (!bootstrap.includes("entry.replaceWith(script)"))
    throw Error("起動・旧版移行のファイルを取得できません");
  checks.push({ name: "Published Pages release", status: "passed", version });
  console.log(
    `::notice title=Published Pages release::${site.href} (${version})`,
  );
} catch (e) {
  const message = e.stderr?.trim() || e.message;
  checks.push({
    name: "Published Pages release",
    status: /CONNECT tunnel failed|Domain forbidden/.test(message)
      ? "blocked"
      : "failed",
    error: message.slice(0, 700),
  });
}
async function check(name, path, validate, { cors = true } = {}) {
  const url = new URL(path, base);
  try {
    const { stdout } = await run(
      "curl",
      [
        "--silent",
        "--show-error",
        "--fail-with-body",
        "--max-time",
        "35",
        "--include",
        "--header",
        `Origin: ${origin}`,
        url.href,
      ],
      { maxBuffer: 5 * 1024 * 1024 },
    );
    const parts = stdout.split(/\r?\n\r?\n/),
      body = parts.pop(),
      headers = parts.join("\n"),
      data = JSON.parse(body);
    if (
      cors &&
      !headers
        .toLowerCase()
        .includes(`access-control-allow-origin: ${origin}`.toLowerCase())
    )
      throw Error("公開元へのCORSヘッダーが一致しません");
    validate(data);
    checks.push({ name, status: "passed" });
    return data;
  } catch (e) {
    let message = e.stderr?.trim() || e.message;
    if (
      ["City bus arrivals", "North 3 arrivals", "Rail live positions"].includes(
        name,
      )
    ) {
      try {
        const body = JSON.parse(e.stdout.split(/\r?\n\r?\n/).pop());
        if (typeof body.error === "string")
          message += ` ${body.error.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 400)}`;
        if (typeof body.code === "string") message += ` (${body.code})`;
      } catch {}
    }
    checks.push({
      name,
      status: /CONNECT tunnel failed|Domain forbidden/.test(message)
        ? "blocked"
        : "failed",
      error: message.slice(0, 700),
    });
    return null;
  }
}
const required = (condition, message) => {
  if (!condition) throw Error(message);
};
const health = await check(
  "Worker bindings",
  "/health",
  (d) => {
    required(d.browser, "Browser Rendering binding is missing");
    required(d.kv, "LIVE_KV binding is missing");
  },
  { cors: false },
);
if (health) {
  await check(
    "Official subway full timetable",
    `/api/static/feed?operator=subway&date=${date}`,
    (d) => {
      required(d.validDates?.includes(date), "今日の静的ダイヤがありません");
      required(
        d.services?.some((s) => s.trips?.length),
        "全駅時刻の便がありません",
      );
      required(!d.meta?.stale, "ダイヤに古さの警告があります");
    },
  );
  await check("Subway board", "/timetable/options?stop=K07", (d) =>
    required(
      d.boards?.some((b) => b.key === "north") &&
        d.boards?.some((b) => b.key === "south"),
      "丸太町の両方面がありません",
    ),
  );
  await check(
    "Official departures",
    `/timetable?stop=K07&direction=north&day=auto&date=${date}`,
    (d) =>
      required(
        d.entries?.length && d.entries.every((e) => Number.isFinite(e.depart)),
        "発車時刻を確認できません",
      ),
  );
  await check(
    "City bus arrivals",
    "/api/citybus/arrivals?stop=" +
      encodeURIComponent("烏丸丸太町（地下鉄丸太町駅）"),
    (d) => {
      required(Array.isArray(d.results), "接近情報の形式が異なります");
      required(
        d.source === "live" && !d.stale,
        "市バスの実測データを確認できません",
      );
    },
  );
  await check(
    "North 3 arrivals",
    "/api/citybus/arrivals?stop=" + encodeURIComponent("東元町"),
    (d) => {
      required(
        d.source === "live" && !d.stale,
        "北3の実測接近情報を確認できません",
      );
      required(
        d.results?.some((r) => r.route === "北3"),
        "北3の方面がありません",
      );
    },
  );
  await check("Rail live positions", "/api/rail/live", (d) => {
    required(Array.isArray(d.trains), "列車位置の形式が異なります");
    required(
      d.source !== "prediction" && !d.stale,
      "近鉄の実測データを確認できません",
    );
  });
  if (health.odpt)
    await check("Kyoto bus real-time", "/api/bus/rt", (d) =>
      required(
        Array.isArray(d.vehicles),
        "京都バスの位置データを確認できません",
      ),
    );
  else
    checks.push({
      name: "Kyoto bus real-time",
      status: "optional_unconfigured",
      note: "ODPTキーが未設定。公式時刻表の案内を使用。",
    });
}
const result = {
  checkedAt: new Date().toISOString(),
  api: base.origin,
  site: site.href,
  origin,
  date,
  checks,
  passed: checks.every(
    (c) => c.status === "passed" || c.status === "optional_unconfigured",
  ),
};
const dir = resolve(process.env.PRODUCTION_REPORT_DIR ?? "/tmp/my-map-browser");
await mkdir(dir, { recursive: true });
await writeFile(
  resolve(dir, "production-report.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
if (!result.passed) {
  for (const c of checks.filter((c) => c.error))
    console.error(
      `::error title=${c.name}::${c.error.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`,
    );
  process.exitCode = 1;
}
