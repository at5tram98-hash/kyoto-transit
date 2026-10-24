import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const engineName = process.env.BROWSER_ENGINE ?? "chromium";
const browser = await (engineName === "webkit" ? webkit : chromium).launch({
  headless: true,
});
const dir = resolve(
  process.env.PRODUCTION_BROWSER_DIR ?? "production-artifacts/browser",
);
await mkdir(dir, { recursive: true });
const report = {
  browser: engineName,
  url: process.env.APP_URL ?? "https://at5tram98-hash.github.io/kyoto-transit/",
  at: new Date().toISOString(),
  checks: [],
  errors: [],
  versions: [],
};
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "allow",
});
const page = await context.newPage();
page.on("pageerror", (error) => report.errors.push(error.message));
const idle = () =>
  page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.navigationBusy === "false",
  );
const version = () =>
  page
    .locator('script[src*="vnext.js"]')
    .getAttribute("src")
    .then((src) => new URL(src, page.url()).searchParams.get("v"));
const shot = async (name) => {
  await idle();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    name + " horizontal overflow",
  );
  await page.screenshot({ path: resolve(dir, name + ".png") });
};
const tab = async (name) => {
  await idle();
  await page.locator(`[data-tab="${name}"]`).click();
  await idle();
};
try {
  await page.goto(report.url, { waitUntil: "domcontentloaded" });
  await page.locator(".now-status").waitFor({ timeout: 60000 });
  report.versions.push(await version());
  await shot("01-live");
  await tab("search");
  for (const [field, name, id] of [
    ["from", "丸太町", "K07"],
    ["to", "国際会館", "K01"],
  ]) {
    await page.locator(`[name="${field}"]`).click();
    await page.locator("[data-suggestion-input]").fill(name);
    await page.locator(`#planner-suggestions [data-stop-id="${id}"]`).click();
    await idle();
  }
  await page.locator("#planner-form .planner-submit").click();
  await page
    .locator(".navigation-current [data-open-route]")
    .first()
    .waitFor({ timeout: 120000 });
  await shot("02-real-results");
  await page.locator(".navigation-current [data-open-route]").first().click();
  await idle();
  await shot("03-real-journey");
  await page.locator(".navigation-current [data-arm-route]").first().click();
  await idle();
  await page.locator(".armed-journey").waitFor();
  const originalPlan = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mymap-itinerary-v1")),
  );
  assert.ok(originalPlan);
  const tripIds = JSON.stringify(
    originalPlan.rides
      .filter(Boolean)
      .map((r) => [r.serviceDate, r.serviceId, r.tripId]),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".armed-journey").waitFor({ timeout: 60000 });
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(
        JSON.parse(localStorage.getItem("mymap-itinerary-v1"))
          .rides.filter(Boolean)
          .map((r) => [r.serviceDate, r.serviceId, r.tripId]),
      ),
    ),
    tripIds,
  );
  await shot("04-armed-reload");
  report.checks.push(
    "Real HTTPS current-day official route search, journey detail, guidance preparation and reload retain exact service date/trip IDs; no timetable, clock, API or sensor fixtures",
  );
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".armed-journey").waitFor({ timeout: 60000 });
  assert.ok(
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  );
  if (process.env.PRODUCTION_UPGRADE_SIGNAL) {
    await writeFile(
      resolve(dir, "upgrade-ready.json"),
      JSON.stringify(
        { version: await version(), tripIds, at: new Date().toISOString() },
        null,
        2,
      ),
    );
    let release = null;
    const deadline = Date.now() + 45 * 60 * 1000;
    while (Date.now() < deadline) {
      try {
        release = JSON.parse(
          await readFile(process.env.PRODUCTION_UPGRADE_SIGNAL, "utf8"),
        );
        break;
      } catch {}
      await new Promise((r) => setTimeout(r, 2000));
    }
    assert.ok(release?.version, "release signal before timeout");
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });
    await page
      .locator("#app-update:not([hidden])")
      .waitFor({ timeout: 120000 });
    await page.locator("#app-update [data-apply-update]").click();
    await page.waitForFunction(
      (expected) =>
        new URL(
          document.querySelector('script[src*="vnext.js"]').src,
        ).searchParams.get("v") === expected,
      release.version,
      { timeout: 120000 },
    );
    await page.locator(".armed-journey").waitFor({ timeout: 60000 });
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(
          JSON.parse(localStorage.getItem("mymap-itinerary-v1"))
            .rides.filter(Boolean)
            .map((r) => [r.serviceDate, r.serviceId, r.tripId]),
        ),
      ),
      tripIds,
    );
    report.versions.push(await version());
    await shot("05-published-pwa-upgraded");
    report.checks.push(
      "Actual previous published Service Worker upgraded through the app update control and retained the selected journey/trip IDs",
    );
  }
  if (process.env.EXPECTED_BUILD_VERSION)
    assert.equal(await version(), process.env.EXPECTED_BUILD_VERSION);
  await tab("timetable");
  await page.locator("#timetable-search").fill("丸太町");
  await page.locator('[data-timetable-stop="K07"]').click();
  await idle();
  await page
    .locator(".hour-table,.timetable-row,.timetable-list")
    .first()
    .waitFor({ timeout: 60000 });
  await shot("06-timetable");
  await tab("operations");
  await page
    .locator(".navigation-current .operations-head")
    .first()
    .waitFor({ timeout: 60000 });
  await shot("07-operations");
  await tab("settings");
  await page.locator('[data-setting-page="display"]').click();
  await idle();
  await page.locator('[data-setting-value="clockFormat"]').selectOption("12");
  await page.locator('[data-setting-value="fontScale"]').selectOption("2");
  await shot("08-large-text-settings");
  report.checks.push(
    "Production timetable, operations and 200% text settings through visible controls",
  );
  const before = await version();
  // WebKit's protocol offline switch rejects even SW-cached HTTPS responses.
  // Its actual unreachable-origin coverage lives in pwa-smoke (stopped server).
  // Keep this live HTTPS probe explicit rather than claiming a physical test.
  if (engineName === "webkit") {
    report.limitations = [
      "Live HTTPS protocol-offline emulation is unsupported by WebKit; unreachable-origin reload is covered by the separate WebKit PWA suite. Physical iPhone offline remains unverified.",
    ];
  } else {
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .locator('[data-setting-value="clockFormat"]')
      .waitFor({ timeout: 60000 });
    assert.equal(
      await page.locator('[data-setting-value="clockFormat"]').inputValue(),
      "12",
    );
    assert.equal(await version(), before);
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    await shot("09-offline-reload");
    await context.setOffline(false);
    report.checks.push(
      "Real production offline Service Worker reload preserves display settings and release version",
    );
  }
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.errors.push(error.stack);
  await page.screenshot({ path: resolve(dir, "failure.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(
    resolve(dir, "production-browser-report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
