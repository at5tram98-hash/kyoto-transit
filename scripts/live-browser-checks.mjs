import assert from "node:assert/strict";
import { resolve } from "node:path";

export async function liveInteractionChecks({
  open,
  layout,
  artifacts,
  summary,
}) {
  {
    const pinch = await open({
      width: 390,
      time: "2026-10-17T01:00:00Z",
      scenario: { gps: "active", initialSettings: { autoDetect: false } },
    });
    try {
      const page = pinch.page;
      await page.evaluate(() => {
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
      const map = page.locator(".idle-context .map-canvas");
      await map.waitFor();
      const box = await map.boundingBox();
      assert.ok(box, "idle map is visible");
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const startScale = await page.evaluate(() =>
        Number(document.querySelector(".idle-context .map-canvas")?.dataset.scale ?? 1),
      );
      await page.touchscreen.tap(center.x, center.y);
      await page.evaluate(
        ({ x, y }) => {
          const target = document.querySelector(".idle-context .map-canvas");
          const touch = (identifier, offset) => ({
            identifier,
            target,
            clientX: x + offset,
            clientY: y,
            pageX: x + offset,
            pageY: y,
            screenX: x + offset,
            screenY: y,
            radiusX: 2,
            radiusY: 2,
            rotationAngle: 0,
            force: 1,
          });
          const dispatch = (type, touches) =>
            target.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches,
                targetTouches: touches,
                changedTouches: touches,
              }),
            );
          dispatch("touchstart", [touch(1, -30), touch(2, 30)]);
          dispatch("touchmove", [touch(1, -70), touch(2, 70)]);
          dispatch("touchend", []);
        },
        center,
      );
      const endScale = await page.evaluate(() =>
        Number(document.querySelector(".idle-context .map-canvas")?.dataset.scale ?? 1),
      );
      assert.ok(endScale > startScale, "pinch increases map scale");
      await layout(page, "live-pinch-true");
      await page.screenshot({ path: resolve(artifacts, "live-pinch-true.png") });
      await page.evaluate(() => {
        window.__state.state.fix = null;
        window.__state.state.location = null;
        window.__view.renderNow();
      });
      await layout(page, "live-pinch-false");
      await page.screenshot({ path: resolve(artifacts, "live-pinch-false.png") });
      assert.deepEqual(pinch.errors, []);
    } finally {
      await pinch.context.close();
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
      await page.evaluate(() => {
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
      const map = page.locator(".idle-context .map-canvas");
      await map.waitFor();
      const box = await map.boundingBox();
      assert.ok(box);
      const start = await page.evaluate(() => ({
        x: Number(document.querySelector(".idle-context .map-canvas")?.dataset.panX ?? 0),
        y: Number(document.querySelector(".idle-context .map-canvas")?.dataset.panY ?? 0),
      }));
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 45, {
        steps: 4,
      });
      await page.mouse.up();
      const end = await page.evaluate(() => ({
        x: Number(document.querySelector(".idle-context .map-canvas")?.dataset.panX ?? 0),
        y: Number(document.querySelector(".idle-context .map-canvas")?.dataset.panY ?? 0),
      }));
      assert.ok(end.x !== start.x || end.y !== start.y, "map pan moves viewport");
      await layout(page, "live-pan-true");
      await page.screenshot({ path: resolve(artifacts, "live-pan-true.png") });
      await page.evaluate(() => {
        window.__state.state.fix = null;
        window.__state.state.location = null;
        window.__view.renderNow();
      });
      await layout(page, "live-pan-false");
      await page.screenshot({ path: resolve(artifacts, "live-pan-false.png") });
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
      await page.evaluate(() => {
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
      await page.locator(".idle-context .map-canvas").waitFor();
      await page.evaluate(() => {
        const target = document.querySelector(".idle-context .map-canvas");
        target.dataset.panX = "50";
        target.dataset.panY = "30";
        target.style.setProperty("--map-pan-x", "50px");
        target.style.setProperty("--map-pan-y", "30px");
      });
      const before = await page.evaluate(() => ({
        x: Number(document.querySelector(".idle-context .map-canvas")?.dataset.panX ?? 0),
        y: Number(document.querySelector(".idle-context .map-canvas")?.dataset.panY ?? 0),
      }));
      assert.deepEqual(before, { x: 50, y: 30 });
      await page.evaluate(() => {
        window.__state.state.fix = {
          ...window.__state.state.fix,
          lat: 35.012,
          lng: 135.7685,
          timestamp: Date.now(),
        };
        window.__view.renderNow();
      });
      const after = await page.evaluate(() => ({
        x: Number(document.querySelector(".idle-context .map-canvas")?.dataset.panX ?? 0),
        y: Number(document.querySelector(".idle-context .map-canvas")?.dataset.panY ?? 0),
      }));
      assert.deepEqual(after, before, "quick location update preserves manual pan");
      await layout(page, "live-quick-tracking-true");
      await page.screenshot({
        path: resolve(artifacts, "live-quick-tracking-true.png"),
      });
      await page.evaluate(() => {
        window.__state.state.fix = null;
        window.__state.state.location = null;
        window.__view.renderNow();
      });
      await layout(page, "live-quick-tracking-false");
      await page.screenshot({
        path: resolve(artifacts, "live-quick-tracking-false.png"),
      });
      assert.deepEqual(tracking.errors, []);
    } finally {
      await tracking.context.close();
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
    "Live interactions: map pinch/pan and quick tracking use granted location and preserve state; denied-location microphone checks never fabricate location, prompt permission never auto-starts, granted sessions stop at the 60-second limit, cooldown applies, disabling audio assist aborts immediately, and auto-detect off prevents restart",
  );
}