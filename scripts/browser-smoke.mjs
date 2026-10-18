import { annotationChecks } from "./annotation-browser-checks.mjs";
import { smartLiveChecks } from "./smartlive-browser-checks.mjs";
import { completionChecks } from "./completion-browser-checks.mjs";
import { liveInteractionChecks } from "./live-browser-checks.mjs";
import { yahooScreenChecks } from "./yahoo-browser-checks.mjs";
import { v3RedesignChecks } from "./v3-browser-checks.mjs";
import { c7BrowserChecks } from "./c7-browser-checks.mjs";
// Real browser checks with deterministic upstream fixtures. These do not
// certify the availability or accuracy of production transport providers.
import assert from "node:assert/strict";
import { runCoordinateAudit } from "./ui-coordinate-audit.mjs";
import { journeyUpgradeChecks } from "./journey-browser-checks.mjs";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { chromium, webkit } from "playwright";

const dist = resolve(process.env.BROWSER_DIST_DIR ?? "dist"),
  artifacts = resolve(
    process.env.BROWSER_ARTIFACT_DIR ?? "/tmp/my-map-browser",
  );
await mkdir(artifacts, { recursive: true });
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};
let server,
  base = process.env.BROWSER_BASE_URL,
  originUnavailable = false;
const serverRequests = new Map();
if (!base) {
  assert.ok(existsSync(resolve(dist, "index.html")), "Run npm run build first");
  server = createServer(async (req, res) => {
    if (originUnavailable) {
      req.socket.destroy();
      return;
    }
    try {
      const path = decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        ),
        file = resolve(dist, "." + (path === "/" ? "/index.html" : path));
      serverRequests.set(path, (serverRequests.get(path) ?? 0) + 1);
      if (path === "/__sw-check") {
        res
          .writeHead(200, { "Content-Type": "text/html" })
          .end(
            '<!doctype html><html lang="ja"><title>Service worker check</title><body>Service worker check</body></html>',
          );
        return;
      }
      if (!file.startsWith(dist + sep)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      res
        .writeHead(200, {
          "Content-Type": mime[extname(file)] ?? "application/octet-stream",
          "Cache-Control": "no-store",
        })
        .end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}
const engine = process.env.BROWSER_ENGINE === "webkit" ? webkit : chromium;
const browser = await engine.launch(
  engine === webkit
    ? { headless: true }
    : {
        executablePath:
          process.env.BROWSER_EXECUTABLE_PATH ??
          (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
        headless: true,
        args: ["--no-sandbox"],
      },
);
const report = [];
const summary = { browser: engine.name(), layouts: 0, errors: [], checks: [] };
const date = "2026-10-11";
const subwayFeed = {
  validDates: [date],
  meta: { operator: "subway", stale: false },
  stops: [
    { id: "K07", name: "丸太町" },
    { id: "K01", name: "国際会館" },
  ],
  services: [
    {
      id: "browser-subway",
      operator: "subway",
      label: "地下鉄烏丸線",
      category: "local",
      stops: ["K07", "K01"],
      trips: [
        {
          id: "browser-trip",
          date,
          arrivals: [605, 622],
          departures: [605, 622],
          headsign: "国際会館",
        },
      ],
    },
  ],
};

async function fixture(page, scenario = {}) {
  const counts = { bus: 0, rail: 0, assets: 0, boards: [] },
    errors = [],
    failedModules = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes(".js"))
      failedModules.push({
        url: request.url(),
        error: request.failure()?.errorText,
      });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ gps, corrupt, standalone, initialSettings }) => {
      if (initialSettings && !localStorage.getItem("mymap-vnext-settings"))
        localStorage.setItem(
          "mymap-vnext-settings",
          JSON.stringify(initialSettings),
        );
      if (standalone) {
        Object.defineProperty(navigator, "standalone", {
          value: true,
          configurable: true,
        });
        const media = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          const m = media(query);
          if (query.includes("display-mode: standalone"))
            Object.defineProperty(m, "matches", { value: true });
          return m;
        };
      }
      if (corrupt) {
        localStorage.setItem("mymap-vnext-settings", "{invalid");
        localStorage.setItem("mymap-arrivals-v3", "null");
        sessionStorage.setItem("mymap-navigation-v1", "null");
      }
      let watch;
      window.__emitPosition = (lat = 35.01651, lng = 135.75949) =>
        watch?.({
          coords: {
            latitude: lat,
            longitude: lng,
            accuracy: 10,
            speed: 0,
            heading: null,
          },
          timestamp: Date.now(),
        });
      Object.defineProperty(navigator, "geolocation", {
        value: {
          watchPosition(success, failure) {
            watch = success;
            setTimeout(
              () =>
                gps === "denied"
                  ? failure({ code: 1 })
                  : window.__emitPosition(),
              0,
            );
            return 1;
          },
          clearWatch() {
            watch = null;
          },
        },
      });
    },
    {
      gps: scenario.gps ?? "active",
      corrupt: Boolean(scenario.corrupt),
      standalone: Boolean(scenario.standalone),
      initialSettings: scenario.initialSettings ?? null,
    },
  );
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(base).origin) {
      counts.assets++;
      await route.continue();
      return;
    }
    if (url.hostname === "tile.openstreetmap.org") {
      if (scenario.liveMap) {
        await route.continue();
        return;
      }
      // Transit/layout fixtures do not request third-party tiles repeatedly.
      // Background-map availability is checked once by the production probe.
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8ece7"/></svg>',
      });
      return;
    }
    let data,
      status = 200;
    let epoch;
    try {
      epoch = await page.evaluate(() => Date.now());
    } catch (error) {
      // A reload can destroy the document that owns this intercepted request.
      // Cancel that request rather than fabricate a timestamp or hide app errors.
      if (
        !/Execution context was destroyed|Target page, context or browser has been closed/.test(
          error.message,
        )
      )
        throw error;
      await route.abort().catch(() => {});
      return;
    }
    const asOf = new Date(epoch).toISOString();
    if (url.pathname === "/api/citybus/arrivals") {
      counts.bus++;
      if (scenario.failBus) {
        status = 502;
        data = { error: "Fixture upstream unavailable" };
      } else {
        if (
          scenario.delayStop &&
          url.searchParams.get("stop") === scenario.delayStop
        )
          await scenario.waitForStop;
        const stops = scenario.stopsAway ?? 4;
        data = {
          kind: "citybus-arrivals",
          stop: url.searchParams.get("stop"),
          asOf,
          source: "live",
          results: scenario.empty
            ? []
            : [
                {
                  key: "204-east:0",
                  route: "204",
                  dest: "高野・銀閣寺",
                  boarding: "Aのりば",
                  stopsAway: stops,
                  minutes: null,
                  delay: 0,
                  source: "live",
                  congestion: "空席あり",
                  capturedAt: `revision-${counts.bus}`,
                },
                {
                  key: "204-east:1",
                  route: "204",
                  dest: "高野・銀閣寺",
                  boarding: "Aのりば",
                  stopsAway: 6,
                  minutes: null,
                  delay: null,
                  source: "live",
                },
                {
                  key: "204-west:0",
                  route: "204",
                  dest: "円町・金閣寺",
                  boarding: "Bのりば",
                  minutes: 3,
                  stopsAway: null,
                  delay: 2,
                  source: "live",
                  congestion: "混雑",
                },
                {
                  key: "205:0",
                  route: "205",
                  dest: "北大路バスターミナル（地下鉄北大路駅）・京都駅方面",
                  boarding: "Cのりば",
                  stopsAway: 2,
                  minutes: null,
                  delay: null,
                  source: "live",
                },
                {
                  key: "10:0",
                  route: "10",
                  dest: "四条河原町・三条京阪",
                  boarding: "Dのりば",
                  minutes: null,
                  stopsAway: null,
                  status: "接近なし",
                  delay: null,
                  source: "schedule",
                },
              ],
        };
      }
    } else if (url.pathname === "/api/rail/live") {
      counts.rail++;
      if (scenario.delayRail) await scenario.waitForRail;
      data = {
        kind: "rail-live",
        asOf,
        source: "live",
        trains: scenario.railTrains ?? [
          {
            key: "rail-1",
            direction: "south",
            category: "express",
            label: "急行",
            dest: "大和西大寺",
            position: 1,
            from: "B01",
            to: "B02",
            atStation: true,
            delay: 0,
          },
        ],
      };
    } else if (url.pathname === "/api/static/feed") {
      data =
        scenario.staticFeeds?.[
          `${url.searchParams.get("operator")}:${url.searchParams.get("date")}`
        ] ??
        (url.searchParams.get("operator") === "subway"
          ? (scenario.subwayFeed ?? subwayFeed)
          : {
              validDates: [date],
              meta: {
                operator: url.searchParams.get("operator"),
                stale: false,
              },
              stops: [],
              services: [],
            });
    } else if (url.pathname === "/api/bus/rt") {
      status = 503;
      data = { code: "odpt_not_configured", error: "ODPT fixture disabled" };
    } else if (url.pathname === "/operations")
      data = {
        lines: [
          {
            id: "subway",
            name: "地下鉄烏丸線",
            status: scenario.subwayOperationStatus ?? "normal",
            summary:
              scenario.subwayOperationStatus === "suspended"
                ? "運転を見合わせています"
                : "平常どおり運行しています",
            routes: ["烏丸線"],
            notices: [],
            fetchedAt: asOf,
          },
          {
            id: "citybus",
            name: "京都市バス",
            status: "warning",
            summary: "一部系統で遅れがあります",
            routes: ["10", "204", "205"],
            notices: [],
            fetchedAt: asOf,
          },
        ],
        notice: "Browser test fixture",
      };
    else if (url.pathname === "/timetable/options")
      data = {
        name: "丸太町",
        stop: url.searchParams.get("stop"),
        operator: "subway",
        boards: scenario.missingReverse
          ? [{ key: "south", label: "竹田方面" }]
          : [
              { key: "north", label: "国際会館方面" },
              { key: "south", label: "竹田方面" },
            ],
      };
    else if (url.pathname === "/timetable") {
      counts.boards.push({
        stop: url.searchParams.get("stop"),
        direction: url.searchParams.get("direction"),
        date: url.searchParams.get("date"),
      });
      if (scenario.delayBoard) await scenario.waitForBoard;
      if (scenario.failBoard) {
        status = 502;
        data = { error: "時刻表を取得できませんでした" };
      } else
        data = {
          day: "holiday",
          platform: "1",
          effective: "テスト用ダイヤ",
          fetchedAt: asOf,
          sourceURL: "https://example.com/timetable",
          entries: scenario.foldEntries ?? [
            {
              depart: 605,
              category: "local",
              destination: "国際会館",
              tripId: "browser-trip",
            },
          ],
        };
    } else if (url.pathname === "/timetable/trip")
      data = {
        title: "普通 国際会館行き",
        stops: [
          { id: "K07", name: "丸太町", departure: 605 },
          { id: "K01", name: "国際会館", arrival: 622 },
        ],
      };
    else if (url.pathname === "/rider/candidates") data = { trips: [] };
    else {
      status = 404;
      data = { error: `Unmocked fixture ${url.pathname}` };
    }
    await route
      .fulfill({
        status,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": new URL(base).origin,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        },
        body: JSON.stringify(data),
      })
      .catch(() => {});
  });
  return { counts, errors, failedModules };
}

async function open({
  width = 390,
  height = 844,
  colorScheme = "light",
  reducedMotion = "no-preference",
  scenario = {},
  clock = false,
  time = null,
} = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    reducedMotion,
    serviceWorkers: "block",
  });
  const page = await context.newPage(),
    f = await fixture(page, scenario);
  if (clock || time)
    await page.clock.install(time ? { time: new Date(time) } : {});
  await page.goto(base);
  try {
    await page
      .locator("#arrival-live .arrival-line, #arrival-live .arrival-empty")
      .first()
      .waitFor({ state: "attached" });
  } catch (error) {
    let diagnostic = "";
    try {
      await page.screenshot({
        path: resolve(artifacts, `startup-failure-${Date.now()}.png`),
      });
      diagnostic = await page.locator("body").innerText();
    } catch (captureError) {
      diagnostic = `Capture unavailable: ${captureError.message}`;
    }
    throw new Error(
      `${error.message}\nApplication startup errors: ${JSON.stringify(f.errors)}\nFailed modules: ${JSON.stringify(f.failedModules)}\n${diagnostic}`,
      { cause: error },
    );
  }
  await page.locator(".app-shell[data-navigation-depth]").waitFor();
  await page.evaluate(async () => {
    const search = new URL(document.querySelector("script[type=module]").src)
      .search;
    window.__state = await import(
      new URL(`js/vnext-state.js${search}`, location.href).href
    );
    window.__navigation = await import(
      new URL(`js/navigation.js${search}`, location.href).href
    );
    window.__view = await import(
      new URL(`js/vnext-view.js${search}`, location.href).href
    );
  });
  return { context, page, ...f };
}

async function layout(page, label) {
  await settleNavigation(page);
  await page.locator(".tabbar").waitFor({ state: "attached" });
  // The sheet deliberately enters from below the viewport; inspect its final
  // geometry after the finite entrance animation has completed.
  await page.evaluate(async () => {
    await Promise.all(
      [...document.querySelectorAll(".sheet[open]")]
        .flatMap((el) => el.getAnimations())
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const problems = await page.evaluate(() => {
    const width = document.documentElement.clientWidth,
      out = [];
    if (document.documentElement.scrollWidth > width + 1)
      out.push("document horizontal overflow");
    for (const el of document.querySelectorAll(
      ".arrival-dest,.arrival-minutes,.arrival-delay,.arrival-route-badge,.planner-form input,.planner-form select,.tab-button,.setting-row,.board-controls select,.operation-title,.sheet[open],.journey-next-name,.journey-metrics strong,.stop-times,.target-train,.fold-timing dd,.sheet-field select,.nearby-row,.compact-departures b,.compact-departures time",
    )) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < -0.5 || r.right > width + 0.5)
        out.push(`${el.className || el.tagName}: outside viewport`);
      if (
        el.matches(".sheet[open]") &&
        (r.top < -0.5 || r.bottom > innerHeight + 0.5)
      )
        out.push("sheet outside vertical viewport");
      const row = el.closest(".arrival-line");
      if (row) {
        const box = row.getBoundingClientRect();
        if (r.left < box.left - 0.5 || r.right > box.right + 0.5)
          out.push(`${el.className}: clipped by arrival row`);
      }
    }
    const buttons = [...document.querySelectorAll(".tab-button")].map((el) =>
      el.getBoundingClientRect(),
    );
    if (buttons.some((r) => r.width && r.height < 44))
      out.push("navigation touch target smaller than 44px");
    return out;
  });
  assert.deepEqual(problems, [], label);
  summary.layouts++;
}

async function settleNavigation(page) {
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.navigationBusy === "false",
    null,
    { timeout: 30000 },
  );
}
async function backScreen(page) {
  await settleNavigation(page);
  await page.locator("[data-navigation-back]").click();
  await settleNavigation(page);
}
async function tabRoot(page, tab) {
  await page.locator(`[data-tab="${tab}"]`).click();
  await settleNavigation(page);
  while (await page.locator("[data-navigation-back]").isVisible())
    await backScreen(page);
}
async function searchScreen(page) {
  if (await page.locator("#planner-form .planner-submit").isVisible()) return;
  await settleNavigation(page);
  await page.locator('[data-tab="search"]').click();
  await settleNavigation(page);
}
async function submitSearch(page) {
  if (await page.locator("#search-filter[open]").count()) {
    await page.locator("dialog[open] [data-search-sheet-done]").click();
    await settleNavigation(page);
  }
  if (await page.locator(".suggestion-screen[open]").count()) {
    await page.keyboard.press("Escape");
    await settleNavigation(page);
  }
  if (await page.locator("#search-date[open]").count()) {
    await page.locator("#search-date [data-search-sheet-done]").click();
    await settleNavigation(page);
  }
  for (const [name, value, id] of [
    ["from", "丸太町", "K07"],
    ["to", "国際会館", "K01"],
  ]) {
    if (!(await page.locator(`[name="${name}"]`).inputValue())) {
      await page.locator(`[name="${name}"]`).fill(value);
      await page.locator(`#planner-suggestions [data-stop-id="${id}"]`).click();
      await settleNavigation(page);
    }
  }
  await page.locator("#planner-form .planner-submit").click();
}
async function arrivalsScreen(page) {
  if (await page.locator("[data-arrival-change]").isVisible()) return;
  await settleNavigation(page);
  const nearby = page.locator("[data-home-page=nearby]");
  if (await nearby.isVisible()) await nearby.click();
  await page.locator('[data-navigation-screen="arrivals"]').click();
  await settleNavigation(page);
}
async function setRide(page, operator = "subway", known = true) {
  await page.evaluate(() => window.__navigation.navigation.root("now"));
  await settleNavigation(page);
  await page.evaluate(
    ({ operator, known }) => {
      const { state, settings, tokyoNow } = window.__state;
      settings.autoDetect = false;
      const now = tokyoNow().minute,
        bus = operator.includes("bus");
      const ids = bus
        ? state.network.services
            .find((s) => s.operator === "citybus" && s.route === "204")
            .stops.slice(0, 5)
        : operator === "subway"
          ? ["K07", "K08", "K09", "K11"]
          : operator === "through"
            ? ["K14", "K15", "B06", "B07"]
            : ["B01", "B02", "K15", "B07"];
      const officialStops = ids.map((id, i) => ({
        id,
        name: state.network.stops.get(id).name,
        time: known ? now - 3 + i * 5 : null,
      }));
      state.ride = {
        operator,
        route: bus ? "204" : null,
        from: ids[0],
        to: ids.at(-1),
        destination: officialStops.at(-1).name,
        category: operator === "subway" || bus ? "local" : "express",
        direction: "south",
        officialStops,
      };
      state.rideShift = 3;
      state.rideConfidence = 99;
      state.lastRideSeenAt = Date.now();
      state.busTrail = bus ? [{ id: ids[0], at: Date.now() }] : [];
      state.fix = null;
      state.locationStatus = "active";
      window.__view.renderNow();
    },
    { operator, known },
  );
}

async function freezeNavigation(page) {
  await page.evaluate(() => {
    window.__originalAnimate = Element.prototype.animate;
    window.__navAnimations = [];
    Element.prototype.animate = function (frames, options) {
      const animation = window.__originalAnimate.call(this, frames, options);
      if (
        this.matches(".view,.navigation-screen") &&
        options.duration >= 320 &&
        options.duration <= 360
      ) {
        animation.pause();
        animation.currentTime = options.duration / 2;
        window.__navAnimations.push(animation);
      }
      return animation;
    };
  });
}
async function releaseNavigation(page) {
  await page.evaluate(() => {
    Element.prototype.animate = window.__originalAnimate;
    for (const animation of window.__navAnimations) animation.play();
    delete window.__originalAnimate;
    delete window.__navAnimations;
  });
  await settleNavigation(page);
}
async function navigationChecks() {
  for (const colorScheme of ["light", "dark"])
    for (const scale of [1, 1.5, 2])
      for (const reduce of [false, true]) {
        const run = await open({
            colorScheme,
            reducedMotion: reduce ? "reduce" : "no-preference",
            time: "2026-10-11T01:00:00Z",
            scenario: { gps: reduce ? "denied" : "active", standalone: reduce },
          }),
          { page } = run;
        try {
          await page.evaluate(
            (scale) =>
              (document.documentElement.style.fontSize = `${scale * 16}px`),
            scale,
          );
          assert.equal(
            await page.locator(".planner-form:visible").count(),
            0,
            "Home is an entry point, not a long form",
          );
          await searchScreen(page);
          await page.locator('[name="from"]').fill("丸太町");
          await page.keyboard.press("Escape");
          await settleNavigation(page);
          await page.locator('[name="to"]').fill("国際会館");
          await submitSearch(page);
          await page
            .locator(".navigation-current .planner-result")
            .first()
            .waitFor();
          await settleNavigation(page);
          assert.equal(
            await page.locator(".planner-form:visible").count(),
            0,
            "Results have their own screen",
          );
          await page
            .locator(".navigation-current [data-open-route]")
            .first()
            .click();
          await settleNavigation(page);
          assert.match(
            await page.locator("#view-title").textContent(),
            /経路詳細/,
          );
          await page.goBack();
          await settleNavigation(page);
          assert.match(
            await page.locator("#view-title").textContent(),
            /検索結果/,
          );
          await backScreen(page);
          assert.equal(
            await page.locator('[name="to"]').inputValue(),
            "国際会館",
          );
          await submitSearch(page);
          await page
            .locator(".navigation-current [data-open-route]")
            .first()
            .click();
          await page
            .locator(".navigation-current [data-arm-route]")
            .first()
            .click();
          await page.locator(".armed-journey").waitFor();
          await settleNavigation(page);
          assert.equal(
            await page
              .locator(".app-shell")
              .getAttribute("data-navigation-depth"),
            "0",
          );
          await setRide(page);
          // Real scrollable stop data, using the existing station model and official-time contract.
          await page.evaluate(() => {
            const { state, tokyoNow } = window.__state;
            const stops = [...state.network.stops.values()].filter(
              (s) => s.type === "subway",
            );
            state.ride.officialStops = stops.map((s, i) => ({
              id: s.id,
              name: s.name,
              time: tokyoNow().minute + i * 3,
            }));
            state.ride.fullOfficialStops = state.ride.officialStops;
            state.ride.from = stops[0].id;
            state.ride.to = stops.at(-1).id;
            window.__view.renderNow();
          });
          await page.locator('[data-navigation-screen="stops"]').click();
          await settleNavigation(page);
          const stops = page.locator(
            '.navigation-current[data-screen="stops"]',
          );
          await stops.evaluate((e) => (e.scrollTop = 200));
          const scroll = await stops.evaluate((e) => e.scrollTop);
          assert.ok(scroll > 0);
          await stops.locator(".station-name-button").nth(5).click();
          await settleNavigation(page);
          assert.match(
            await page
              .locator("[data-navigation-back]")
              .getAttribute("aria-label"),
            /停車駅/,
          );
          // A different tab keeps this station and its parent scroll position.
          await page.locator('[data-tab="timetable"]').click();
          await settleNavigation(page);
          await page.locator('[data-tab="now"]').click();
          await settleNavigation(page);
          assert.equal(
            await page
              .locator(".navigation-current")
              .getAttribute("data-screen"),
            "station",
          );
          const edge = page.locator(".navigation-edge"),
            box = await edge.boundingBox(),
            y = box.y + 60;
          await page.mouse.move(8, y);
          await page.mouse.down();
          await page.mouse.move(125, y, { steps: 5 });
          const dx = await page
            .locator(".navigation-current")
            .evaluate(
              (e) => new DOMMatrixReadOnly(getComputedStyle(e).transform).m41,
            );
          assert.ok(
            Math.abs(dx - 117) < 1,
            "Finger tracking is 1:1 before release",
          );
          if (scale === 1 && !reduce)
            await page.screenshot({
              path: resolve(artifacts, `swipe-30-${colorScheme}.png`),
            });
          await page.waitForTimeout(140);
          await page.mouse.up();
          await settleNavigation(page);
          assert.equal(
            await page
              .locator(".navigation-current")
              .getAttribute("data-screen"),
            "station",
            "30% swipe cancels",
          );
          await page.mouse.move(8, y);
          await page.mouse.down();
          await page.mouse.move(203, y, { steps: 5 });
          await page.waitForTimeout(140);
          await page.mouse.up();
          await page
            .waitForFunction(
              () =>
                document.querySelector(".navigation-current")?.dataset
                  .screen === "stops",
            )
            .catch(async (error) => {
              const diagnostic = await page.evaluate(() => ({
                url: location.href,
                busy: document.querySelector(".app-shell").dataset
                  .navigationBusy,
                screen: document.querySelector(".navigation-current")?.dataset
                  .screen,
                transform: getComputedStyle(
                  document.querySelector(".navigation-current"),
                ).transform,
                route: window.__navigation.navigation.route,
                history: history.state?.mymapNavigation,
                parent: document
                  .querySelector("main")
                  .getBoundingClientRect()
                  .toJSON(),
              }));
              throw Error(
                `${error.message}; scale=${scale} reduce=${reduce} theme=${colorScheme}; ${JSON.stringify(diagnostic)}`,
              );
            });
          await settleNavigation(page);
          const returned = await stops.evaluate((e) => e.scrollTop);
          assert.ok(
            Math.abs(returned - scroll) < 1,
            "Stop list scroll is restored",
          );
          await backScreen(page);
          await page.locator('[data-navigation-screen="map"]').click();
          await settleNavigation(page);
          const map = page.locator(".navigation-current .route-map");
          assert.equal(await page.locator(".tabbar").isVisible(), false);
          await map.locator('[data-map-zoom="1"]').click();
          const tile = await map
            .locator(".map-tile")
            .first()
            .getAttribute("data-tile-src");
          await backScreen(page);
          await page.locator('[data-navigation-screen="map"]').click();
          await settleNavigation(page);
          assert.equal(
            await page
              .locator(".navigation-current .map-tile")
              .first()
              .getAttribute("data-tile-src"),
            tile,
            "Map zoom survives reopening",
          );
          await backScreen(page);
          await page.locator('[data-navigation-screen="delay"]').click();
          await settleNavigation(page);
          await layout(
            page,
            `Navigation ${colorScheme} ${scale}x reduce=${reduce}`,
          );
          await backScreen(page);
          await setRide(page, "citybus");
          await page.locator('[data-navigation-screen="stops"]').click();
          await settleNavigation(page);
          await page
            .locator(".navigation-current .station-name-button")
            .nth(2)
            .click();
          await settleNavigation(page);
          await backScreen(page);
          await backScreen(page);
          assert.equal(
            await page
              .locator(".ride-action-list [data-open-foldback]")
              .count(),
            0,
            "Bus has no turnaround action",
          );
          // Five cached detail frames is a hard bound after mixed flows.
          assert.ok((await page.locator(".navigation-screen").count()) <= 5);
          assert.deepEqual(run.errors, []);
        } catch (error) {
          await page.screenshot({
            path: resolve(
              artifacts,
              `navigation-failure-${colorScheme}-${scale}-${reduce}.png`,
            ),
          });
          throw error;
        } finally {
          await run.context.close();
        }
      }
  // Cancellation, flick, vertical scrolling, map panning and modal Back share
  // the same real browser controller; these are not touchend-only simulations.
  const run = await open({ time: "2026-10-11T01:00:00Z" }),
    { page } = run;
  try {
    await setRide(page);
    await freezeNavigation(page);
    await page.locator('[data-navigation-screen="stops"]').click();
    assert.equal(await page.evaluate(() => window.__navAnimations.length), 2);
    const pushX = await page
      .locator(".navigation-current")
      .evaluate(
        (e) => new DOMMatrixReadOnly(getComputedStyle(e).transform).m41,
      );
    assert.ok(pushX > 0 && pushX < 390);
    await page.screenshot({ path: resolve(artifacts, "push-midpoint.png") });
    await releaseNavigation(page);
    await freezeNavigation(page);
    await page.locator("[data-navigation-back]").click();
    await page.waitForFunction(() => window.__navAnimations.length === 2);
    await page.screenshot({ path: resolve(artifacts, "pop-midpoint.png") });
    await releaseNavigation(page);
    await page.locator('[data-navigation-screen="stops"]').click();
    await settleNavigation(page);

    await page
      .locator(
        '.navigation-current .station-name-button[data-station-detail="K09"]',
      )
      .click();
    await settleNavigation(page);
    const y = (await page.locator(".navigation-edge").boundingBox()).y + 80;
    await page.mouse.move(8, y);
    await page.mouse.down();
    await page.mouse.move(68, y);
    await page
      .locator(".navigation-edge")
      .dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
    await settleNavigation(page);
    assert.equal(
      await page.locator(".navigation-current").getAttribute("data-screen"),
      "station",
    );
    await page.mouse.move(8, y);
    await page.mouse.down();
    await page.mouse.move(10, y + 100, { steps: 6 });
    await page.mouse.up();
    assert.equal(
      await page.locator(".navigation-current").getAttribute("data-screen"),
      "station",
    );
    await page.mouse.move(8, y);
    await page.mouse.down();
    await page.mouse.move(60, y);
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        document.querySelector(".navigation-current")?.dataset.screen ===
        "stops",
    );
    await settleNavigation(page);
    await backScreen(page);
    await page.locator('[data-context-action="destination"]').click();
    await page.locator("#context-sheet[open]").waitFor();
    await page
      .locator("#context-sheet")
      .evaluate((e) =>
        Promise.all(e.getAnimations().map((a) => a.finished.catch(() => {}))),
      );
    const handle = await page
        .locator("#context-sheet .sheet-drag-handle")
        .boundingBox(),
      hx = handle.x + handle.width / 2,
      hy = handle.y + handle.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx, hy + 65, { steps: 5 });
    assert.ok(
      (await page
        .locator("#context-sheet")
        .evaluate(
          (e) => new DOMMatrixReadOnly(getComputedStyle(e).transform).m42,
        )) > 60,
    );
    await page.screenshot({ path: resolve(artifacts, "sheet-drag-65.png") });
    await page
      .locator("#context-sheet .sheet-drag-handle")
      .dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#context-sheet[open]").count(), 1);
    await page.goBack();
    await page.locator("#context-sheet[open]").waitFor({ state: "hidden" });
    await settleNavigation(page);
    assert.equal(
      await page.locator(".app-shell").getAttribute("data-navigation-depth"),
      "0",
    );
    await page.locator('[data-navigation-screen="map"]').click();
    await settleNavigation(page);
    const canvas = await page
      .locator(".navigation-current .map-canvas")
      .boundingBox();
    await page.mouse.move(canvas.x + 150, canvas.y + 150);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 200, canvas.y + 170, { steps: 5 });
    await page.mouse.up();
    assert.equal(
      await page.locator(".navigation-current").getAttribute("data-screen"),
      "map",
    );
    await backScreen(page);
    await page.locator('[data-navigation-screen="stops"]').click();
    await settleNavigation(page);
    await page.locator('[data-tab="settings"]').click();
    await settleNavigation(page);
    await page.locator('[data-tab="now"]').click();
    await settleNavigation(page);
    assert.equal(
      await page.locator(".navigation-current").getAttribute("data-screen"),
      "stops",
    );
    await page.goBack();
    await settleNavigation(page);
    assert.equal(
      await page.locator(".app-shell").getAttribute("data-navigation-depth"),
      "0",
    );
    await page.locator("#ride-end").click();
    await settleNavigation(page);
    await searchScreen(page);
    await page.locator('[name="to"]').focus();
    await page.evaluate(() => {
      Object.defineProperty(visualViewport, "height", {
        configurable: true,
        value: innerHeight - 320,
      });
      visualViewport.dispatchEvent(new Event("resize"));
    });
    assert.equal(await page.locator(".tabbar").isVisible(), false);
    await page.screenshot({
      path: resolve(artifacts, "keyboard-viewport.png"),
    });
    await page.evaluate(() => {
      delete visualViewport.height;
      visualViewport.dispatchEvent(new Event("resize"));
    });
    await submitSearch(page);
    await page
      .locator(".navigation-current [data-open-route]")
      .first()
      .waitFor();
    await settleNavigation(page);
    await page.reload();
    await page
      .locator(".navigation-current [data-open-route]")
      .first()
      .waitFor();
    await settleNavigation(page);
    assert.equal(
      await page.locator(".navigation-current").getAttribute("data-screen"),
      "results",
      "Results and input survive a session reload",
    );
    await backScreen(page);
    assert.equal(await page.locator('[name="to"]').inputValue(), "国際会館");
    await tabRoot(page, "timetable");
    await page.locator("#timetable-search").fill("丸太町");
    await page.locator('[data-timetable-stop="K07"]').click();
    await page.locator(".minute-cell").first().click();
    await page.locator("#timetable-trip .stop-timeline").waitFor();
    await settleNavigation(page);
    await page.reload();
    await page.locator("#timetable-trip .stop-timeline").waitFor();
    await settleNavigation(page);
    assert.equal(
      await page.locator(".navigation-current").getAttribute("data-screen"),
      "trip",
    );
    assert.deepEqual(run.errors, []);
  } catch (error) {
    await page.screenshot({
      path: resolve(artifacts, "navigation-extra-failure.png"),
    });
    throw error;
  } finally {
    await run.context.close();
  }
  summary.checks.push(
    "Navigation Flow A–F: independent screens, History/App/interactive Back, 1:1 tracking, 30% cancel, 50% commit, flick, PointerCancel, vertical/map/sheet/tab conflicts, scroll/input/zoom/reload preservation, bounded cache, keyboard viewport; 390px light/dark 100–200% Reduce Motion ON/OFF",
  );
}

async function searchComparisonChecks({ baseline = false } = {}) {
  const fullFeed = {
    ...subwayFeed,
    stops: [
      { id: "K07", name: "丸太町" },
      { id: "K04", name: "北大路" },
      { id: "K01", name: "国際会館" },
    ],
    services: [
      {
        ...subwayFeed.services[0],
        stops: ["K07", "K04", "K01"],
        platforms: ["1", "1", "1"],
        trips: [605, 615, 630].map((m, i) => ({
          id: `comparison-${i}`,
          date,
          arrivals: [m, m + 5, m + 17],
          departures: [m, m + 5, m + 17],
          headsign: "国際会館",
        })),
      },
    ],
  };
  for (const colorScheme of ["light", "dark"])
    for (const scale of baseline ? [1] : [1, 1.5, 2]) {
      const run = await open({
          colorScheme,
          reducedMotion: scale === 2 ? "reduce" : "no-preference",
          time: "2026-10-11T01:00:00Z",
          scenario: {
            subwayFeed: fullFeed,
            gps: scale === 2 ? "denied" : "active",
            standalone: scale === 2,
          },
        }),
        { page } = run;
      try {
        await page.evaluate(
          (scale) =>
            (document.documentElement.style.fontSize = `${16 * scale}px`),
          scale,
        );
        await searchScreen(page);
        if (baseline) {
          await page.screenshot({
            path: resolve(artifacts, `search-${colorScheme}-390.png`),
          });
          await submitSearch(page);
          await page
            .locator(".navigation-current [data-open-route]")
            .first()
            .waitFor();
          await settleNavigation(page);
          await page.screenshot({
            path: resolve(artifacts, `results-${colorScheme}-390.png`),
          });
          await page
            .locator(".navigation-current [data-open-route]")
            .first()
            .click();
          await settleNavigation(page);
          await page.screenshot({
            path: resolve(artifacts, `route-${colorScheme}-390.png`),
          });
          continue;
        }
        // A rail/bus name is never selected by an invisible heuristic.
        await page.locator("[name=to]").fill("京都");
        await page.waitForFunction(
          () =>
            JSON.parse(sessionStorage.getItem("mymap-navigation-v1") ?? "{}")
              .memory?.["search-input"]?.to === "京都",
        );
        assert.ok(
          await page
            .locator("#planner-suggestions [data-stop-id=K11]")
            .isVisible(),
        );
        assert.ok(
          await page
            .locator("#planner-suggestions [data-stop-id=B01]")
            .isVisible(),
        );
        await page.locator("#planner-suggestions [data-stop-id=B01]").click();
        assert.equal(await page.locator("[name=toId]").inputValue(), "B01");
        await page.locator("[name=to]").fill("K01");
        await page.locator("#planner-suggestions [data-stop-id=K01]").waitFor();
        await page.keyboard.press("ArrowDown");
        assert.match(
          (await page
            .locator("[data-suggestion-input]")
            .getAttribute("aria-activedescendant")) ?? "",
          /planner-suggestions-0/,
        );
        await page.keyboard.press("Enter");
        assert.equal(await page.locator("[name=to]").inputValue(), "国際会館");
        assert.equal(await page.locator("[name=toId]").inputValue(), "K01");
        await page.locator("[data-add-via]").click();
        await page.locator("[name=via0]").fill("北大路");
        await page.locator("#planner-suggestions [data-stop-id=K04]").click();
        await page.locator('[data-dwell-index="0"]').selectOption("5");
        await layout(page, `comparison search ${colorScheme} ${scale}x`);
        if (scale === 1)
          await page.screenshot({
            path: resolve(artifacts, `search-${colorScheme}-390.png`),
          });
        await submitSearch(page);
        await page
          .locator(".navigation-current [data-open-route]")
          .first()
          .waitFor();
        await settleNavigation(page);
        assert.match(
          await page
            .locator(".navigation-current .search-request")
            .textContent(),
          /北大路/,
        );
        await page
          .locator('.navigation-current [data-result-order="fare"]')
          .click();
        await layout(page, `comparison results ${colorScheme} ${scale}x`);
        if (scale === 1)
          await page.screenshot({
            path: resolve(artifacts, `results-${colorScheme}-390.png`),
          });
        await page
          .locator(".navigation-current .planner-result")
          .first()
          .click({ position: { x: 20, y: 30 } });
        await settleNavigation(page);
        assert.match(
          await page
            .locator(".navigation-current .planner-timeline")
            .textContent(),
          /滞在 5分/,
        );
        assert.match(
          await page
            .locator(".navigation-current .planner-timeline")
            .textContent(),
          /発 1のりば/,
        );
        await page.locator(".navigation-current [data-save-route]").click();
        assert.match(
          await page
            .locator(".navigation-current [data-route-feedback]")
            .textContent(),
          /保存しました/,
        );
        await page.locator('.tabbar [data-tab="timetable"]').click();
        await settleNavigation(page);
        assert.match(
          await page
            .locator(".navigation-current #timetable-stop-list")
            .textContent(),
          /よく使う/,
        );
        await layout(
          page,
          `Saved route timetable shortcuts ${colorScheme} ${scale}x`,
        );
        await page
          .locator(".navigation-current #timetable-stop-list .native-list")
          .first()
          .locator('[data-timetable-stop="K07"]')
          .click();
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "board",
        );
        await backScreen(page);
        await page.locator('.tabbar [data-tab="search"]').click();
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "route",
        );
        await page.evaluate(() =>
          Object.defineProperty(navigator, "share", {
            configurable: true,
            value: async (data) => {
              window.__sharedSearch = data;
            },
          }),
        );
        await page.locator(".route-actions [data-share-route]").click();
        const shared = await page.evaluate(() => window.__sharedSearch.url);
        assert.ok(shared.includes("routeSearch="));
        await layout(page, `comparison route ${colorScheme} ${scale}x`);
        if (scale === 1)
          await page.screenshot({
            path: resolve(artifacts, `route-${colorScheme}-390.png`),
          });
        await backScreen(page);
        assert.equal(
          await page
            .locator(
              '.navigation-current [data-result-order][aria-pressed="true"]',
            )
            .getAttribute("data-result-order"),
          "fare",
        );
        await page.locator(".navigation-current [data-edit-search]").click();
        await settleNavigation(page);
        assert.equal(await page.locator("[name=via0]").inputValue(), "北大路");
        assert.equal(
          await page.locator('[data-dwell-index="0"]').inputValue(),
          "5",
        );
        await page.locator(".search-history > summary").click();
        assert.equal(
          await page.locator("[data-history-kind=favorites]").count(),
          1,
        );
        await page.locator("[data-delete-kind=favorites]").click();
        assert.equal(
          await page.locator("[data-history-kind=favorites]").count(),
          0,
        );
        assert.ok(await page.locator("[data-history-kind=history]").count());
        await submitSearch(page);
        await page
          .locator(".navigation-current [data-open-route]")
          .first()
          .waitFor();
        await settleNavigation(page);
        await page.locator(".navigation-current [data-next-departure]").click();
        await page.waitForFunction(() =>
          document
            .querySelector(".navigation-current .search-request")
            ?.textContent.includes("10:06"),
        );
        await page
          .locator(".navigation-current [data-open-route]")
          .first()
          .waitFor();
        await settleNavigation(page);
        assert.match(
          await page
            .locator(".navigation-current .planner-times")
            .textContent(),
          /10:15/,
        );
        await page.reload();
        await page
          .locator(".navigation-current [data-open-route]")
          .first()
          .waitFor();
        await settleNavigation(page);
        await page.locator(".navigation-current [data-edit-search]").click();
        await settleNavigation(page);
        assert.equal(await page.locator("[name=via0]").inputValue(), "北大路");
        assert.equal(await page.locator("[name=time]").inputValue(), "10:06");
        // A shared link reconstructs conditions, not an unverified cached itinerary.
        await page.goto(shared);
        await page.locator(".navigation-current #planner-form").waitFor();
        await settleNavigation(page);
        assert.equal(await page.locator("[name=via0]").inputValue(), "北大路");
        assert.equal(await page.locator("[name=time]").inputValue(), "10:00");
        assert.ok(!page.url().includes("routeSearch="));
        assert.deepEqual(run.errors, []);
      } catch (error) {
        await page.screenshot({
          path: resolve(
            artifacts,
            `comparison-failure-${colorScheme}-${scale}.png`,
          ),
        });
        console.error(
          "Comparison diagnostic",
          JSON.stringify({
            errors: run.errors,
            failedModules: run.failedModules,
            screen: await page.locator("body").innerText(),
          }),
        );
        throw error;
      } finally {
        await run.context.close();
      }
    }
  if (baseline) return;
  // Home search entry uses the same owned search form and IDs.
  const run = await open({
      time: "2026-10-11T01:00:00Z",
      scenario: { gps: "denied", subwayFeed: fullFeed },
    }),
    { page } = run;
  try {
    await searchScreen(page);
    await page.locator("[name=to]").fill("京都");
    await page.locator("#planner-suggestions [data-stop-id=K11]").click();
    assert.equal(await page.locator("[name=to]").inputValue(), "京都");
    await page.locator("[name=to]").fill("国際会館");
    await page.locator("#planner-suggestions [data-stop-id=K01]").click();
    await submitSearch(page);
    await page
      .locator(".navigation-current [data-open-route]")
      .first()
      .waitFor();
    await settleNavigation(page);
    assert.match(
      await page.locator(".navigation-current .search-request").textContent(),
      /国際会館/,
    );
    await page.locator(".navigation-current [data-edit-search]").click();
    await settleNavigation(page);
    await page.locator("[name=to]").fill("存在しない地点");
    await submitSearch(page);
    await settleNavigation(page);
    assert.equal(await page.locator("#search-loading-overlay").count(), 0);
    assert.match(
      await page.locator("#search-inline-status").textContent(),
      /候補から選択/,
    );
    assert.deepEqual(run.errors, []);
  } finally {
    await run.context.close();
  }
  // The static result is usable before realtime resolves. A status-only
  // update must retain the same card and its active click target.
  let releaseRail;
  const waitForRail = new Promise((resolve) => {
    releaseRail = resolve;
  });
  const updating = await open({
    time: "2026-10-11T01:00:00Z",
    scenario: {
      gps: "denied",
      subwayFeed: fullFeed,
      delayRail: true,
      waitForRail,
    },
  });
  try {
    const page = updating.page;
    await searchScreen(page);
    await submitSearch(page);
    await page.locator(".navigation-current .planner-result").first().waitFor();
    await page.evaluate(() => {
      window.__initialResultCard = document.querySelector(
        ".navigation-current .planner-result",
      );
    });
    releaseRail();
    await page
      .locator(".navigation-current [data-planner-status] .loading-note")
      .waitFor({ state: "hidden", timeout: 8000 });
    assert.equal(
      await page.evaluate(
        () =>
          window.__initialResultCard ===
          document.querySelector(".navigation-current .planner-result"),
      ),
      true,
      "Completing realtime without presentation changes must preserve the result card",
    );
    await page
      .locator(".navigation-current .planner-result")
      .first()
      .click({ position: { x: 20, y: 30 } });
    await page.locator(".navigation-current .planner-timeline").waitFor();
    await layout(page, "Result card remains tappable after realtime update");
    assert.deepEqual(updating.errors, []);
  } finally {
    releaseRail();
    await updating.context.close();
  }
  let releaseChange;
  const waitForChange = new Promise((resolve) => {
    releaseChange = resolve;
  });
  const throughFeed = structuredClone(fullFeed);
  throughFeed.services.forEach((service) => {
    service.operator = "through";
  });
  const held = await open({
    time: "2026-10-11T01:00:00Z",
    scenario: {
      gps: "denied",
      subwayFeed: throughFeed,
      delayRail: true,
      waitForRail: waitForChange,
      railTrains: [
        {
          key: "observed-local",
          category: "local",
          dest: "国際会館",
          delay: 3,
          direction: "north",
          position: 20,
        },
      ],
    },
  });
  try {
    const page = held.page;
    await searchScreen(page);
    await submitSearch(page);
    const card = page.locator(".navigation-current .planner-result").first();
    await card.waitFor();
    await page.evaluate(() => {
      window.__pressedResult = document.querySelector(
        ".navigation-current .planner-result",
      );
    });
    const rect = await card.boundingBox();
    await page.mouse.move(rect.x + 20, rect.y + 30);
    await page.mouse.down();
    releaseChange();
    await page
      .locator(".navigation-current [data-planner-status] .loading-note")
      .waitFor({ state: "hidden", timeout: 8000 });
    assert.equal(
      await page.evaluate(
        () =>
          window.__pressedResult ===
          document.querySelector(".navigation-current .planner-result"),
      ),
      true,
      "A realtime presentation change must not remove an active pointer target",
    );
    await page.mouse.up();
    await page.locator(".navigation-current .planner-timeline").waitFor();
    assert.match(
      await page.locator(".navigation-current .planner-quality").textContent(),
      /推定/,
    );
    await layout(
      page,
      "Realtime changes during card press retain its click and open updated details",
    );
    assert.deepEqual(held.errors, []);
  } finally {
    releaseChange();
    await held.context.close();
  }
  summary.checks.push(
    "Competitor comparison improvements: delayed realtime preserves card identity and tap, saved-route timetable shortcuts, operator-specific autocomplete and keyboard selection, via/dwell search, sort identity, edit/next departure, save/delete, share/reload state, home search entry and invalid-input feedback; 390px light/dark 100–200%",
  );
}

try {
  if (process.env.BROWSER_C7_ONLY === "1") {
    await c7BrowserChecks({open, searchScreen, submitSearch, settleNavigation, summary});
  }
  if (
    process.env.BROWSER_SMARTLIVE_ONLY === "1" ||
    !Object.keys(process.env).some(
      (key) =>
        key.startsWith("BROWSER_") &&
        /ONLY|AUDIT|BASELINE/.test(key) &&
        process.env[key] === "1",
    )
  )
    await smartLiveChecks({ open, setRide, layout, artifacts, summary });
  if (
    process.env.BROWSER_COMPLETION_ONLY === "1" ||
    !Object.keys(process.env).some(
      (key) =>
        key.startsWith("BROWSER_") &&
        /ONLY|AUDIT|BASELINE/.test(key) &&
        process.env[key] === "1",
    )
  )
    await completionChecks({
      open,
      setRide,
      searchScreen,
      submitSearch,
      settleNavigation,
      backScreen,
      layout,
      artifacts,
      summary,
    });
  if (
    process.env.BROWSER_LIVE_ONLY === "1" ||
    !Object.keys(process.env).some(
      (key) =>
        key.startsWith("BROWSER_") &&
        /ONLY|AUDIT|BASELINE/.test(key) &&
        process.env[key] === "1",
    )
  ) {
    await liveInteractionChecks({
      open,
      setRide,
      settleNavigation,
      backScreen,
      artifacts,
      summary,
      layout,
    });
    await annotationChecks({
      open,
      layout,
      artifacts,
      summary,
      searchScreen,
      submitSearch,
      settleNavigation,
      backScreen,
    });
  }
  if (
    process.env.BROWSER_YAHOO_ONLY === "1" ||
    !Object.keys(process.env).some(
      (key) =>
        key.startsWith("BROWSER_") &&
        /ONLY|AUDIT|BASELINE/.test(key) &&
        process.env[key] === "1",
    )
  )
    await yahooScreenChecks({
      open,
      settleNavigation,
      layout,
      artifacts,
      summary,
    });
  if (
    process.env.BROWSER_V3_ONLY === "1" ||
    ![
      "BROWSER_SMARTLIVE_ONLY",
      "BROWSER_COMPLETION_ONLY",
      "BROWSER_LIVE_ONLY",
      "BROWSER_YAHOO_ONLY",
      "BROWSER_UI_AUDIT",
      "BROWSER_JOURNEY_ONLY",
      "BROWSER_COMPARISON_ONLY",
      "BROWSER_NAV_ONLY",
      "BROWSER_LEGACY_ONLY",
      "BROWSER_SPEC_ONLY",
      "BROWSER_COMPARISON_BASELINE",
    ].some((key) => process.env[key] === "1")
  )
    await v3RedesignChecks({
      open,
      setRide,
      searchScreen,
      submitSearch,
      backScreen,
      tabRoot,
      settleNavigation,
      layout,
      artifacts,
      summary,
    });
  if (
    process.env.BROWSER_SMARTLIVE_ONLY !== "1" &&
    process.env.BROWSER_COMPLETION_ONLY !== "1" &&
    process.env.BROWSER_LIVE_ONLY !== "1" &&
    process.env.BROWSER_V3_ONLY !== "1" &&
    process.env.BROWSER_YAHOO_ONLY !== "1"
  ) {
    if (
      ![
        "BROWSER_SMARTLIVE_ONLY",
        "BROWSER_COMPLETION_ONLY",
        "BROWSER_LIVE_ONLY",
        "BROWSER_YAHOO_ONLY",
        "BROWSER_UI_AUDIT",
        "BROWSER_COMPARISON_BASELINE",
        "BROWSER_COMPARISON_ONLY",
        "BROWSER_LEGACY_ONLY",
        "BROWSER_NAV_ONLY",
        "BROWSER_SPEC_ONLY",
      ].some((key) => process.env[key] === "1")
    )
      await journeyUpgradeChecks({
        open,
        setRide,
        searchScreen,
        submitSearch,
        backScreen,
        settleNavigation,
        layout,
        artifacts,
        summary,
      });
    if (process.env.BROWSER_JOURNEY_ONLY !== "1")
      await runCoordinateAudit({
        open,
        setRide,
        tabRoot,
        searchScreen,
        submitSearch,
        settleNavigation,
        backScreen,
        artifacts,
        summary,
        baseline: process.env.BROWSER_UI_AUDIT_BASELINE === "1",
        extended: process.env.BROWSER_UI_AUDIT === "1",
      });
    if (
      process.env.BROWSER_UI_AUDIT !== "1" &&
      process.env.BROWSER_JOURNEY_ONLY !== "1"
    )
      await searchComparisonChecks({
        baseline: process.env.BROWSER_COMPARISON_BASELINE === "1",
      });
    if (
      process.env.BROWSER_COMPARISON_BASELINE !== "1" &&
      process.env.BROWSER_LEGACY_ONLY !== "1" &&
      process.env.BROWSER_COMPARISON_ONLY !== "1" &&
      process.env.BROWSER_UI_AUDIT !== "1" &&
      process.env.BROWSER_JOURNEY_ONLY !== "1"
    ) {
      await navigationChecks();
      console.log("Navigation Flow A–F passed");
    }
    if (
      process.env.BROWSER_NAV_ONLY !== "1" &&
      process.env.BROWSER_COMPARISON_ONLY !== "1" &&
      process.env.BROWSER_UI_AUDIT !== "1" &&
      process.env.BROWSER_JOURNEY_ONLY !== "1"
    ) {
      if (process.env.BROWSER_SPEC_ONLY !== "1") {
        // Small iPhones, current phones, landscape, tablet, and desktop, both themes.
        for (const colorScheme of ["light", "dark"])
          for (const [width, height] of [
            [320, 568],
            [375, 667],
            [390, 844],
            [430, 932],
            [844, 390],
            [768, 1024],
            [1280, 800],
          ]) {
            const scenario = {},
              { context, page, errors } = await open({
                width,
                height,
                colorScheme,
                scenario,
              });
            try {
              for (const tab of [
                "now",
                "timetable",
                "operations",
                "settings",
              ]) {
                if (tab !== "now")
                  await page.locator(`[data-tab="${tab}"]`).click();
                if (tab === "operations")
                  await page.locator("[data-operation-id]").first().waitFor();
                await layout(page, `${width}x${height} ${colorScheme} ${tab}`);
              }
              await page.locator('[data-tab="now"]').click();
              await arrivalsScreen(page);
              await page.locator("[data-arrival-change]").click();
              await page.locator("#arrival-stop-search").fill("京都駅");
              await layout(page, `${width} ${colorScheme} stop picker`);
              await page.keyboard.press("Escape");
              assert.equal(
                await page
                  .locator("[data-arrival-change]")
                  .getAttribute("aria-expanded"),
                "false",
              );
              if (width === 390)
                await page.screenshot({
                  path: resolve(artifacts, `now-${colorScheme}.png`),
                  fullPage: true,
                  animations: "disabled",
                });
              for (const [operator, known] of [
                ["subway", true],
                ["kintetsu", true],
                ["through", true],
                ["citybus", true],
                ["citybus", false],
              ]) {
                await setRide(page, operator, known);
                await layout(
                  page,
                  `${width} ${colorScheme} onboard ${operator} ${known ? "timed" : "unknown times"}`,
                );
                assert.equal(
                  await page.locator("#ride-foldback").count(),
                  operator.includes("bus") ? 0 : 1,
                );
                assert.match(
                  await page.locator(".journey-stop-list").textContent(),
                  known ? /予定/ : /時刻未取得/,
                );
                if (
                  width === 390 &&
                  ["subway", "citybus"].includes(operator) &&
                  known
                )
                  await page.screenshot({
                    path: resolve(artifacts, `${operator}-${colorScheme}.png`),
                    fullPage: true,
                    animations: "disabled",
                  });
              }
              await setRide(page);
              await page
                .locator(".ride-action-list [data-open-foldback]")
                .click();
              await layout(
                page,
                `${width} ${colorScheme} foldback choice sheet`,
              );
              await page.locator('[data-foldback-mode="train"]').click();
              await page.locator("#target-station").selectOption("K08");
              const now = await page.evaluate(
                () => window.__state.tokyoNow().minute,
              );
              scenario.foldEntries = [
                {
                  depart: now + 20,
                  category: "express",
                  destination: "大和西大寺・京都線経由",
                  tripId: "layout-train",
                },
              ];
              await page.locator("[data-load-target-trains]").click();
              await page.locator("[data-target-index]").first().waitFor();
              await layout(page, `${width} ${colorScheme} foldback train list`);
              await page.locator("[data-target-index]").first().click();
              await layout(page, `${width} ${colorScheme} foldback result`);
              await page.locator("[data-sheet-close]").click();
              assert.deepEqual(
                errors,
                [],
                `${width} ${colorScheme} page errors`,
              );
            } finally {
              await context.close();
            }
          }
        summary.checks.push(
          "182 responsive layout checks; both themes, 5 tabs, stop picker, subway, Kintetsu, through, bus and all foldback steps",
        );

        const scenario = { stopsAway: 4 };
        const { context, page, counts, errors } = await open({
          scenario,
          clock: true,
        });
        try {
          await arrivalsScreen(page);
          await page.evaluate(() => {
            window.__rows = [
              ...document.querySelectorAll("#arrival-live .arrival-line"),
            ];
            window.__rowMutations = 0;
            window.__sourceMutations = 0;
            window.__observer = new MutationObserver((items) => {
              for (const item of items) {
                const owner =
                  item.target.nodeType === Node.ELEMENT_NODE
                    ? item.target
                    : item.target.parentElement;
                if (owner?.closest(".arrival-source"))
                  window.__sourceMutations++;
                else window.__rowMutations++;
              }
            });
            window.__observer.observe(document.querySelector("#arrival-live"), {
              childList: true,
              characterData: true,
              subtree: true,
            });
          });
          const start = counts.bus;
          for (let i = 0; i < 10; i++) {
            await page.evaluate(() => window.__emitPosition());
            await page.clock.runFor(100);
          }
          assert.equal(
            counts.bus,
            start,
            "GPS updates must not trigger arrival requests",
          );
          await page.clock.runFor(20000);
          await page.waitForFunction(
            () =>
              !document
                .querySelector("#arrival-live")
                .hasAttribute("aria-busy"),
          );
          assert.equal(
            counts.bus,
            start + 1,
            "Exactly one foreground refresh per interval",
          );
          assert.equal(
            await page.evaluate(() => window.__rowMutations),
            0,
            "Timestamp-only responses may update source timestamps, while vehicle, destination, time and position remain stable",
          );
          assert.equal(
            await page.evaluate(() =>
              window.__rows.every(
                (el, i) =>
                  el ===
                  document.querySelectorAll("#arrival-live .arrival-line")[i],
              ),
            ),
            true,
          );
          assert.equal(
            await page.evaluate(() => {
              const current = new Intl.DateTimeFormat("ja-JP", {
                timeZone: "Asia/Tokyo",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(window.__state.state.busLive.asOf));
              return [
                ...document.querySelectorAll("#arrival-live .arrival-source"),
              ].every((el) => el.textContent.includes(current));
            }),
            true,
            "Every arrival row must show its refreshed timestamp",
          );
          const marker = await page
            .locator(".arrival-track-position")
            .first()
            .elementHandle();
          scenario.stopsAway = 1;
          await page.clock.runFor(20000);
          await page.locator(".arrival-line.imminent").first().waitFor();
          assert.equal(
            await page
              .locator(".arrival-line.imminent .arrival-minutes span")
              .first()
              .evaluate((el) => getComputedStyle(el).animationName),
            "arrival-imminent",
          );
          assert.deepEqual(
            await page.locator(".arrival-group-caption").count(),
            0,
          );
          scenario.stopsAway = 2;
          await page.clock.runFor(20000);
          await page.waitForFunction(
            () =>
              !document
                .querySelector("#arrival-live")
                .hasAttribute("aria-busy"),
          );
          assert.equal(
            await marker.evaluate(
              (el) => el === document.querySelector(".arrival-track-position"),
            ),
            true,
            "Observed movement must preserve the marker",
          );
          await page.waitForFunction(() =>
            document
              .querySelector(".arrival-approach:not([hidden])")
              .style.getPropertyValue("--approach-position")
              .startsWith("66.666"),
          );
          assert.match(
            await page
              .locator(".arrival-approach:not([hidden])")
              .first()
              .getAttribute("style"),
            /66\.666/,
          );
          assert.equal(
            await page
              .locator(".arrival-line")
              .filter({ has: page.locator('[aria-label^="204（高野"]') })
              .locator(".arrival-minutes")
              .textContent(),
            "2停留所前",
          );
          assert.match(
            await page
              .locator(".arrival-line")
              .filter({ has: page.locator('[aria-label^="204（高野"]') })
              .locator(".arrival-second")
              .textContent(),
            /6停留所前/,
            "The second bus remains available in the expandable detail",
          );
          const beforeHidden = counts.bus;
          await page.locator('[data-tab="settings"]').click();
          await page.clock.runFor(60000);
          assert.equal(
            counts.bus,
            beforeHidden,
            "Other tabs must pause arrival polling",
          );
          await page.locator('[data-tab="now"]').click();
          await settleNavigation(page);
          await page.clock.runFor(10);
          await page.waitForFunction(
            () =>
              !document
                .querySelector("#arrival-live")
                .hasAttribute("aria-busy"),
          );
          assert.equal(counts.bus, beforeHidden + 1);
          // Switching stops aborts old work and prevents stale results under the new name.
          scenario.delayStop = "山越中町";
          scenario.waitForStop = new Promise(
            (resolve) => (scenario.releaseStop = resolve),
          );
          await arrivalsScreen(page);
          await page.locator("[data-arrival-change]").click();
          await page.locator("#arrival-stop-search").fill("山越中町");
          await page.locator("[data-arrival-stop]").first().click();
          await page.clock.runFor(10);
          await arrivalsScreen(page);
          await page.locator("[data-arrival-change]").click();
          await page.locator("#arrival-stop-search").fill("京都駅前");
          await page.locator("[data-arrival-stop]").first().click();
          await page.clock.runFor(100);
          await page.waitForFunction(
            () => window.__state.state.busLive?.stop === "京都駅前",
          );
          scenario.releaseStop();
          await page.clock.runFor(100);
          assert.equal(
            await page.evaluate(() => window.__state.state.busLive.stop),
            "京都駅前",
          );
          scenario.failBus = true;
          scenario.stopsAway = 1;
          await page.clock.runFor(20000);
          await page.waitForFunction(() =>
            document
              .querySelector("#bus-update-status")
              .textContent.includes("予測"),
          );
          assert.ok(
            (await page.locator("#arrival-live .arrival-line").count()) > 0,
            "Network failure must preserve cached arrivals",
          );
          assert.deepEqual(errors, []);
          report.push({
            gpsUpdates: 10,
            extraGpsRequests: 0,
            unchangedRowMutations: 0,
            foregroundInterval: 20000,
          });
        } finally {
          scenario.releaseStop?.();
          await context.close();
        }
        summary.checks.push(
          "GPS request suppression, stable DOM, observed movement, polling pause/resume, stop-change race, cached network fallback",
        );

        const reduced = await open({
          reducedMotion: "reduce",
          scenario: { corrupt: true },
        });
        try {
          assert.equal(
            await reduced.page
              .locator(".arrival-track-position")
              .first()
              .evaluate((el) => getComputedStyle(el).transitionDuration),
            "0s",
          );
          assert.equal(
            await reduced.page.evaluate(
              () =>
                document
                  .querySelector("#arrival-live")
                  .getAnimations({ subtree: true }).length,
            ),
            0,
          );
          await layout(
            reduced.page,
            "reduced motion and corrupt saved preferences",
          );
          assert.deepEqual(reduced.errors, []);
        } finally {
          await reduced.context.close();
        }
        const denied = await open({ scenario: { gps: "denied" } });
        try {
          assert.match(
            await denied.page.locator("#now-hero").textContent(),
            /未乗車/,
          );
          assert.ok((await denied.page.locator(".arrival-line").count()) > 0);
          await layout(denied.page, "location permission denied");
          assert.deepEqual(denied.errors, []);
        } finally {
          await denied.context.close();
        }
        summary.checks.push(
          "Reduced motion, corrupt local storage, and useful arrivals without location permission",
        );

        const functional = await open({ time: "2026-10-11T01:00:00Z" });
        try {
          const { page } = functional;
          await page.locator('[data-tab="timetable"]').click();
          await searchScreen(page);
          await page.locator("[data-search-date]").click();
          await page.locator('[name="date"]').fill(date);
          await page.locator('[name="time"]').fill("10:00");
          await searchScreen(page);
          await submitSearch(page);
          await page
            .locator(".navigation-current .planner-result")
            .first()
            .waitFor();
          assert.match(
            await page
              .locator(".navigation-current [data-planner-results]")
              .textContent(),
            /10:22/,
          );
          await layout(page, "Module Worker route search result");
          await tabRoot(page, "timetable");
          await page.locator("#timetable-search").fill("丸太町");
          await page.locator('[data-timetable-stop="K07"]').click();
          await page.locator(".minute-cell").first().waitFor();
          await page.locator(".minute-cell").first().click();
          await page.locator("#timetable-trip .stop-timeline").waitFor();
          await layout(page, "station timetable detail sheet");
          await backScreen(page);
          await page.locator('[data-tab="settings"]').click();
          await page.locator('[data-setting-page="pass"]').click();
          const checkbox = page.locator('[data-setting="passCityBus"]');
          await checkbox.check();
          assert.equal(
            await page.evaluate(
              () =>
                JSON.parse(localStorage.getItem("mymap-vnext-settings"))
                  .passCityBus,
            ),
            true,
          );
          await page.locator('[data-tab="now"]').click();
          await page.evaluate(() => {
            const { state, settings, tokyoNow } = window.__state;
            settings.autoDetect = false;
            state.ride = {
              operator: "subway",
              from: "K07",
              to: "K01",
              destination: "国際会館",
              category: "local",
              direction: "north",
              officialStops: [
                { id: "K07", name: "丸太町", time: tokyoNow().minute - 1 },
                { id: "K01", name: "国際会館", time: tokyoNow().minute + 10 },
              ],
            };
            window.__view.renderNow();
          });
          await page.locator(".ride-action-list [data-open-foldback]").click();
          await page.locator("#foldback-sheet[open]").waitFor();
          await layout(page, "foldback sheet");
          await page.locator("[data-sheet-close]").click();
          await page.locator("#ride-end").click();
          assert.equal(
            await page.evaluate(() => window.__state.state.ride),
            null,
          );
          await page.evaluate(() =>
            window.__emitPosition(34.984613, 135.758343),
          );
          await arrivalsScreen(page);
          await page
            .locator("#kintetsu-arrival-card")
            .waitFor({ state: "visible" });
          await page.locator("#arrival-rail .arrival-line").first().waitFor();
          await layout(page, "nearby Kintetsu arrival card");
          assert.deepEqual(functional.errors, []);
        } finally {
          await functional.context.close();
        }
        summary.checks.push(
          "Actual Module Web Worker search, station timetable/trip sheet, pass persistence, foldback sheet, end ride and contextual rail arrivals",
        );

        const foldScenario = {},
          fold = await open({ scenario: foldScenario, clock: true });
        try {
          const { page } = fold;
          await setRide(page);
          const now = await page.evaluate(
            () => window.__state.tokyoNow().minute,
          );
          foldScenario.foldEntries = [1, 5, 15, 20, 40].map((offset, i) => ({
            depart: now + offset,
            category: i % 2 ? "express" : "local",
            destination: i % 2 ? "大和西大寺" : "国際会館",
            tripId: `fold-${i}`,
          }));
          assert.equal(
            await page
              .locator('[data-view="now"]')
              .getAttribute("data-context"),
            "rail",
          );
          assert.match(
            await page.locator(".journey-delay").textContent(),
            /3分/,
          );
          const trainMarker = await page
            .locator(".next-station-hero")
            .elementHandle();
          await page.evaluate(() => {
            for (let i = 0; i < 5; i++) window.__view.renderNow();
          });
          assert.equal(
            await trainMarker.evaluate(
              (el) => el === document.querySelector(".next-station-hero"),
            ),
            true,
          );
          await page.locator(".ride-action-list [data-open-foldback]").click();
          await page.locator('[data-foldback-mode="train"]').click();
          assert.ok(
            (
              await page.locator("#target-station option").allTextContents()
            ).some((name) => name.includes("京都")),
            "Terminus must be selectable",
          );
          await page.locator("#target-station").selectOption("K08");
          await page.locator("[data-load-target-trains]").click();
          await page.locator("[data-target-index]").first().waitFor();
          assert.equal(fold.counts.boards.at(-1).direction, "north");
          await page.locator('[data-target-index="0"]').click();
          assert.match(
            await page.locator(".target-result").textContent(),
            /不足/,
          );
          assert.equal(
            await page.locator("[data-save-foldback]").isDisabled(),
            true,
          );
          await page
            .locator("#target-trains [data-load-target-trains]")
            .click();
          await page.locator('[data-target-index="2"]').waitFor();
          await page.locator('[data-target-index="2"]').click();
          assert.match(
            await page.locator(".target-result").textContent(),
            /確保/,
          );
          await layout(
            page,
            "selected opposite-direction train and transfer margin",
          );
          await page.screenshot({
            path: resolve(artifacts, "foldback-selected.png"),
            fullPage: true,
            animations: "disabled",
          });
          await page.locator("[data-save-foldback]").click();
          await page.locator(".foldback-plan").waitFor();
          assert.equal(
            await page.evaluate(() => window.__state.state.foldbackPlan.tripId),
            "fold-2",
          );
          await page.evaluate(() => {
            window.__state.state.rideShift = 12;
            window.__view.renderNow();
          });
          assert.match(
            await page.locator(".foldback-plan").textContent(),
            /不足/,
          );
          await page.evaluate(() => {
            window.__state.state.locationStatus = "unavailable";
            window.__view.renderNow();
          });
          assert.equal(await page.locator(".journey-display").count(), 1);
          await page
            .locator('.navigation-current [data-navigation-screen="delay"]')
            .click();
          await settleNavigation(page);
          assert.match(
            await page
              .locator(".navigation-current .context-facts")
              .first()
              .textContent(),
            /未取得/,
          );
          await backScreen(page);
          await page.evaluate(() => {
            window.__state.state.locationStatus = "active";
            window.__state.state.rideShift = 3;
            window.__view.renderNow();
          });
          await page.locator(".ride-action-list [data-open-foldback]").click();
          await page.locator('[data-foldback-mode="station"]').click();
          await page.locator("#fold-station").selectOption("K11");
          await page.locator("[data-foldback-search]").click();
          await page.locator("[data-target-index]").first().waitFor();
          await layout(page, "foldback at the terminus");
          assert.equal(fold.counts.boards.at(-1).stop, "K11");
          assert.equal(fold.counts.boards.at(-1).direction, "north");
          await page.locator("[data-foldback-home]").click();
          await page.locator('[data-foldback-mode="train"]').click();
          await page.locator("#target-station").selectOption("K08");
          foldScenario.delayBoard = true;
          foldScenario.waitForBoard = new Promise(
            (resolve) => (foldScenario.releaseBoard = resolve),
          );
          await page.locator("[data-load-target-trains]").click();
          await page.locator('#target-trains[aria-busy="true"]').waitFor();
          await page.locator("#target-station").selectOption("K09");
          foldScenario.releaseBoard();
          foldScenario.delayBoard = false;
          await page.clock.runFor(100);
          assert.equal(
            await page.locator("[data-target-index]").count(),
            0,
            "Changing station must discard the previous response",
          );
          foldScenario.missingReverse = true;
          await page.locator("[data-load-target-trains]").click();
          await page.waitForFunction(() =>
            document
              .querySelector("#target-trains")
              .textContent.includes("反対方向の時刻表を取得できません"),
          );
          foldScenario.missingReverse = false;
          foldScenario.failBoard = true;
          await page.locator("[data-load-target-trains]").first().click();
          await page.waitForFunction(() =>
            document
              .querySelector("#target-trains")
              .textContent.includes("取得できませんでした"),
          );
          foldScenario.failBoard = false;
          await page
            .locator("#target-trains [data-load-target-trains]")
            .click();
          await page.locator("[data-target-index]").first().waitFor();
          await page.evaluate(() => {
            window.__state.state.ride.officialStops[2].time = null;
          });
          await page.locator('[data-target-index="2"]').click();
          assert.match(
            await page.locator(".target-result").textContent(),
            /確認できません/,
          );
          assert.equal(
            await page.locator("[data-save-foldback]").isDisabled(),
            true,
          );
          await page.locator("[data-sheet-close]").click();
          await setRide(page, "citybus", false);
          assert.equal(
            await page
              .locator('[data-view="now"]')
              .getAttribute("data-context"),
            "bus",
          );
          assert.equal(await page.locator("#ride-foldback").count(), 0);
          assert.equal(await page.locator("#network-panel").textContent(), "");
          await page.locator("#ride-end").click();
          assert.equal(
            await page
              .locator('[data-view="now"]')
              .getAttribute("data-context"),
            "nearby",
          );
          assert.equal(
            await page.evaluate(() => window.__state.state.foldbackPlan),
            null,
          );
          await setRide(page, "kintetsu");
          await page.evaluate(() => {
            const { state } = window.__state;
            state.ride.officialStops.forEach((stop) => (stop.time -= 8));
            const point = state.geo.stops.find(
              (s) => s.id === state.ride.officialStops[1].id,
            );
            window.__emitPosition(point.lat, point.lng);
          });
          assert.equal(
            await page.evaluate(() => window.__state.state.rideShift),
            6,
            "Current GPS position must update the rail delay",
          );
          assert.match(
            await page.locator(".journey-delay").textContent(),
            /6分/,
          );
          await page.locator('[data-navigation-screen="stops"]').click();
          await settleNavigation(page);
          assert.equal(
            await page.locator(".journey-stop-list .current").count(),
            1,
          );
          assert.deepEqual(fold.errors, []);
        } finally {
          foldScenario.releaseBoard?.();
          await fold.context.close();
        }
        summary.checks.push(
          "Favorite train selection and saving, terminus turnaround, margin changes with delay, missing times, underground continuity, reverse direction, stale request cancellation, retries and GPS-based rail delay",
        );

        const practicalFeed = {
          ...subwayFeed,
          services: [
            ...subwayFeed.services,
            {
              id: "browser-reverse",
              operator: "subway",
              category: "local",
              stops: ["K07", "K08", "K09"],
              trips: [
                {
                  id: "favorite-return",
                  date,
                  arrivals: [615, 620, 625],
                  departures: [615, 620, 625],
                  headsign: "四条",
                },
              ],
            },
          ],
          stops: [
            ...subwayFeed.stops,
            { id: "K08", name: "烏丸御池" },
            { id: "K09", name: "四条" },
          ],
        };
        const practical = await open({
          time: "2026-10-11T01:05:00Z",
          scenario: { subwayFeed: practicalFeed },
        });
        try {
          const { page } = practical;

          await page.locator(".nearby-departures time").first().waitFor();
          assert.match(
            await page.locator(".nearby-departures").first().textContent(),
            /10:05/,
          );
          await layout(page, "nearby official departures");
          await page.screenshot({
            path: resolve(artifacts, "nearby-departures.png"),
            fullPage: true,
            animations: "disabled",
          });
          await page.locator('[data-tab="timetable"]').click();
          await searchScreen(page);
          await submitSearch(page);
          await page
            .locator(".navigation-current [data-open-route]")
            .first()
            .click();
          await page
            .locator(".navigation-current [data-board-route]")
            .first()
            .waitFor();
          await page
            .locator(".navigation-current [data-board-route]")
            .first()
            .click();
          await page.locator(".journey-display").waitFor();
          assert.equal(
            await page
              .locator('[data-view="now"]')
              .getAttribute("data-context"),
            "rail",
          );
          await page.reload();
          await page.locator(".journey-display").waitFor();
          assert.match(
            await page.locator(".route-header").textContent(),
            /国際会館/,
          );
          const favorite = await page.evaluate(async () => {
            const search = new URL(
              document.querySelector("script[type=module]").src,
            ).search;
            const m = await import(
              new URL(`js/vnext-state.js${search}`, location.href)
            );
            const plan = {
              rideKey: m.rideKey(m.state.ride),
              stopId: "K07",
              date: "2026-10-11",
              day: "holiday",
              depart: 615,
              direction: "south",
              destination: "四条",
              buffer: 3,
              tripId: "favorite-return",
            };
            m.state.foldbackPlan = plan;
            m.persistJourney(true);
            const view = await import(
              new URL(`js/vnext-view.js${search}`, location.href)
            );
            view.renderNow();
            return plan;
          });
          await page.reload();
          await page.locator("[data-start-foldback]").waitFor();
          assert.match(
            await page.locator(".foldback-plan").textContent(),
            /10:15/,
          );
          await layout(page, "restored favorite return train");
          await page.locator("[data-start-foldback]").click();
          await page.waitForFunction(() =>
            document
              .querySelector(".route-header")
              ?.textContent.includes("四条"),
          );
          assert.match(
            await page.locator(".journey-stop-list").textContent(),
            /烏丸御池/,
          );
          await page.screenshot({
            path: resolve(artifacts, "return-journey.png"),
            fullPage: true,
            animations: "disabled",
          });
          assert.equal(
            await page.evaluate(
              () =>
                JSON.parse(localStorage.getItem("mymap-active-journey-v1"))
                  .foldbackPlan,
            ),
            null,
          );
          await page.locator("#ride-end").click();
          await page.reload();
          await page
            .locator('[data-view="now"][data-context="nearby"]')
            .waitFor();
          assert.equal(
            await page.evaluate(() =>
              localStorage.getItem("mymap-active-journey-v1"),
            ),
            null,
          );
          await page.locator('[data-tab="timetable"]').click();
          await tabRoot(page, "timetable");
          await page.locator("#timetable-search").fill("丸太町");
          await page.locator('[data-timetable-stop="K07"]').click();
          await page.locator(".minute-cell").first().click();
          await page.locator("[data-board-trip]").waitFor();
          await layout(page, "manual boarding from official subway trip");
          await page.locator("[data-board-trip]").click();
          await page.locator(".journey-display").waitFor();
          assert.equal(
            await page.locator(".navigation-current[data-screen=trip]").count(),
            0,
          );
          assert.deepEqual(practical.errors, []);
        } finally {
          await practical.context.close();
        }
        summary.checks.push(
          "Manual boarding from route search and subway timetable, reload restoration, selected foldback restoration and return boarding, explicit end survives reload, nearby official departures",
        );

        if (server) {
          const context = await browser.newContext({
              serviceWorkers: "allow",
            }),
            page = await context.newPage();
          try {
            await page.goto(`${base}/__sw-check`);
            await page.evaluate(async () => {
              await navigator.serviceWorker.register("/sw.js", {
                scope: "/",
              });
              await navigator.serviceWorker.ready;
              if (!navigator.serviceWorker.controller)
                await new Promise((resolve) =>
                  navigator.serviceWorker.addEventListener(
                    "controllerchange",
                    resolve,
                    { once: true },
                  ),
                );
            });
            const before = serverRequests.get("/vnext-journey.css") ?? 0;
            const assets = await page.evaluate(async () => {
              const responses = await Promise.all([
                fetch("/vnext-journey.css"),
                fetch("/js/journey-core.js"),
                fetch("/data/locations.json"),
              ]);
              return Promise.all(
                responses.map(async (r) => ({
                  ok: r.ok,
                  bytes: (await r.text()).length,
                })),
              );
            });
            assert.ok(assets.every((r) => r.ok && r.bytes > 100));
            assert.equal(
              serverRequests.get("/vnext-journey.css"),
              before,
              "Precached assets must not be fetched again",
            );
            // WebKit's protocol offline mode can reject even SW-cached responses.
            // Cut the actual origin connection in both engines instead, then prove
            // an uncached request fails before checking the cached app shell.
            originUnavailable = true;
            assert.equal(
              await page.evaluate(async () => {
                try {
                  await fetch("/__network-check", { cache: "no-store" });
                  return true;
                } catch {
                  return false;
                }
              }),
              false,
              "The origin must be unreachable during the offline checks",
            );
            assert.equal(
              await page.evaluate(async () => {
                const r = await fetch("/vnext-journey.css");
                return r.ok && (await r.text()).includes(".journey-display");
              }),
              true,
            );
            await page.goto(base);
            await page.locator('[data-view="now"] [data-live-plan]').waitFor();
            await layout(page, "offline PWA navigation and app shell");
          } finally {
            originUnavailable = false;
            await context.close();
          }
          summary.checks.push(
            "Real Service Worker install, precached assets without extra network requests, offline CSS and offline app navigation",
          );
        }
      }
      // Additional visual handoff: C stays practical at all text sizes and GPS
      // states. Form disclosures and result actions must remain usable.
      for (const colorScheme of ["light", "dark"])
        for (const scale of [1, 1.5, 2])
          for (const gps of ["active", "denied"]) {
            const run = await open({
              colorScheme,
              reducedMotion: gps === "denied" ? "reduce" : "no-preference",
              time: "2026-10-11T01:00:00Z",
              scenario: { gps, stopsAway: 1 },
            });
            try {
              const { page } = run;
              await page.evaluate(
                (scale) =>
                  (document.documentElement.style.fontSize = `${16 * scale}px`),
                scale,
              );
              assert.equal(
                await page.locator(".topbar #location-indicator").count(),
                0,
              );
              assert.match(
                await page.locator("#now-hero").textContent(),
                /未乗車/,
              );
              await layout(page, `C home ${colorScheme} ${scale}x ${gps}`);
              if (scale === 1)
                await page.screenshot({
                  path: resolve(
                    artifacts,
                    `idle-${gps}-${colorScheme}-390.png`,
                  ),
                  animations: "disabled",
                });
              if (scale === 1 && gps === "active") {
                assert.ok(
                  (await page.locator(".nearby-guide").boundingBox()).y < 1000,
                );
              }
              await searchScreen(page);
              assert.equal(
                await page.locator(".planner-conditions").getAttribute("open"),
                null,
              );
              for (const [name, value, id] of [
                ["from", "丸太町", "K07"],
                ["to", "国際会館", "K01"],
              ]) {
                if (await page.locator(`[name="${name}"]`).inputValue())
                  continue;
                await page.locator(`[name="${name}"]`).click();
                await page.locator("[data-suggestion-input]").fill(value);
                await page
                  .locator(`#planner-suggestions [data-stop-id="${id}"]`)
                  .click();
                await settleNavigation(page);
              }
              const swap = await page
                .locator("#planner-form .planner-swap")
                .boundingBox();
              assert.ok(swap.width >= 44 && swap.height >= 44);
              await page.locator("#planner-form .planner-swap").click();
              assert.equal(
                await page.locator('[name="from"]').inputValue(),
                "国際会館",
              );
              await page.locator("#planner-form .planner-swap").click();
              if (scale === 1) {
                const search = await page
                  .locator("#planner-form .planner-submit")
                  .boundingBox();
                assert.ok(search.y + search.height < 500);
              }
              await layout(page, `C ${colorScheme} ${scale}x GPS ${gps}`);
              await searchScreen(page);
              await page.locator(".planner-conditions").click();
              await page
                .locator("#search-filter[open] .planner-filter-fields")
                .waitFor();
              await layout(
                page,
                `C search conditions ${colorScheme} ${scale}x ${gps}`,
              );
              await searchScreen(page);
              await submitSearch(page);
              await page
                .locator(".navigation-current .planner-result")
                .first()
                .waitFor();
              const first = page
                .locator(".navigation-current .planner-result")
                .first();
              assert.equal(await first.locator("[data-open-route]").count(), 1);
              await page
                .locator(
                  ".navigation-current [data-planner-status] .loading-note",
                )
                .waitFor({ state: "hidden", timeout: 8000 });
              assert.equal(
                await page
                  .locator(".navigation-current [data-planner-status]")
                  .textContent(),
                "",
              ); // Unrelated North 3 warning must not appear on a subway result.
              await page
                .locator(".navigation-current [data-open-route]")
                .first()
                .click();
              await layout(
                page,
                `C route result ${colorScheme} ${scale}x ${gps}`,
              );
              if (scale === 1)
                await page.screenshot({
                  path: resolve(
                    artifacts,
                    `route-result-${gps}-${colorScheme}-390.png`,
                  ),
                  animations: "disabled",
                  fullPage: true,
                });
              assert.equal(
                await page
                  .locator(".arrival-card")
                  .first()
                  .evaluate((el) => getComputedStyle(el.parentElement).opacity),
                "1",
              );
              assert.ok(
                (await page.locator(".arrival-line.imminent").count()) > 0,
              );
              if (gps === "denied")
                assert.equal(
                  await page
                    .locator(".arrival-line.imminent .arrival-minutes span")
                    .first()
                    .evaluate((el) => getComputedStyle(el).animationName),
                  "none",
                );
              await page
                .locator(".navigation-current [data-arm-route]")
                .first()
                .click();
              await page.locator(".armed-journey").waitFor();
              assert.equal(
                await page
                  .locator('[data-view="now"]')
                  .getAttribute("data-context"),
                "nearby",
              );
              await page.locator("[data-open-settings]").click();
              await settleNavigation(page);
              await page.locator('[data-setting-page="location"]').click();
              await settleNavigation(page);
              await page
                .locator(".navigation-current #location-indicator")
                .waitFor();
              assert.deepEqual(run.errors, []);
            } finally {
              await run.context.close();
            }
          }
      summary.checks.push(
        "390px C: GPS ON/OFF, light/dark, 100–200% text, input swap, disclosed options, route comparison and armed selection, settings location control, meaningful one-stop approach emphasis",
      );
      if (process.env.VERIFY_LIVE_MAP === "1") {
        const live = await open({
          time: "2026-10-11T01:00:00Z",
          scenario: { liveMap: true },
        });
        try {
          const { page } = live;
          const failedMapResponses = [];
          page.on("response", (r) => {
            if (
              new URL(r.url()).hostname === "tile.openstreetmap.org" &&
              r.status() !== 200
            )
              failedMapResponses.push({ url: r.url(), status: r.status() });
          });
          const response = page.waitForResponse(
            (r) =>
              new URL(r.url()).hostname === "tile.openstreetmap.org" &&
              r.status() === 200,
          );
          await setRide(page, "citybus");
          const tile = await response;
          assert.match(tile.headers()["content-type"] ?? "", /image\/png/);
          const bytes = await tile.body();
          assert.ok(bytes.length > 1024);
          assert.equal(
            bytes.subarray(0, 8).toString("hex"),
            "89504e470d0a1a0a",
          );
          const tileStates = () =>
            page.evaluate(() =>
              [...document.querySelectorAll(".bus .map-tile")].map((img) => ({
                url: img.src,
                loaded: img.complete && img.naturalWidth === 256,
                failed: img.dataset.tileFailed,
              })),
            );
          try {
            await page.waitForFunction(() =>
              [...document.querySelectorAll(".bus .map-tile")].every(
                (img) => img.complete && img.naturalWidth === 256,
              ),
            );
          } catch (error) {
            throw Error(
              `${error.message}; tiles: ${JSON.stringify(await tileStates())}`,
            );
          }

          assert.deepEqual(
            failedMapResponses,
            [],
            "All visible map tiles return successfully",
          );
          await page.screenshot({
            path: resolve(artifacts, "bus-real-basemap-390.png"),
            animations: "disabled",
          });
          assert.deepEqual(live.errors, []);
          summary.checks.push(
            "Real OpenStreetMap PNG download and rendered bus map",
          );
        } finally {
          await live.context.close();
        }
      }
      for (const colorScheme of ["light", "dark"])
        for (const scale of [1, 2]) {
          const run = await open({
            width: 805,
            height: 757,
            colorScheme,
            reducedMotion: "reduce",
            time: "2026-10-11T01:00:00Z",
          });
          try {
            const { page } = run;
            await page.evaluate(
              (scale) =>
                (document.documentElement.style.fontSize = `${16 * scale}px`),
              scale,
            );
            await searchScreen(page);
            await page.locator(".planner-conditions").click();
            await layout(page, `805x757 search form ${colorScheme} ${scale}x`);
            await searchScreen(page);
            await submitSearch(page);
            await page
              .locator(".navigation-current .planner-result")
              .first()
              .waitFor();
            await page
              .locator(".navigation-current [data-open-route]")
              .first()
              .click();
            await layout(
              page,
              `805x757 comparison card ${colorScheme} ${scale}x`,
            );
            assert.ok(
              Math.abs((await page.locator(".topbar").boundingBox()).y) <= 1,
              "Header stays visible while comparing routes",
            );
            if (scale === 1)
              await page.screenshot({
                path: resolve(artifacts, `planner-805-${colorScheme}.png`),
                animations: "disabled",
              });
            assert.deepEqual(run.errors, []);
          } finally {
            await run.context.close();
          }
        }
      // PDF v1.1: readable next station, through-service bridge, both North 3
      // directions, Dynamic Type, station sheets and shared journey state.
      for (const colorScheme of ["light", "dark"]) {
        for (const textScale of [1, 1.5, 2]) {
          const spec = await open({
            colorScheme,
            reducedMotion: "reduce",
            time: "2026-10-13T01:01:00Z",
          });
          try {
            const { page } = spec;
            await page.evaluate(
              (scale) =>
                (document.documentElement.style.fontSize = `${16 * scale}px`),
              textScale,
            );
            await page.evaluate(() => {
              const { state, settings } = window.__state;
              settings.autoDetect = false;
              const ids = [
                "K08",
                "K09",
                "K10",
                "K11",
                "K12",
                "K13",
                "K14",
                "K15",
              ];
              state.ride = {
                operator: "subway",
                category: "local",
                destination: "竹田",
                from: ids[0],
                to: ids.at(-1),
                depart: 600,
                userDestination: { id: "K11" },
                officialStops: ids.map((id, i) => ({
                  id,
                  name: state.network.stops.get(id).name,
                  time: 600 + i * 2,
                  departure: 600 + i * 2,
                })),
              };
              state.heroObservation = null;
              state.rideShift = 0;
              state.rideShiftKnown = false;
              state.fix = null;
              state.locationStatus = "denied";
              window.__view.renderNow();
            });
            assert.equal(
              await page.locator(".journey-display").getAttribute("data-phase"),
              "DEPARTED",
            );
            assert.match(
              await page.locator(".journey-next-name").textContent(),
              /四条/,
            );
            assert.match(
              await page.locator(".next-state-label").textContent(),
              /次は/,
            );
            assert.match(
              await page.locator(".rail-estimate-note").textContent(),
              /時刻表による推定/,
              "GPS-denied ride must disclose that next-station timing is estimated",
            );
            assert.match(
              await page
                .locator(".next-station-hero")
                .getAttribute("aria-label"),
              /四条 K09.*目的地京都/,
            );
            const dimensions = await page
              .locator(".personal-destination")
              .evaluate((el) => ({
                bottom: el.getBoundingClientRect().bottom,
                viewport: innerHeight,
                hero: el.closest(".journey-display").className,
              }));
            const fit = dimensions.bottom < dimensions.viewport - 75;
            if (!fit)
              await page.screenshot({
                path: resolve(
                  artifacts,
                  `hero-overflow-${colorScheme}-${textScale}x.png`,
                ),
                fullPage: true,
                animations: "disabled",
              });
            assert.equal(
              fit,
              true,
              `Next station and personal destination fit together at ${textScale}x: ${JSON.stringify(dimensions)}`,
            );
            if (textScale === 1)
              await page.screenshot({
                path: resolve(artifacts, `rail-hero-${colorScheme}-390.png`),
                animations: "disabled",
              });
            await page.locator('[data-navigation-screen="stops"]').click();
            await settleNavigation(page);
            await page
              .locator(
                '.navigation-current .station-name-button[data-station-detail="K09"]',
              )
              .click();
            await page
              .locator(".navigation-current[data-screen=station]")
              .waitFor();
            await layout(
              page,
              `PDF station sheet ${colorScheme} ${textScale}x`,
            );
            await page.locator('[data-choose-destination="K09"]').click();
            assert.match(
              await page.locator(".next-state-label").textContent(),
              /次は/,
            );
            assert.match(
              await page.locator(".rail-estimate-note").textContent(),
              /停車・到着は未確認/,
            );
            await page.evaluate(() => {
              window.__state.state.ride.userDestination = { id: "K11" };
              window.__view.renderNow();
            });
            await backScreen(page);
            await layout(page, `PDF LCD ${colorScheme} ${textScale}x`);
            await page.locator('[data-navigation-screen="delay"]').click();
            await layout(
              page,
              `PDF delay evidence ${colorScheme} ${textScale}x`,
            );
            await backScreen(page);
            await page.locator('[data-navigation-screen="map"]').click();
            await settleNavigation(page);
            const fullMap = await page
              .locator(".navigation-current[data-screen=map]")
              .evaluate((el) => ({
                top: el.getBoundingClientRect().top,
                height: el.getBoundingClientRect().height,
                viewport: document.querySelector("main").clientHeight,
                mainTop: document.querySelector("main").getBoundingClientRect()
                  .top,
              }));
            // WebKit quantizes viewport lengths to fractional CSS pixels; use the
            // same half-pixel tolerance as the surrounding viewport bounds checks.
            assert.ok(Math.abs(fullMap.top - fullMap.mainTop) <= 0.5);
            assert.ok(Math.abs(fullMap.height - fullMap.viewport) <= 0.5);
            await layout(
              page,
              `PDF fullscreen map ${colorScheme} ${textScale}x`,
            );
            const map = page.locator(
              ".navigation-current[data-screen=map] .route-map",
            );
            assert.ok((await map.locator(".map-tile").count()) > 0);
            await map
              .locator(".map-tile[src]")
              .first()
              .waitFor({ state: "attached" });
            const oldTile = await map
              .locator(".map-tile")
              .first()
              .getAttribute("data-tile-src");
            await map.locator('[data-map-zoom="1"]').click();
            assert.notEqual(
              await map
                .locator(".map-tile")
                .first()
                .getAttribute("data-tile-src"),
              oldTile,
            );
            await map.locator("[data-map-reset]").click();
            assert.match(
              await map.locator(".map-attribution").textContent(),
              /OpenStreetMap/,
            );
            await page.evaluate(() => {
              window.__tile = document.querySelector(
                ".navigation-current[data-screen=map] .map-tile",
              );
              window.__view.renderNow();
            });
            assert.equal(
              await page.evaluate(
                () =>
                  window.__tile ===
                  document.querySelector(
                    ".navigation-current[data-screen=map] .map-tile",
                  ),
              ),
              true,
            );

            await backScreen(page);
            for (const direction of ["south", "north"]) {
              await page.evaluate((direction) => {
                const { state } = window.__state,
                  ids =
                    direction === "south"
                      ? ["K14", "K15", "B06", "B07"]
                      : ["B06", "K15", "K14", "K13"];
                state.ride = {
                  operator: "through",
                  direction,
                  category: "local",
                  destination:
                    direction === "south" ? "大和西大寺" : "国際会館",
                  from: ids[0],
                  to: ids.at(-1),
                  officialStops: ids.map((id, i) => ({
                    id,
                    name: state.network.stops.get(id).name,
                    time: 599 + i * 3,
                    departure: 599 + i * 3,
                  })),
                };
                state.heroObservation = null;
                window.__view.renderNow();
              }, direction);
              assert.equal(
                await page
                  .locator(".journey-display")
                  .getAttribute("data-train-state"),
                "LINE_BOUNDARY",
              );
              assert.match(
                (await page.locator(".station-code").textContent()).trim(),
                /^(K15|B05)$/,
                "the through-service boundary shows one valid station code",
              );
              assert.match(
                await page.locator(".journey-next-name").textContent(),
                /竹田/,
                "Takeda remains the primary station name",
              );
              await layout(
                page,
                `PDF Takeda ${direction} ${colorScheme} ${textScale}x`,
              );
            }
            for (const reverse of [false, true]) {
              await page.evaluate(async (reverse) => {
                const { state, tokyoNow } = window.__state,
                  search = new URL(
                    document.querySelector("script[type=module]").src,
                  ).search;
                const m = await import(
                  new URL(`js/north3-feed.js${search}`, location.href)
                );
                const snapshot = await m.loadNorth3Snapshot(),
                  feed = m.north3Feed(
                    snapshot,
                    state.network,
                    tokyoNow().date,
                    {
                      schoolDay: true,
                    },
                  ),
                  service = feed.services[reverse ? 1 : 0],
                  trip = service.trips.find((t) => t.departures[0] >= 600);
                state.ride = {
                  operator: "citybus",
                  route: "北3",
                  operatingCompany: "kyotobus",
                  operatingConditions: { schoolDayRequired: true },
                  from: service.stops[0],
                  to: service.stops.at(-1),
                  destination: trip.headsign,
                  userDestination: { id: service.stops[6] },
                  officialStops: service.stops.map((id, i) => ({
                    id,
                    name: state.network.stops.get(id).name,
                    time: trip.arrivals[i],
                    departure: trip.departures[i],
                    estimated: i === 9,
                  })),
                };
                state.busTrail = [];
                state.heroObservation = null;
                state.busLive = null;
                state.rideShift = 0;
                state.fix = null;
                window.__view.renderNow();
              }, reverse);
              assert.match(
                await page.locator(".route-header").textContent(),
                /北3.*North 3.*京都バス/,
              );
              assert.equal(
                await page.locator(".journey-stop-list > li").count(),
                10,
              );
              assert.equal(await page.locator("#ride-foldback").count(), 0);
              await layout(
                page,
                `PDF North 3 ${reverse ? "inbound" : "outbound"} ${colorScheme} ${textScale}x`,
              );
              const destinationFit = await page
                .locator(".personal-destination")
                .evaluate(
                  (el) => el.getBoundingClientRect().bottom < innerHeight - 75,
                );
              if (!destinationFit) {
                await page.screenshot({
                  path: resolve(
                    artifacts,
                    `bus-hero-overflow-${colorScheme}-${textScale}x-${reverse}.png`,
                  ),
                  animations: "disabled",
                });
                console.log(
                  "Bus Hero bounds",
                  await page.locator(".journey-display").evaluate((e) => ({
                    hero: e.getBoundingClientRect().toJSON(),
                    children: [...e.children].map((c) => ({
                      class: c.className,
                      rect: c.getBoundingClientRect().toJSON(),
                    })),
                  })),
                );
              }
              assert.ok(
                destinationFit,
                `Bus next stop and alighting destination stay together at ${textScale}x`,
              );
              if (textScale === 1)
                await page.screenshot({
                  path: resolve(
                    artifacts,
                    `north3-${reverse ? "inbound" : "outbound"}-${colorScheme}.png`,
                  ),
                  fullPage: true,
                  animations: "disabled",
                });
            }
            const touch = await page.evaluate(() =>
              [...document.querySelectorAll("button")]
                .filter(
                  (el) =>
                    el.getBoundingClientRect().width &&
                    el.getBoundingClientRect().height,
                )
                .filter((el) => {
                  const r = el.getBoundingClientRect();
                  return r.width < 44 || r.height < 44;
                })
                .map((el) => el.className),
            );
            assert.deepEqual(
              touch,
              [],
              `44px touch targets ${colorScheme} ${textScale}x`,
            );
            assert.deepEqual(spec.errors, []);
          } finally {
            await spec.context.close();
          }
        }
      }
      summary.checks.push(
        "PDF v1.1 LCD hero, both Takeda directions, both North 3 directions, 100–200% text sizing, station/delay sheets, 44px touch targets",
      );
    }
  }
  summary.performance = report;
  await writeFile(
    resolve(artifacts, "report.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  const message = error?.stack ?? String(error);
  summary.errors.push(message);
  await writeFile(
    resolve(artifacts, "failure-report.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.error(
    `::error title=${engine.name()} browser verification::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`,
  );
  throw error;
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
