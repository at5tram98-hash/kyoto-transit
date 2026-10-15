// Verify real release transitions under the GitHub Pages subpath.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { existsSync } from "node:fs";
import { chromium, webkit } from "playwright";
import { gzipSync } from "node:zlib";
const dist = resolve("dist"),
  scope = "/kyoto-transit/";
const html = await readFile(resolve(dist, "index.html"), "utf8"),
  oldVersion = html.match(/vnext\.js\?v=([a-f0-9]+)/)[1];
const versions = [oldVersion, "bbbbbbbbbbbb", "cccccccccccc"],
  legacyVersion = "000000000000",
  legacyWorker = (await readFile("tests/fixtures/legacy-sw.js", "utf8"))
    .replace("__BUILD_VERSION__", legacyVersion)
    .replace(
      "__PRECACHE__",
      JSON.stringify(["./", "index.html", "js/network.js", "vnext.css"]),
    ),
  mime = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
  };
let release = 0,
  failInstall = false,
  originUnavailable = false,
  legacyRelease = false;
let apiBase;
const allowedOrigins = new Set(),
  apiRequests = [];
const apiServer = createServer((req, res) => {
  const url = new URL(req.url, "http://fixture"),
    origin = req.headers.origin;
  apiRequests.push({
    path: url.pathname,
    origin,
    method: req.method,
    requestedHeaders: req.headers["access-control-request-headers"],
  });
  if (!allowedOrigins.has(origin)) {
    res.writeHead(403).end();
    return;
  }
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
    Vary: "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, headers).end();
    return;
  }
  const data =
    url.pathname === "/api/static/feed"
      ? {
          schemaVersion: 1,
          source: "PWA HTTP fixture",
          validDates: [url.searchParams.get("date") ?? "2026-10-11"],
          stops: [],
          services: [],
          meta: { operator: url.searchParams.get("operator"), stale: false },
        }
      : {
          results: [],
          trains: [],
          vehicles: [],
          lines: [],
          entries: [],
          boards: [],
          trips: [],
          source: "live",
          asOf: "2026-10-11T01:05:00Z",
        };
  res.writeHead(200, headers).end(JSON.stringify(data));
});
await new Promise((r) => apiServer.listen(0, "127.0.0.1", r));
apiBase = `http://127.0.0.1:${apiServer.address().port}`;
const server = createServer(async (req, res) => {
  if (originUnavailable) {
    req.socket.destroy();
    return;
  }
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith(scope)) {
      res.writeHead(404).end();
      return;
    }
    const relative = path.slice(scope.length) || "index.html",
      file = resolve(dist, relative);
    if (!file.startsWith(dist + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (failInstall && relative === "vnext-journey.css") {
      res.writeHead(503).end();
      return;
    }
    let body = await readFile(file, "utf8");
    if (legacyRelease && relative === "sw.js") body = legacyWorker;
    if (legacyRelease && relative === "index.html")
      body =
        '<!doctype html><html lang="ja"><title>Legacy app</title><body>Legacy app without update controls</body></html>';
    body = body.replaceAll(
      oldVersion,
      legacyRelease ? legacyVersion : versions[release],
    );
    body = body.replaceAll(
      "https://my-map-capture.at5tram98.workers.dev",
      apiBase,
    );
    if (["js/journey-core.js", "js/network.js"].includes(relative))
      body += `\nexport const releaseMarker='${legacyRelease ? legacyVersion : versions[release]}';\n`;
    const compressed = gzipSync(body);
    res
      .writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Encoding": "gzip",
        "Content-Length": compressed.length,
      })
      .end(compressed);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}${scope}`;
allowedOrigins.add(new URL(base).origin);
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
const context = await browser.newContext({
    serviceWorkers: "allow",
    viewport: { width: 320, height: 740 },
  }),
  errors = [];
await context.addInitScript(() => {
  Object.defineProperty(navigator, "geolocation", {
    value: {
      watchPosition(success, error) {
        setTimeout(() => error({ code: 1 }), 0);
        return 1;
      },
      clearWatch() {},
    },
  });
});
const page = await context.newPage();
function recordRuntimeError(e) {
  errors.push(e.message);
}
context.on("weberror", (event) =>
  recordRuntimeError(event.error(), event.page()),
);
await page.clock.install({ time: new Date("2026-10-11T01:05:00Z") });
async function controlled(page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}
async function installed(page) {
  await page.waitForFunction(() =>
    navigator.serviceWorker.getRegistration().then((r) => r?.waiting),
  );
}
async function marker(page, version, file = "journey-core.js") {
  return page.evaluate(
    async ({ version, file }) =>
      (await import(new URL(`js/${file}?v=${version}`, location.href).href))
        .releaseMarker,
    { version, file },
  );
}
try {
  await page.goto(base);
  await page.locator('[data-view="now"] [data-home-submit]').waitFor();
  await controlled(page);
  assert.equal(await marker(page, oldVersion), oldVersion);
  await page.evaluate(async () => {
    const search = new URL(document.querySelector("script[type=module]").src)
      .search;
    const m = await import(
      new URL(`js/vnext-state.js${search}`, location.href)
    );
    const v = await import(new URL(`js/vnext-view.js${search}`, location.href));
    m.state.ride = {
      operator: "subway",
      from: "K07",
      to: "K01",
      depart: 605,
      arrive: 622,
      serviceDate: "2026-10-11",
      destination: "国際会館",
      officialStops: [
        { id: "K07", name: "丸太町", time: 605 },
        { id: "K01", name: "国際会館", time: 622 },
      ],
    };
    m.state.rideStartedAt = Date.now();
    m.state.foldbackPlan = {
      rideKey: m.rideKey(m.state.ride),
      stopId: "K01",
      depart: 630,
      direction: "south",
      date: "2026-10-11",
      buffer: 3,
      destination: "竹田",
      tripId: "favorite",
    };
    m.persistJourney(true);
    v.renderNow();
  });
  await page.locator('[data-navigation-screen="trains"]').click();
  await page.locator(".live-track").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell").dataset.navigationBusy === "false",
  );
  await page.locator("[data-navigation-back]").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell").dataset.navigationBusy === "false",
  );
  const other = await context.newPage();
  await other.clock.install({ time: new Date("2026-10-11T01:05:00Z") });
  await other.goto(base);
  await controlled(other);
  const existingDocument = await page
    .locator("script[type=module]")
    .getAttribute("src");
  release = 1;
  await page.evaluate(() =>
    navigator.serviceWorker.getRegistration().then((r) => r.update()),
  );
  await installed(page);
  await page.locator("#app-update:not([hidden])").waitFor();
  assert.equal(
    await page.locator("script[type=module]").getAttribute("src"),
    existingDocument,
  );
  assert.equal(await marker(other, oldVersion), oldVersion);
  // Reload before choosing the update keeps the old complete shell.
  await other.reload();
  assert.match(
    await other.locator("script[type=module]").getAttribute("src"),
    new RegExp(oldVersion),
  );
  await page.screenshot({
    path: "/tmp/my-map-pwa-update.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.locator("[data-apply-update]").click();
  await page.waitForFunction(
    (v) => document.querySelector("script[type=module]")?.src.includes(v),
    versions[1],
  );
  await page.locator(".journey-display").waitFor();
  await page.locator(".foldback-plan").waitFor();
  assert.equal(await marker(page, versions[1]), versions[1]);
  // An open old client must still import its own cached modules after activation.
  const oldModule = await other.evaluate(
    async ({ base, oldVersion }) =>
      (await import(`${base}js/journey-session.js?v=${oldVersion}`))
        .JOURNEY_KEY,
    { base, oldVersion },
  );
  assert.equal(oldModule, "mymap-active-journey-v1");
  // Simulate the same real connection failure in Chromium and WebKit;
  // protocol offline emulation can prevent WebKit's cached SW responses.
  originUnavailable = true;
  assert.equal(
    await page.evaluate(async (base) => {
      try {
        await fetch(`${base}__network-check`, { cache: "no-store" });
        return true;
      } catch {
        return false;
      }
    }, base),
    false,
    "The origin must be unreachable during the offline checks",
  );
  await page.reload();
  await page
    .locator(".journey-display")
    .waitFor()
    .catch(async (error) => {
      const diagnostic = await page.evaluate(() => ({
        url: location.href,
        time: new Date().toISOString(),
        body: document.body.innerText,
        script: document.querySelector("script[type=module]")?.src,
        history: history.state?.mymapNavigation,
        journey: localStorage.getItem("mymap-active-journey-v1"),
      }));
      await page.screenshot({ path: "/tmp/mymap-pwa-offline-failure.png" });
      throw Error(`${error.message}; ${JSON.stringify(diagnostic)}`);
    });
  await page.locator(".foldback-plan").waitFor();
  assert.match(
    await page.locator("script[type=module]").getAttribute("src"),
    new RegExp(versions[1]),
  );
  assert.equal(await marker(page, versions[1]), versions[1]);
  const unavailableVersion = async () =>
    page.evaluate(async (base) => {
      try {
        const response = await fetch(
          `${base}js/journey-core.js?v=dddddddddddd`,
        );
        return {
          status: response.status,
          ok: response.ok,
          body: await response.text(),
        };
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        return { networkError: true };
      }
    }, base);
  const wrong = await unavailableVersion();
  // WebKit may reject a fetch when the origin is unavailable. Both outcomes
  // must reject the expired release, and the cached app must remain usable.
  assert.deepEqual(
    wrong,
    wrong.networkError
      ? { networkError: true }
      : { status: 410, ok: false, body: "This app version is unavailable" },
    "Offline requests must never receive a different release's module",
  );
  const cachedStyle = await page.evaluate(
    async ({ base, version }) => {
      const response = await fetch(
        `${base}vnext.css?v=${version}&offline-probe=after-rejection`,
        { cache: "no-store" },
      );
      return { status: response.status, body: await response.text() };
    },
    { base, version: versions[1] },
  );
  assert.equal(cachedStyle.status, 200);
  assert.equal(
    cachedStyle.body,
    await readFile(resolve(dist, "vnext.css"), "utf8"),
    "The active worker must still serve cached assets after rejecting an expired release",
  );
  originUnavailable = false;
  assert.deepEqual(
    await unavailableVersion(),
    { status: 410, ok: false, body: "This app version is unavailable" },
    "Unavailable version must be explicitly rejected without receiving another release",
  );
  release = 2;
  failInstall = true;
  await page.evaluate(() =>
    navigator.serviceWorker.ready.then((r) => r.update().catch(() => {})),
  );
  await page.waitForFunction(() =>
    navigator.serviceWorker.ready.then((r) => !r.installing && !r.waiting),
  );
  await page.reload();
  await page.locator(".journey-display").waitFor();
  assert.match(
    await page.locator("script[type=module]").getAttribute("src"),
    new RegExp(versions[1]),
  );
  // Exercise the actual previously published worker, whose page cannot send
  // ACTIVATE_UPDATE. Its versioned registration must migrate without leaving
  // a waiting worker or serving its old module cache to the new document.
  release = 0;
  failInstall = false;
  legacyRelease = true;
  // Use a fresh origin so the earlier update scenario cannot supply this
  // scenario's cache before its own migration has completed.
  await context.close();
  const legacyServer = createServer(server.listeners("request")[0]);
  await new Promise((r) => legacyServer.listen(0, "127.0.0.1", r));
  const legacyBase = `http://127.0.0.1:${legacyServer.address().port}${scope}`;
  allowedOrigins.add(new URL(legacyBase).origin);
  const legacyContext = await browser.newContext({ serviceWorkers: "allow" });
  legacyContext.on("weberror", (event) =>
    recordRuntimeError(event.error(), event.page()),
  );
  try {
    const legacyPage = await legacyContext.newPage();
    await legacyPage.goto(legacyBase);
    await legacyPage.evaluate(async (version) => {
      await navigator.serviceWorker.register(`sw.js?v=${version}`, {
        scope: "./",
      });
      await navigator.serviceWorker.ready;
    }, legacyVersion);
    await controlled(legacyPage);
    await legacyPage.waitForFunction(() =>
      navigator.serviceWorker
        .getRegistration()
        .then((r) => r?.active?.state === "activated" && !r.installing),
    );
    assert.equal(
      await marker(legacyPage, legacyVersion, "network.js"),
      legacyVersion,
    );
    legacyRelease = false;
    await legacyPage.evaluate(() => {
      window.__legacyClaimed = false;
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          window.__legacyClaimed = true;
        },
        { once: true },
      );
      return navigator.serviceWorker.getRegistration().then((r) => r.update());
    });
    await legacyPage.waitForFunction(async (version) => {
      const registration = await navigator.serviceWorker.getRegistration();
      return (
        !registration.installing &&
        !registration.waiting &&
        registration.active?.state === "activated" &&
        navigator.serviceWorker.controller &&
        window.__legacyClaimed &&
        (await caches.has(`mymap-static-${version}`))
      );
    }, oldVersion);
    // A cache entry alone is insufficient: wait for the new worker to claim
    // the legacy page, then verify a fresh document and its modules together.
    await legacyPage.waitForFunction(async (version) => {
      const channel = new MessageChannel();
      const reported = new Promise((resolve) => {
        const timeout = setTimeout(() => {
          channel.port1.close();
          resolve(null);
        }, 200);
        channel.port1.onmessage = (event) => {
          clearTimeout(timeout);
          channel.port1.close();
          resolve(event.data?.version);
        };
      });
      navigator.serviceWorker.controller.postMessage({ type: "GET_VERSION" }, [
        channel.port2,
      ]);
      if ((await reported) !== version) return false;
      const response = await fetch(`js/network.js?v=${version}`);
      return (await response.text()).includes(`releaseMarker='${version}'`);
    }, oldVersion);
    await legacyPage.reload();
    assert.match(
      await legacyPage.locator('script[type="module"]').getAttribute("src"),
      new RegExp(oldVersion),
    );
    assert.equal(await marker(legacyPage, oldVersion), oldVersion);
    assert.equal(
      await marker(legacyPage, oldVersion, "network.js"),
      oldVersion,
    );
    const responseUrls = await legacyPage.evaluate(async (version) => {
      const requested = new URL(`js/network.js?v=${version}`, location.href)
        .href;
      return { requested, response: (await fetch(requested)).url };
    }, oldVersion);
    assert.equal(
      responseUrls.response,
      responseUrls.requested,
      "Cached module responses must preserve the requested build URL",
    );
    assert.equal(
      await legacyPage.evaluate(() =>
        navigator.serviceWorker
          .getRegistration()
          .then((r) => Boolean(r.waiting)),
      ),
      false,
    );
  } finally {
    legacyRelease = false;
    await legacyContext.close();
    await new Promise((r) => legacyServer.close(r));
  }
  assert.deepEqual(errors, []);
  assert.ok(
    apiRequests.some((request) => request.path === "/api/static/feed"),
    "Provider requests must reach the real cross-origin HTTP fixture",
  );
  assert.ok(
    apiRequests.every((request) => allowedOrigins.has(request.origin)),
    "Every provider request must use a verified app origin",
  );
  const result = {
    browser: engine.name(),
    scope,
    checks: [
      "First installation and control",
      "Waiting update keeps active journey",
      "Old shell remains consistent on pre-update reload",
      "User update restores ride and favorite",
      "Old open client retains its module cache",
      "Offline reload resumes the new journey",
      "Unknown versions never fall back to different code",
      "Failed precache leaves current release usable",
      "Previously published worker migrates without an update button or mixed modules",
    ],
    errors,
    apiRequests: apiRequests.length,
  };
  const artifacts = resolve(
    process.env.BROWSER_ARTIFACT_DIR ?? "/tmp/my-map-browser",
  );
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    resolve(artifacts, "pwa-report.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    `::error title=PWA HTTP fixture::${JSON.stringify(apiRequests.slice(-12))}`,
  );
  const message = error?.stack ?? String(error);
  console.error(
    `::error title=${engine.name()} PWA verification::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`,
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
  await new Promise((r) => apiServer.close(r));
}
