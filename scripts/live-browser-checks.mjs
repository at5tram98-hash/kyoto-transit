import assert from "node:assert/strict";
import { resolve } from "node:path";

export async function liveInteractionChecks({
  open,
  layout,
  settleNavigation,
  artifacts,
  summary,
}) {
  async function openFullNearbyMap(page) {
    await page.evaluate(() => {
      window.__state.state.locationStatus = "active";
      window.__state.state.fix = {
        lat: 35.0116,
        lng: 135.7681,
        accuracy: 10,
        timestamp: Date.now(),
        speed: 0,
        heading: null,
      };
      window.__view.renderNow();
    });
    const rootMap = page.locator(
      ".live-map-host .route-map.map-interactive .map-canvas",
    );
    await rootMap.waitFor();
    await page.locator("[data-live-full-map]").click();
    const map = page.locator(
      ".navigation-current .route-map.map-interactive .map-canvas",
    );
    await map.waitFor();
    await settleNavigation(page);
    return map;
  }
  async function firstStopPositions(page) {
    return page.evaluate(() =>
      [...document.querySelectorAll(".navigation-current .route-map .map-stop")]
        .sort((a, b) =>
          a
            .closest("[data-map-stop]")
            .dataset.mapStop.localeCompare(
              b.closest("[data-map-stop]").dataset.mapStop,
            ),
        )
        .slice(0, 2)
        .map((node) => ({
          id: node.closest("[data-map-stop]").dataset.mapStop,
          x: Number(node.getAttribute("cx")) - node.closest("svg").viewBox.baseVal.width / 2,
          y: Number(node.getAttribute("cy")) - node.closest("svg").viewBox.baseVal.height / 2,
        })),
    );
  }
  async function panMap(page, dx, dy) {
    await page.evaluate(
      ({ dx, dy }) => {
        const canvas = document.querySelector(
          ".navigation-current .route-map.map-interactive .map-canvas",
        );
        const rect = canvas.getBoundingClientRect(),
          x = rect.left + rect.width / 2,
          y = rect.top + rect.height / 2,
          pointerId = 71;
        canvas.setPointerCapture = () => {};
        const fire = (type, clientX, clientY, buttons) =>
          canvas.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId,
              pointerType: "touch",
              isPrimary: true,
              button: 0,
              buttons,
              clientX,
              clientY,
            }),
          );
        fire("pointerdown", x, y, 1);
        fire("pointermove", x + dx, y + dy, 1);
        fire("pointerup", x + dx, y + dy, 0);
      },
      { dx, dy },
    );
  }
  // A first fix obtained on the full map must also center the home preview
  // when returning. The two maps share data, but own independent viewports.
  {
    const lateFix = await open({
      scenario: { gps: "denied", initialSettings: { autoDetect: false } },
    });
    try {
      const { page } = lateFix;
      await page.locator("[data-live-full-map]").click();
      await page.locator(".navigation-current .map-canvas").waitFor();
      await page.evaluate(() => {
        window.__state.state.locationStatus = "active";
        window.__state.state.fix = {
          lat: 35.0697,
          lng: 135.7572,
          accuracy: 15,
          timestamp: Date.now(),
          speed: 0,
        };
        window.__view.renderNow();
      });
      await page.locator(".navigation-current .map-position").waitFor();
      await page.evaluate(() => window.__navigation.navigation.pop());
      await settleNavigation(page);
      await page.locator(".live-map-host .map-position").waitFor();
      const marker = await page
        .locator(".live-map-host .map-position")
        .evaluate((el) => ({
          x: +el.getAttribute("cx"),
          y: +el.getAttribute("cy"),
          height: el.closest("svg").viewBox.baseVal.height,
        }));
      if (!(Math.abs(marker.x - 210) < 1 && Math.abs(marker.y - marker.height / 2) < 1)) console.log("First location map geometry", marker);
      assert.ok(
        Math.abs(marker.x - 210) < 1 &&
          Math.abs(marker.y - marker.height / 2) < 1,
        "first GPS fix centers each map independently",
      );
    } finally {
      await lateFix.context.close();
    }
  }
  const distance = ([a, b]) => Math.hypot(a.x - b.x, a.y - b.y);

  {
    const zoom = await open({
      width: 390,
      time: "2026-10-17T01:00:00Z",
      scenario: { gps: "active", initialSettings: { autoDetect: false } },
    });
    try {
      const page = zoom.page;
      await openFullNearbyMap(page);
      const before = await firstStopPositions(page);
      assert.equal(before.length, 2, "nearby full map renders multiple stops");
      await page.locator('[data-map-zoom="1"]').click();
      const after = await firstStopPositions(page);
      assert.ok(
        distance(after) > distance(before) * 1.2,
        "map zoom increases the rendered spacing between stops",
      );
      await layout(page, "live-map-zoom");
      await page.screenshot({ path: resolve(artifacts, "live-map-zoom.png") });
      assert.deepEqual(zoom.errors, []);
    } finally {
      await zoom.context.close();
    }
  }

  {
    const pan = await open({
      width: 390,
      time: "2026-10-17T01:00:00Z",
      scenario: { gps: "active", initialSettings: { autoDetect: false } },
    });
    try {
      const page = pan.page;
      await openFullNearbyMap(page);
      const before = await firstStopPositions(page);
      await panMap(page, 70, 45);
      const after = await firstStopPositions(page);
      assert.ok(
        Math.abs(after[0].x - before[0].x) > 1 ||
          Math.abs(after[0].y - before[0].y) > 1,
        "map pan moves the rendered viewport",
      );
      await layout(page, "live-map-pan");
      await page.screenshot({ path: resolve(artifacts, "live-map-pan.png") });
      assert.deepEqual(pan.errors, []);
    } finally {
      await pan.context.close();
    }
  }

  {
    const tracking = await open({
      width: 390,
      time: "2026-10-17T01:00:00Z",
      scenario: { gps: "active", initialSettings: { autoDetect: false } },
    });
    try {
      const page = tracking.page;
      await openFullNearbyMap(page);
      await panMap(page, 55, 30);
      const before = await firstStopPositions(page);
      const markerBefore = await page
        .locator(".navigation-current .map-position")
        .evaluate((el) => ({
          x: +el.getAttribute("cx"),
          y: +el.getAttribute("cy"),
        }));
      await page.evaluate(() => window.__emitPosition(35.012, 135.7685));
      await page.waitForFunction(
        () => window.__state.state.nearbyMap?.position?.lat === 35.012,
      );
      await page.waitForFunction((before) => {
        const marker = document.querySelector(
          ".navigation-current .map-position",
        );
        return (
          marker &&
          Math.hypot(
            +marker.getAttribute("cx") - before.x,
            +marker.getAttribute("cy") - before.y,
          ) > 0.1
        );
      }, markerBefore);

      const after = await firstStopPositions(page);
      if (Math.abs(after[0].x-before[0].x) >= .01 || Math.abs(after[0].y-before[0].y) >= .01) console.log("Map viewport after GPS",{before,after});
      assert.ok(
        Math.abs(after[0].x - before[0].x) < 0.01 &&
          Math.abs(after[0].y - before[0].y) < 0.01,
        "quick location update preserves the manually panned viewport",
      );
      assert.equal(
        await page
          .locator(".navigation-current .route-map .map-position")
          .count(),
        1,
        "location refresh keeps the current-position marker",
      );
      await layout(page, "live-map-tracking");
      await page.screenshot({
        path: resolve(artifacts, "live-map-tracking.png"),
      });
      assert.deepEqual(tracking.errors, []);
    } finally {
      await tracking.context.close();
    }
  }

  {
    const denied = await open({
      width: 390,
      time: "2026-10-17T01:00:00Z",
      scenario: { gps: "denied", initialSettings: { autoDetect: false } },
    });
    try {
      const page = denied.page;
      await page.locator(".live-map-host .route-map .map-canvas").waitFor();
      assert.equal(
        await page.locator(".live-map-host .route-map .map-position").count(),
        0,
        "denied location never draws a fabricated current-position marker",
      );
      assert.deepEqual(denied.errors, []);
    } finally {
      await denied.context.close();
    }
  }

  {
    const audio = await open({
      width: 390,
      time: "2026-10-17T01:00:00Z",
      scenario: { gps: "denied", initialSettings: { autoDetect: false } },
    });
    try {
      const page = audio.page;
      await page.evaluate(() => {
        window.__microphoneState = "prompt";
        window.__speechStarts = 0;
        window.__speechStops = 0;
        Object.defineProperty(navigator, "permissions", {
          configurable: true,
          value: { query: async () => ({ state: window.__microphoneState }) },
        });
        class Recognition {
          start() {
            window.__speechStarts++;
          }
          abort() {
            window.__speechStops++;
            this.onend?.();
          }
        }
        window.SpeechRecognition = Recognition;
        window.__state.settings.autoDetect = true;
        window.__state.state.detectBusy = true;
        window.__state.state.rideCandidates = [
          {
            score: 65,
            ride: {
              operator: "subway",
              from: "K07",
              to: "K08",
              depart: 600,
              destination: "烏丸御池",
              officialStops: [
                { id: "K07", name: "丸太町", time: 600 },
                { id: "K08", name: "烏丸御池", time: 603 },
              ],
            },
          },
        ];
        document
          .querySelector("#vehicle-panel")
          .append(document.createElement("span"));
      });
      // The microphone is used only while the GPS fix is poor (mic-policy).
      const fix = (accuracy) =>
        page.evaluate((accuracy) => {
          const { state } = window.__state;
          state.locationStatus = "active";
          state.fix = { lat: 35.0168, lng: 135.7594, accuracy, timestamp: Date.now(), speed: null, heading: null };
        }, accuracy);
      await page.clock.fastForward(4100);
      assert.equal(
        await page.evaluate(() => window.__speechStarts),
        0,
        "no location (denied): automatic speech never starts",
      );
      await page.evaluate(() => {
        window.__microphoneState = "granted";
      });
      await fix(12);
      await page.clock.fastForward(4100);
      assert.equal(
        await page.evaluate(() => window.__speechStarts),
        0,
        "a good GPS fix never starts the microphone, even when granted",
      );
      await fix(180);
      await page.clock.fastForward(4100);
      await page.waitForFunction(() => window.__speechStarts === 1);
      await fix(180);
      await page.clock.fastForward(60300);
      assert.equal(
        await page.evaluate(() => window.__speechStops),
        1,
        "recognition stops at the 60 second session limit",
      );
      await fix(180);
      await page.clock.fastForward(4100);
      await page.waitForFunction(() => window.__speechStarts === 2);
      await fix(12);
      await page.clock.fastForward(4100);
      assert.equal(
        await page.evaluate(() => window.__speechStops),
        2,
        "a good fix again stops listening",
      );
      await fix(180);
      await page.clock.fastForward(4100);
      await page.waitForFunction(() => window.__speechStarts === 3);
      await page.evaluate(() => {
        window.__state.settings.audioAssist = false;
        document.dispatchEvent(new CustomEvent("mymap-settings-change"));
      });
      assert.equal(
        await page.evaluate(() => window.__speechStops),
        3,
        "disabling assist stops the current session immediately",
      );
      await page.evaluate(() => {
        window.__state.settings.audioAssist = true;
        window.__state.settings.autoDetect = false;
      });
      await fix(180);
      await page.clock.fastForward(4100);
      assert.equal(
        await page.evaluate(() => window.__speechStarts),
        3,
        "automatic recognition remains off when auto detection is disabled",
      );
      assert.deepEqual(audio.errors, []);
    } finally {
      await audio.context.close();
    }
  }
  summary.checks.push(
    "Live interactions: dedicated nearby map zoom/pan and quick tracking preserve viewport; denied location never fabricates a current-position marker; the microphone listens only while the GPS fix is poor (never with a good fix or no location), sessions stop at the 60-second limit, a good fix stops listening, disabling audio assist aborts immediately, and auto-detect off prevents restart",
  );
}
