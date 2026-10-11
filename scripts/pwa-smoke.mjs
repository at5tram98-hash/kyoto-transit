// Verify real release transitions under the GitHub Pages subpath.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { existsSync } from "node:fs";
import { chromium, webkit } from "playwright";
const dist = resolve("dist"),
  scope = "/kyoto-transit/";
const html = await readFile(resolve(dist, "index.html"), "utf8"),
  oldVersion = html.match(/vnext\.js\?v=([a-f0-9]+)/)[1];
const versions = [oldVersion, "bbbbbbbbbbbb", "cccccccccccc"],
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
  originUnavailable = false;
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
    body = body.replaceAll(oldVersion, versions[release]);
    if (relative === "js/journey-core.js")
      body += `\nexport const releaseMarker='${versions[release]}';\n`;
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
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}${scope}`;
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
await context.route(
  "https://my-map-capture.at5tram98.workers.dev/**",
  (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Offline provider fixture" }),
    }),
);
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
page.on("pageerror", (e) => errors.push(e.message));
await page.clock.install({ time: new Date("2026-10-11T01:05:00Z") });
async function controlled(page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}
async function installed(page) {
  await page.waitForFunction(() =>
    navigator.serviceWorker.getRegistration().then((r) => r?.waiting),
  );
}
async function marker(page, version) {
  return page.evaluate(
    async ({ base, version }) =>
      (await import(`${base}js/journey-core.js?v=${version}`)).releaseMarker,
    { base, version },
  );
}
try {
  await page.goto(base);
  await page.locator(".hero-card").waitFor();
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
  const other = await context.newPage();
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
  await page.locator(".journey-display").waitFor();
  await page.locator(".foldback-plan").waitFor();
  assert.match(
    await page.locator("script[type=module]").getAttribute("src"),
    new RegExp(versions[1]),
  );
  assert.equal(await marker(page, versions[1]), versions[1]);
  const wrong = await page.evaluate(async (base) => {
    try {
      await fetch(`${base}js/journey-core.js?v=dddddddddddd`);
      return true;
    } catch {
      return false;
    }
  }, base);
  assert.equal(
    wrong,
    false,
    "Unavailable version must not receive another release",
  );
  originUnavailable = false;
  release = 2;
  failInstall = true;
  await page.evaluate(() =>
    navigator.serviceWorker
      .getRegistration()
      .then((r) => r.update().catch(() => {})),
  );
  await page.waitForFunction(() =>
    navigator.serviceWorker
      .getRegistration()
      .then((r) => !r.installing && !r.waiting),
  );
  await page.reload();
  await page.locator(".journey-display").waitFor();
  assert.match(
    await page.locator("script[type=module]").getAttribute("src"),
    new RegExp(versions[1]),
  );
  assert.deepEqual(errors, []);
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
    ],
    errors,
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
  const message = error?.stack ?? String(error);
  console.error(
    `::error title=${engine.name()} PWA verification::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`,
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
