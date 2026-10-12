// Real browser checks with deterministic upstream fixtures. These do not
// certify the availability or accuracy of production transport providers.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { chromium, webkit } from "playwright";

const dist = resolve("dist"),
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
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ gps, corrupt }) => {
      if (corrupt) {
        localStorage.setItem("mymap-vnext-settings", "{invalid");
        localStorage.setItem("mymap-arrivals-v3", "null");
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
    { gps: scenario.gps ?? "active", corrupt: Boolean(scenario.corrupt) },
  );
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(base).origin) {
      counts.assets++;
      await route.continue();
      return;
    }
    let data,
      status = 200;
    const asOf = new Date().toISOString();
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
      data = {
        kind: "rail-live",
        asOf,
        source: "live",
        trains: [
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
        url.searchParams.get("operator") === "subway"
          ? (scenario.subwayFeed ?? subwayFeed)
          : {
              validDates: [date],
              meta: {
                operator: url.searchParams.get("operator"),
                stale: false,
              },
              stops: [],
              services: [],
            };
    } else if (url.pathname === "/api/bus/rt") {
      status = 503;
      data = { code: "odpt_not_configured", error: "ODPT fixture disabled" };
    } else if (url.pathname === "/operations")
      data = {
        lines: [
          {
            id: "subway",
            name: "地下鉄烏丸線",
            status: "normal",
            summary: "平常どおり運行しています",
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
  return { counts, errors };
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
  await page
    .locator("#arrival-live .arrival-line, #arrival-live .arrival-empty")
    .first()
    .waitFor();
  await page.evaluate(async () => {
    const search = new URL(document.querySelector("script[type=module]").src)
      .search;
    window.__state = await import(
      new URL(`js/vnext-state.js${search}`, location.href).href
    );
    window.__view = await import(
      new URL(`js/vnext-view.js${search}`, location.href).href
    );
  });
  return { context, page, ...f };
}

async function layout(page, label) {
  await page.locator(".tabbar").waitFor();
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
      ".arrival-dest,.arrival-minutes,.arrival-delay,.arrival-route-badge,.planner-form input,.planner-form select,.tab-button,.setting-row,.board-controls select,.operation-title,.sheet[open],.journey-next-name,.journey-metrics strong,.stop-times,.target-train,.fold-timing dd,.sheet-field select,.nearby-row",
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
    if (buttons.some((r) => r.height < 44))
      out.push("navigation touch target smaller than 44px");
    return out;
  });
  assert.deepEqual(problems, [], label);
  summary.layouts++;
}

async function setRide(page, operator = "subway", known = true) {
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
        category: "express",
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

try {
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
          for (const tab of ["now", "timetable", "operations", "settings"]) {
            if (tab !== "now")
              await page.locator(`[data-tab="${tab}"]`).click();
            if (tab === "operations")
              await page.locator(".operation-card").first().waitFor();
            await layout(page, `${width}x${height} ${colorScheme} ${tab}`);
          }
          await page.locator('[data-tab="now"]').click();
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
          await page.locator("#ride-foldback").click();
          await layout(page, `${width} ${colorScheme} foldback choice sheet`);
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
          assert.deepEqual(errors, [], `${width} ${colorScheme} page errors`);
        } finally {
          await context.close();
        }
      }
    summary.checks.push(
      "182 responsive layout checks; both themes, 4 tabs, stop picker, subway, Kintetsu, through, bus and all foldback steps",
    );

    const scenario = { stopsAway: 4 };
    const { context, page, counts, errors } = await open({
      scenario,
      clock: true,
    });
    try {
      await page.evaluate(() => {
        window.__rows = [
          ...document.querySelectorAll("#arrival-live .arrival-line"),
        ];
        window.__rowMutations = 0;
        window.__observer = new MutationObserver(
          (items) => (window.__rowMutations += items.length),
        );
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
          !document.querySelector("#arrival-live").hasAttribute("aria-busy"),
      );
      assert.equal(
        counts.bus,
        start + 1,
        "Exactly one foreground refresh per interval",
      );
      assert.equal(
        await page.evaluate(() => window.__rowMutations),
        0,
        "Timestamp-only responses must not replace any row content",
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
      const marker = await page
        .locator(".arrival-track-position")
        .first()
        .elementHandle();
      scenario.stopsAway = 2;
      await page.clock.runFor(20000);
      await page.waitForFunction(
        () =>
          !document.querySelector("#arrival-live").hasAttribute("aria-busy"),
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
        "2停留所前6停留所前",
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
      await page.clock.runFor(10);
      await page.waitForFunction(
        () =>
          !document.querySelector("#arrival-live").hasAttribute("aria-busy"),
      );
      assert.equal(counts.bus, beforeHidden + 1);
      // Switching stops aborts old work and prevents stale results under the new name.
      scenario.delayStop = "山越中町";
      scenario.waitForStop = new Promise(
        (resolve) => (scenario.releaseStop = resolve),
      );
      await page.locator("[data-arrival-change]").click();
      await page.locator("#arrival-stop-search").fill("山越中町");
      await page.locator("[data-arrival-stop]").first().click();
      await page.clock.runFor(10);
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

    const functional = await open();
    try {
      const { page } = functional;
      await page.locator('[data-tab="timetable"]').click();
      await page.locator('[name="date"]').fill(date);
      await page.locator('[name="time"]').fill("10:00");
      await page.locator(".planner-submit").click();
      await page.locator(".planner-result").first().waitFor();
      assert.match(
        await page.locator("#planner-results").textContent(),
        /10:22/,
      );
      await layout(page, "Module Worker route search result");
      await page.locator('[data-planner-view="board"]').click();
      await page.locator("#timetable-search").fill("丸太町");
      await page.locator('[data-timetable-stop="K07"]').click();
      await page.locator(".minute-cell").first().waitFor();
      await page.locator(".minute-cell").first().click();
      await page.locator("#timetable-trip[open]").waitFor();
      await layout(page, "station timetable detail sheet");
      await page.locator("[data-close-trip]").click();
      await page.locator('[data-tab="settings"]').click();
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
      await page.locator("#ride-foldback").click();
      await page.locator("#foldback-sheet[open]").waitFor();
      await layout(page, "foldback sheet");
      await page.locator("[data-sheet-close]").click();
      await page.locator("#ride-end").click();
      assert.equal(await page.evaluate(() => window.__state.state.ride), null);
      await page.evaluate(() => window.__emitPosition(34.984613, 135.758343));
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
      const now = await page.evaluate(() => window.__state.tokyoNow().minute);
      foldScenario.foldEntries = [1, 5, 15, 20, 40].map((offset, i) => ({
        depart: now + offset,
        category: i % 2 ? "express" : "local",
        destination: i % 2 ? "大和西大寺" : "国際会館",
        tripId: `fold-${i}`,
      }));
      assert.equal(
        await page.locator('[data-view="now"]').getAttribute("data-context"),
        "rail",
      );
      assert.match(await page.locator(".journey-delay").textContent(), /3分/);
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
      await page.locator("#ride-foldback").click();
      await page.locator('[data-foldback-mode="train"]').click();
      assert.ok(
        (await page.locator("#target-station option").allTextContents()).some(
          (name) => name.includes("京都"),
        ),
        "Terminus must be selectable",
      );
      await page.locator("#target-station").selectOption("K08");
      await page.locator("[data-load-target-trains]").click();
      await page.locator("[data-target-index]").first().waitFor();
      assert.equal(fold.counts.boards.at(-1).direction, "north");
      await page.locator('[data-target-index="0"]').click();
      assert.match(await page.locator(".target-result").textContent(), /不足/);
      assert.equal(
        await page.locator("[data-save-foldback]").isDisabled(),
        true,
      );
      await page.locator("#target-trains [data-load-target-trains]").click();
      await page.locator('[data-target-index="2"]').waitFor();
      await page.locator('[data-target-index="2"]').click();
      assert.match(await page.locator(".target-result").textContent(), /確保/);
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
      assert.match(await page.locator(".foldback-plan").textContent(), /不足/);
      await page.evaluate(() => {
        window.__state.state.locationStatus = "unavailable";
        window.__view.renderNow();
      });
      assert.equal(await page.locator(".journey-display").count(), 1);
      assert.match(
        await page.locator(".journey-location-status").textContent(),
        /未取得/,
      );
      await page.evaluate(() => {
        window.__state.state.locationStatus = "active";
        window.__state.state.rideShift = 3;
        window.__view.renderNow();
      });
      await page.locator("#ride-foldback").click();
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
      await page.locator("#target-trains [data-load-target-trains]").click();
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
        await page.locator('[data-view="now"]').getAttribute("data-context"),
        "bus",
      );
      assert.equal(await page.locator("#ride-foldback").count(), 0);
      assert.equal(await page.locator("#network-panel").textContent(), "");
      await page.locator("#ride-end").click();
      assert.equal(
        await page.locator('[data-view="now"]').getAttribute("data-context"),
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
      assert.match(await page.locator(".journey-delay").textContent(), /6分/);
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
      await page.locator(".planner-submit").click();
      await page.locator("[data-board-route]").first().waitFor();
      await page.locator("[data-board-route]").first().click();
      await page.locator(".journey-display").waitFor();
      assert.equal(
        await page.locator('[data-view="now"]').getAttribute("data-context"),
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
      assert.match(await page.locator(".foldback-plan").textContent(), /10:15/);
      await layout(page, "restored favorite return train");
      await page.locator("[data-start-foldback]").click();
      await page.waitForFunction(() =>
        document.querySelector(".route-header")?.textContent.includes("四条"),
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
      await page.locator('[data-view="now"][data-context="nearby"]').waitFor();
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("mymap-active-journey-v1"),
        ),
        null,
      );
      await page.locator('[data-tab="timetable"]').click();
      await page.locator('[data-planner-view="board"]').click();
      await page.locator("#timetable-search").fill("丸太町");
      await page.locator('[data-timetable-stop="K07"]').click();
      await page.locator(".minute-cell").first().click();
      await page.locator("[data-board-trip]").waitFor();
      await layout(page, "manual boarding from official subway trip");
      await page.locator("[data-board-trip]").click();
      await page.locator(".journey-display").waitFor();
      assert.equal(await page.locator("#timetable-trip[open]").count(), 0);
      assert.deepEqual(practical.errors, []);
    } finally {
      await practical.context.close();
    }
    summary.checks.push(
      "Manual boarding from route search and subway timetable, reload restoration, selected foldback restoration and return boarding, explicit end survives reload, nearby official departures",
    );

    if (server) {
      const context = await browser.newContext({ serviceWorkers: "allow" }),
        page = await context.newPage();
      try {
        await page.goto(`${base}/__sw-check`);
        await page.evaluate(async () => {
          await navigator.serviceWorker.register("/sw.js", { scope: "/" });
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
        await page.locator("#now-hero .hero-card").waitFor();
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
          const ids = ["K08", "K09", "K10", "K11", "K12", "K13", "K14", "K15"];
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
          "APPROACHING",
        );
        assert.match(
          await page.locator(".journey-next-name").textContent(),
          /四条/,
        );
        assert.match(
          await page.locator(".next-state-label").textContent(),
          /まもなく/,
        );
        assert.match(
          await page.locator(".next-station-hero").getAttribute("aria-label"),
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
        await page.locator('[data-station-detail="K09"]').first().click();
        await page.locator("#context-sheet[open]").waitFor();
        await layout(page, `PDF station sheet ${colorScheme} ${textScale}x`);
        await page.locator('[data-choose-destination="K09"]').click();
        assert.match(
          await page.locator(".next-state-label").textContent(),
          /次で降ります/,
        );
        await page.evaluate(() => {
          window.__state.state.ride.userDestination = { id: "K11" };
          window.__view.renderNow();
        });
        await layout(page, `PDF LCD ${colorScheme} ${textScale}x`);
        await page.locator('[data-context-action="delay"]').click();
        await layout(page, `PDF delay evidence ${colorScheme} ${textScale}x`);
        await page.locator("[data-context-close]").click();
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
              destination: direction === "south" ? "大和西大寺" : "国際会館",
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
            await page.locator(".station-code").textContent(),
            /K15.*B05|B05.*K15/,
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
              feed = m.north3Feed(snapshot, state.network, tokyoNow().date, {
                schoolDay: true,
              }),
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
