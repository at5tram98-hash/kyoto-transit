import assert from "node:assert/strict";
import { resolve } from "node:path";

export async function liveInteractionChecks({
  open,
  layout,
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
    return map;
  }
  async function firstStopPositions(page) {
    return page.evaluate(() =>
      [...document.querySelectorAll(".navigation-current .route-map .map-stop")]
        .sort((a,b) => a.closest("[data-map-stop]").dataset.mapStop.localeCompare(b.closest("[data-map-stop]").dataset.mapStop))
        .slice(0, 2)
        .map((node) => ({
          x: Number(node.getAttribute("cx")),
          y: Number(node.getAttribute("cy")),
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
      await page.evaluate(async () => {
        const query = new URL(
          document.querySelector("script[type=module]").src,
        ).search;
        const routeMap = await import(
          new URL(`js/route-map.js${query}`, location.href).href
        );
        const { state, nearest } = window.__state;
        state.fix = {
          ...state.fix,
          lat: 35.012,
          lng: 135.7685,
          timestamp: Date.now(),
        };
        state.nearbyMap = routeMap.nearbyMapModel(
          state.geo,
          nearest(),
          state.fix,
          state.network,
        );
        routeMap.renderRouteMap(
          document.querySelector(".navigation-current"),
          state.nearbyMap,
          { bus: false, lineId: "nearby" },
        );
      });
      const after = await firstStopPositions(page);
      assert.ok(
        Math.abs(after[0].x - before[0].x) < 0.01 &&
          Math.abs(after[0].y - before[0].y) < 0.01,
        "quick location update preserves the manually panned viewport",
      );
      assert.equal(
        await page.locator(".navigation-current .route-map .map-position").count(),
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
      await page.waitForTimeout(80);
      assert.equal(
        await page.evaluate(() => window.__speechStarts),
        0,
        "prompt permission never starts automatic speech",
      );
      await page.evaluate(() => {
        window.__microphoneState = "granted";
        document
          .querySelector("#vehicle-panel")
          .append(document.createElement("span"));
      });
      await page.waitForFunction(() => window.__speechStarts === 1);
      await page.clock.fastForward(60300);
      assert.equal(
        await page.evaluate(() => window.__speechStops),
        1,
        "candidate recognition stops at the 60 second session limit",
      );
      await page.clock.fastForward(31000);
      await page.evaluate(() =>
        document
          .querySelector("#vehicle-panel")
          .append(document.createElement("span")),
      );
      await page.waitForFunction(() => window.__speechStarts === 2);
      await page.evaluate(() => {
        window.__state.settings.audioAssist = false;
        document.dispatchEvent(new CustomEvent("mymap-settings-change"));
      });
      assert.equal(
        await page.evaluate(() => window.__speechStops),
        2,
        "disabling assist stops the current session immediately",
      );
      await page.evaluate(() => {
        window.__state.settings.audioAssist = true;
        window.__state.settings.autoDetect = false;
        document
          .querySelector("#vehicle-panel")
          .append(document.createElement("span"));
      });
      await page.waitForTimeout(80);
      assert.equal(
        await page.evaluate(() => window.__speechStarts),
        2,
        "automatic recognition remains off when auto detection is disabled",
      );
      assert.deepEqual(audio.errors, []);
    } finally {
      await audio.context.close();
    }
  }
  summary.checks.push(
    "Live interactions: dedicated nearby map zoom/pan and quick tracking preserve viewport; denied location never fabricates a current-position marker; microphone prompt never auto-starts, granted sessions stop at the 60-second limit, cooldown applies, disabling audio assist aborts immediately, and auto-detect off prevents restart",
  );
}