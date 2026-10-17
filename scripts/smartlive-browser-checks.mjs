import assert from "node:assert/strict";
import { resolve } from "node:path";

export async function smartLiveChecks({
  open,
  setRide,
  layout,
  artifacts,
  summary,
}) {
  for (const width of [390, 430])
    for (const scale of [1, 1.5, 2]) {
      const run = await open({
        width,
        colorScheme: scale === 1 ? "light" : "dark",
        reducedMotion: scale === 2 ? "reduce" : "no-preference",
        time: "2026-10-17T01:00:00Z",
        scenario: {
          gps: "denied",
          standalone: width === 430,
          initialSettings: { fontScale: scale, autoDetect: false },
        },
      });
      try {
        const { page } = run;
        await setRide(page, "subway");
        await page.evaluate(async (scale) => {
          const query = new URL(
            document.querySelector("script[type=module]").src,
          ).search;
          const module = (name) =>
            import(new URL(`js/${name}.js${query}`, location.href).href);
          window.__session = (
            await module("ride-detection-session")
          ).rideDetectionSession;
          window.__evidence = (
            await module("transit-evidence")
          ).transitEvidenceEngine;
          window.__detect = await module("vnext-detect");
          const { state, settings, tokyoNow } = window.__state;
          settings.autoDetect = false;
          document.documentElement.style.fontSize = `${scale * 100}%`;
          state.ride.serviceDate = tokyoNow().date;
          state.ride.serviceId = "smartlive-south";
          state.ride.tripId = "S1";
          state.ride.depart = 597;
          state.ride.arrive = 612;
          state.ride.userDestination = { id: "K11", name: "京都" };
          state.itinerary = {
            version: 1,
            id: "fixture-journey",
            phase: "riding",
            legIndex: 0,
            savedAt: Date.now(),
            input: { from: "K07", to: "K11" },
            route: {
              date: tokyoNow().date,
              legs: [{ ...state.ride, kind: "ride" }],
            },
            rides: [state.ride],
          };
          window.__journeyId = state.itinerary.id;
          window.__view.renderNow();
        }, scale);
        await page.locator("[data-correct-ride]").click();
        await page.locator("[data-rechecking-shell]").waitFor();
        assert.equal(await page.locator("#now-search").isVisible(), false);
        assert.equal(
          await page.evaluate(() => window.__state.state.itinerary.id),
          "fixture-journey",
        );
        assert.equal(
          await page
            .locator("[data-rechecking-shell]")
            .textContent()
            .then((t) => /京都行き/.test(t)),
          false,
          "suspect destination is not asserted in the shell",
        );
        await layout(page, `rechecking-${width}-${scale}`);
        await page.screenshot({
          path: resolve(artifacts, `rechecking-${width}-${scale}.png`),
        });
        await page.reload();
        await page.locator("[data-rechecking-shell]").waitFor();
        await page.evaluate(async () => {
          const query = new URL(
            document.querySelector("script[type=module]").src,
          ).search;
          window.__state = await import(
            new URL(`js/vnext-state.js${query}`, location.href).href
          );
          window.__view = await import(
            new URL(`js/vnext-view.js${query}`, location.href).href
          );
          window.__session = (
            await import(
              new URL(`js/ride-detection-session.js${query}`, location.href)
                .href
            )
          ).rideDetectionSession;
          window.__evidence = (
            await import(
              new URL(`js/transit-evidence.js${query}`, location.href).href
            )
          ).transitEvidenceEngine;
          window.__detect = await import(
            new URL(`js/vnext-detect.js${query}`, location.href).href
          );
          const { state, settings } = window.__state;
          settings.autoDetect = false;
          const previous = window.__session.snapshot().shell;
          window.__correctedRide = {
            ...previous,
            serviceId: "smartlive-north",
            tripId: "N1",
            direction: "north",
            destination: "鞍馬口",
            from: "K07",
            to: "K05",
            officialStops: [
              { id: "K07", name: "丸太町", time: 597 },
              { id: "K06", name: "今出川", time: 603 },
              { id: "K05", name: "鞍馬口", time: 607 },
            ],
          };
          state.fix = null;
          state.samples = [];
          state.armedJourney = null;
          state.rideCandidates = [
            { ride: previous, score: 55, source: "fixture" },
            { ride: window.__correctedRide, score: 80, source: "fixture" },
          ];
          const at = Date.now();
          window.__evidence.ingest({
            candidate: previous,
            type: "gps",
            confidence: 1,
            observedAt: at,
            metadata: { rejected: true },
          });
          for (const type of ["audio", "motion", "realtime", "timetable"])
            window.__evidence.ingest({
              candidate: window.__correctedRide,
              type,
              confidence: 0.95,
              observedAt: at,
              metadata: {
                directionVerified: ["audio", "realtime"].includes(type),
              },
            });
          settings.autoDetect = true;
          await window.__detect.autoDetectRide(true, window.__view.renderNow);
          settings.autoDetect = false;
        });
        await page.waitForFunction(
          () => window.__state?.state?.ride?.tripId === "N1",
        );
        assert.equal(await page.locator("[data-rechecking-shell]").count(), 0);
        assert.equal(
          await page.evaluate(() => window.__state.state.ride.tripId),
          "N1",
        );
        assert.equal(
          await page.evaluate(() => window.__state.state.itinerary.id),
          "fixture-journey",
        );
        assert.equal(
          await page.evaluate(() => window.__state.state.itinerary.phase),
          "riding",
        );
        assert.match(await page.locator("#toast").textContent(), /更新/);
        assert.equal(
          await page.evaluate(() => window.__session.snapshot().phase),
          "riding",
        );
        await layout(page, `corrected-${width}-${scale}`);
        await page.screenshot({
          path: resolve(artifacts, `corrected-${width}-${scale}.png`),
        });
        await page.locator("[data-correct-ride]").click();
        await page.locator("[data-rechecking-shell]").waitFor();
        await page.locator("[data-not-riding]").click();
        assert.equal(
          await page.evaluate(() => window.__state.state.ride),
          null,
        );
        assert.equal(
          await page.evaluate(() => window.__state.state.itinerary.id),
          "fixture-journey",
        );
        assert.equal(
          await page.evaluate(() => window.__state.state.itinerary.legIndex),
          0,
        );
        assert.equal(
          await page.evaluate(() => window.__session.snapshot().mode),
          "none",
        );
        assert.deepEqual(run.errors, []);
      } finally {
        await run.context.close();
      }
    }
  summary.checks.push(
    "SmartLive rechecking shell and correction: 390/430px, 100/150/200%, dark and reduced motion, PWA-equivalent reload keeps an unconfirmed shell, GPS-free audio+motion+realtime correction changes only Ride, retains Journey, and announces completion",
  );
}
