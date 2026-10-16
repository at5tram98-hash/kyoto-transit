import assert from "node:assert/strict";
import { resolve } from "node:path";

// Direct manipulation is measured before pointerup, not inferred from screenshots.
export async function liveInteractionChecks({
  open,
  setRide,
  settleNavigation,
  backScreen,
  artifacts,
  summary,
  layout,
}) {
  for (const standalone of [false, true]) {
    const run = await open({
      width: 390,
      height: 844,
      time: "2026-10-11T01:00:00Z",
      scenario: {
        standalone,
        gps: "active",
        foldEntries: [
          {
            depart: 615,
            category: "local",
            destination: "国際会館",
            tripId: "next-fold",
          },
        ],
      },
    });
    const { page } = run;
    try {
      await page.locator(".live-map-host .map-tile").first().waitFor();
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll(".live-map-host svg [points]")].some(
            (e) => e.getAttribute("points").includes("NaN"),
          ),
      );
      const map = page.locator(".live-map-host .map-canvas"),
        box = await map.boundingBox();
      assert.ok(box.height >= 170 && box.height <= 200);
      const paths = await map.locator("svg").innerHTML();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width * 0.6 + 30,
        box.y + box.height * 0.5 + 15,
      );
      assert.match(
        await map.locator("svg").getAttribute("style"),
        /translate\(30px,\s*15px\)/,
      );
      await page.screenshot({
        path: resolve(artifacts, `live-pan-${standalone}.png`),
      });
      await page.mouse.up();
      assert.notEqual(await map.locator("svg").innerHTML(), paths);
      const tileBefore = await map
        .locator(".map-tile")
        .first()
        .evaluate((e) => parseFloat(e.style.width));
      await map.evaluate((canvas) => {
        const b = canvas.getBoundingClientRect(),
          x = b.x + b.width / 2,
          y = b.y + b.height / 2;
        const send = (type, id, dx) =>
          canvas.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: id,
              pointerType: "touch",
              button: 0,
              clientX: x + dx,
              clientY: y,
            }),
          );
        // Dispatch to the document to exercise the shared map controller without
        // asking Playwright's mouse backend to own synthetic touch capture.
        canvas.setPointerCapture = () => {};
        send("pointerdown", 41, -40);
        send("pointerdown", 42, 40);
        send("pointermove", 41, -75);
        send("pointermove", 42, 75);
      });
      assert.match(
        await map.locator("svg").getAttribute("style"),
        /scale\(1.875\)/,
      );
      await page.screenshot({
        path: resolve(artifacts, `live-pinch-${standalone}.png`),
      });
      await map.evaluate((canvas) =>
        canvas.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            pointerId: 41,
            pointerType: "touch",
            button: 0,
          }),
        ),
      );
      assert.ok(
        (await map
          .locator(".map-tile")
          .first()
          .evaluate((e) => parseFloat(e.style.width))) >
          tileBefore * 1.8,
        "fractional zoom redraws scaled tiles",
      );
      assert.equal(
        await page.evaluate(() => visualViewport.scale),
        1,
        "map pinch does not zoom the page",
      );
      assert.equal(
        await page.locator(".live-map-host .map-controls").count(),
        0,
      );
      // Long press follows the finger over the visible destination, release commits.
      const trigger = await page.locator("[data-quick-open]").boundingBox(),
        target = await page
          .locator("#now-search [data-quick-destination]")
          .first()
          .boundingBox();
      await page.mouse.move(
        trigger.x + trigger.width / 2,
        trigger.y + trigger.height / 2,
      );
      await page.mouse.down();
      await page.waitForTimeout(460);
      await page.mouse.move(
        target.x + target.width / 2,
        target.y + target.height / 2,
      );
      assert.equal(await page.locator(".quick-tracking").count(), 1);
      await page.screenshot({
        path: resolve(artifacts, `live-quick-tracking-${standalone}.png`),
      });
      await page.mouse.up();
      await settleNavigation(page);
      assert.equal(
        await page.locator(".navigation-current").getAttribute("data-view"),
        "search",
      );
      assert.ok(await page.locator("[name=to]").inputValue());
      await page.locator("[data-search-filter]").click();
      assert.equal(
        await page.locator("[data-kintetsu-condition]").isVisible(),
        false,
      );
      await page.locator("[data-search-operator=kintetsu]").uncheck();
      await page.locator("#search-filter [data-search-sheet-cancel]").click();
      await settleNavigation(page);
      assert.ok(
        (await page.locator("[name=operators]").inputValue()).includes(
          "kintetsu",
        ),
      );
      await page.locator("[data-tab=now]").click();
      await settleNavigation(page);
      await page.locator("[data-live-full-map]").click();
      await settleNavigation(page);
      await layout(page, `Live full map ${standalone}`);
      assert.equal(
        await page.locator(".navigation-current").getAttribute("data-screen"),
        "map",
      );
      await backScreen(page);
      // The dedicated next-station foldback shares the existing exact schedule and safety calculation.
      await setRide(page, "subway");
      await page.locator("[data-open-foldback]").click();
      assert.equal(await page.locator("[data-foldback-mode]").count(), 3);
      await page.locator("[data-foldback-mode=next]").click();
      assert.equal(
        await page.locator("#fold-station").inputValue(),
        "K08",
        "a stopped train folds at the following station, not its current station",
      );
      await page.locator(".target-result").waitFor();
      assert.ok(await page.locator("[data-save-foldback]").isEnabled());
      assert.match(
        await page.locator(".fold-timing").textContent(),
        /ホーム移動/,
      );
      await page.screenshot({
        path: resolve(artifacts, `foldback-next-${standalone}.png`),
      });
      await page.locator("[data-save-foldback]").click();
      await settleNavigation(page);
      assert.ok(
        await page.evaluate(() => Boolean(window.__state.state.foldbackPlan)),
      );
      const replanFrom = await page.evaluate(() => {
        // A manually started ride must take priority over an unrelated old search.
        window.__navigation.navigation.remember("search-data", [
          {
            input: {
              from: "国際会館",
              fromId: "K01",
              to: "丸太町",
              toId: "K07",
            },
          },
        ]);
        return window.__state.state.heroModel.nextStation.id;
      });
      await page.locator("[data-tab=operations]").click();
      await settleNavigation(page);
      await page.locator("[data-operations-replan]").click();
      await settleNavigation(page);
      assert.equal(
        await page.locator(".navigation-current").getAttribute("data-view"),
        "search",
      );
      assert.ok(await page.locator("[name=from]").inputValue());
      assert.ok(await page.locator("[name=to]").inputValue());
      assert.equal(
        await page.locator("[name=fromId]").inputValue(),
        replanFrom,
      );
      assert.ok(
        await page.evaluate(() => Boolean(window.__state.state.ride)),
        "operation replan retains the onboard journey",
      );
      await layout(page, `Manual ride replan ${standalone}`);
      await page.locator("[data-tab=settings]").click();
      await settleNavigation(page);
      await page.locator("[data-setting-page=privacy]").click();
      await settleNavigation(page);
      await layout(page, `Privacy ${standalone}`);
      assert.match(
        await page.locator(".navigation-current").textContent(),
        /最長6秒/,
      );
      await backScreen(page);
      await page.evaluate(async () => {
        const query = new URL(
          document.querySelector('script[type="module"]').src,
        ).search;
        const { readSavedPlaces, toggleSavedPlace } = await import(
          new URL(`js/saved-places.js${query}`, location.href)
        );
        if (!readSavedPlaces().includes("K07")) toggleSavedPlace("K07");
      });
      await page.locator("[data-saved-page=places]").click();
      await settleNavigation(page);
      await page.locator("[data-quick-symbol-place=K07]").click();
      await page.locator("[data-pick-quick-symbol=bookmark]").click();
      await settleNavigation(page);
      assert.equal(
        await page.evaluate(() => window.__state.settings.quickSymbols.K07),
        "bookmark",
      );
      await page.locator("[data-tab=now]").click();
      await settleNavigation(page);
      await page.locator("#ride-end").click();
      await settleNavigation(page);
      assert.equal(
        await page
          .locator("#now-search [data-quick-destination=K07]")
          .getAttribute("data-quick-symbol"),
        "bookmark",
      );
      await page.evaluate(() => {
        const state = window.__state.state;
        state.fix = {
          lat: 35.01651,
          lng: 135.75949,
          accuracy: 250,
          timestamp: Date.now(),
          speed: 0,
        };
        state.locationStatus = "active";
        window.__view.renderNow();
      });
      assert.equal(
        await page.locator("[data-location-dot]").getAttribute("data-quality"),
        "low",
      );
      assert.match(
        await page.locator("[data-live-location]").textContent(),
        /250m/,
      );
      assert.ok(
        Number(
          await page.locator(".live-map-host .map-accuracy").getAttribute("r"),
        ) > 0,
        "late/coarse GPS adds a real accuracy circle",
      );
      await page.evaluate(() => {
        window.__state.state.fix = {
          lat: 35.681,
          lng: 139.767,
          accuracy: 10,
          timestamp: Date.now(),
          speed: 0,
        };
        window.__view.renderNow();
      });
      assert.equal(
        await page.locator("[data-live-location]").textContent(),
        "現在地を取得",
        "outside coverage never claims a distant Kyoto stop is nearby",
      );
      await run.context.setOffline(true);
      await page.locator("#network-status").waitFor();
      assert.match(
        await page.locator("#network-status").textContent(),
        /オフライン/,
      );
      assert.equal(
        await page
          .locator('#arrival-live [data-field="source"] .source-dot.live')
          .count(),
        0,
        "offline arrivals cannot claim live",
      );
      assert.deepEqual(run.errors, []);
    } finally {
      await run.context.close();
    }
  }
  const boundary = await open({ time: "2026-10-11T01:00:00Z" });
  try {
    const page = boundary.page;
    await page.locator("#now-search [data-quick-destination=K01]").click();
    await settleNavigation(page);
    for (const [mode, label] of [
      ["first", "始発"],
      ["last", "終電"],
    ]) {
      if (mode === "first") await page.locator("[data-search-date]").click();
      else await page.locator(".navigation-current [data-edit-date]").click();
      await page.locator("#search-date [name=timeMode]").selectOption(mode);
      assert.equal(
        await page.locator("#search-date [name=time]").isVisible(),
        false,
      );
      await page.locator("#search-date [data-search-sheet-done]").click();
      await settleNavigation(page);
      if (mode === "first")
        await page.locator("#planner-form .planner-submit").click();
      await page
        .locator(".navigation-current [data-open-route]")
        .first()
        .waitFor();
      await settleNavigation(page);
      assert.equal(
        await page
          .locator(".navigation-current [data-result-clock]")
          .textContent(),
        label,
      );
      assert.match(
        await page
          .locator(".navigation-current .planner-times")
          .first()
          .textContent(),
        /10:05/,
      );
      await layout(page, `Actual ${mode} service search`);
    }
    // Restore an actual search snapshot with a formerly-live trip observation.
    // The visible source must age without replacing the route, then react offline.
    // Wait for reconciliation before editing a fixture observation; otherwise
    // its legitimate final Worker result replaces this injected test data.
    await page
      .locator(".navigation-current [data-planner-status] .loading-note")
      .waitFor({ state: "detached" });
    await page.evaluate(() => {
      const nav = window.__navigation.navigation;
      const snapshot = nav.recalled("search-data").at(-1);
      const leg = snapshot.routes[0].legs.find((l) => l.kind === "ride");
      leg.realtime = {
        source: "live",
        asOf: new Date(Date.now()).toISOString(),
        delay: 2,
      };
      nav.push("route", { index: 0, revision: snapshot.revision });
    });
    await settleNavigation(page);
    const quality = page.locator(".navigation-current .planner-quality");
    assert.equal(await quality.locator(".source-dot.live").count(), 1);
    const routeNode = await page
      .locator(".navigation-current .planner-result")
      .elementHandle();
    await page.clock.fastForward(92000);
    await page.waitForFunction(() =>
      document
        .querySelector(".navigation-current .planner-quality")
        ?.textContent.includes("要更新"),
    );
    assert.equal(await quality.locator(".source-dot.live").count(), 0);
    assert.ok(
      await routeNode.evaluate((e) => e.isConnected),
      "source expiry preserves the route DOM",
    );
    await boundary.context.setOffline(true);
    await page.waitForFunction(() =>
      document
        .querySelector(".navigation-current .planner-quality")
        ?.textContent.includes("オフライン"),
    );
    await layout(page, "Stored journey source expires and goes offline");
    assert.deepEqual(boundary.errors, []);
  } finally {
    await boundary.context.close();
  }
  summary.checks.push(
    "First/last service UI: irrelevant time field is removed, real Worker returns fetched boundaries; saved journey realtime expires and goes offline without replacing route DOM",
  );
  const interrupted = await open({ time: "2026-10-11T01:00:00Z" });
  let releaseWorker;
  const heldWorker = new Promise((resolve) => {
    releaseWorker = resolve;
  });
  let notifyStarted;
  const startedWorker = new Promise((resolve) => {
    notifyStarted = resolve;
  });
  try {
    const page = interrupted.page;
    await page.route(
      "**/planner-worker.js*",
      async (route) => {
        notifyStarted();
        await heldWorker;
        await route.continue().catch(() => {});
      },
      { times: 1 },
    );
    await page.locator("#now-search [data-quick-destination=K01]").click();
    await settleNavigation(page);
    await page.locator("#planner-form .planner-submit").click();
    await startedWorker;
    await page.reload({ waitUntil: "domcontentloaded" });
    releaseWorker();
    await page.locator(".app-shell[data-navigation-depth]").waitFor();
    await settleNavigation(page);
    // Re-enter conditions through the restored app, then fail one owned Worker.
    await page.locator(".navigation-current [data-edit-search]").click();
    await settleNavigation(page);
    await page.route(
      "**/planner-worker.js*",
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/javascript",
          body: "Unavailable",
        }),
      { times: 1 },
    );
    await page.locator("#planner-form .planner-submit").click();
    await page.locator(".navigation-current [data-retry-search]").waitFor();
    assert.equal(
      await page.locator(".navigation-current [data-open-route]").count(),
      0,
    );
    await page.locator(".navigation-current [data-retry-search]").click();
    await page
      .locator(".navigation-current [data-open-route]")
      .first()
      .waitFor();
    await layout(page, "Planner Worker unload, inline failure and recovery");
    assert.deepEqual(interrupted.errors, []);
  } finally {
    releaseWorker();
    await interrupted.context.close();
  }
  summary.checks.push(
    "Planner lifecycle: reload during a held Worker module load; genuine Worker failure is visible inline and retry succeeds, without unhandled page errors",
  );
  const audio = await open({ time: "2026-10-11T01:00:00Z" });
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
    await page.clock.fastForward(6100);
    assert.equal(
      await page.evaluate(() => window.__speechStops),
      1,
      "recognition aborts within 6 seconds",
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
      "automatic detection OFF cannot start a microphone session",
    );
    assert.deepEqual(audio.errors, []);
  } finally {
    await audio.context.close();
  }
  summary.checks.push(
    "Microphone lifecycle with a recognition stub: prompt permission causes zero starts, granted starts only for an uncertain ride, 6-second deadline and immediate disable abort; no physical audio was recorded",
  );
  summary.checks.push(
    "Live direct manipulation: 1:1 mini-map pan, continuous pinch without page zoom, long-press slide/release destination, filter cancel, full map/Back, 3 foldback modes with next-station schedule/arrival/buffer confirmation, Privacy; browser and standalone equivalents",
  );
}
