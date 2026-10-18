import assert from "node:assert/strict";
import { resolve } from "node:path";

export async function annotationChecks({
  open,
  layout,
  artifacts,
  summary,
  searchScreen,
  submitSearch,
  settleNavigation,
  backScreen,
}) {
  const cases = [390, 661].flatMap((width) =>
    ["light", "dark"].flatMap((colorScheme) =>
      (width === 390 ? [1, 1.5, 2] : [1]).map((scale) => ({
        width,
        colorScheme,
        scale,
      })),
    ),
  );
  for (const { width, colorScheme, scale } of cases) {
    const scenario = {
      gps: "active",
      stopsAway: 1,
      initialSettings: { autoDetect: false, fontScale: scale },
    };
    const check = await open({
      width,
      colorScheme,
      time: "2026-10-11T01:00:00Z",
      scenario,
    });
    const page = check.page;
    try {
      assert.equal(
        await page
          .locator(".live-navigation-capsule")
          .evaluate((e) => getComputedStyle(e).borderTopWidth),
        "0px",
      );
      const refresh = page.locator(
        ".live-navigation-capsule [data-live-refresh]",
      );
      await refresh.click();
      assert.equal(
        await refresh.evaluate((e) => getComputedStyle(e).outlineStyle),
        "none",
        "pointer activation has no blue outline",
      );
      await page.keyboard.press("Tab");
      assert.notEqual(
        await page.evaluate(
          () => getComputedStyle(document.activeElement).outlineStyle,
        ),
        "none",
        "keyboard focus remains visible",
      );
      const trigger = page.locator("[data-quick-open]");
      await trigger.click();
      await page.locator("#context-sheet[open]").waitFor();
      await page.locator("#context-sheet [data-context-close]").click();
      await settleNavigation(page);
      const rect = await trigger.boundingBox();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(500);
      await page.locator(".live-quick-popover:popover-open").waitFor();
      await page.mouse.up();
      assert.equal(
        await page.locator("#context-sheet[open]").count(),
        0,
        "long press opens dropdown, not a bottom sheet",
      );
      await page.screenshot({
        path: resolve(
          artifacts,
          `annotation-quick-${width}-${colorScheme}-${scale}.png`,
        ),
      });
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator(".live-quick-popover:popover-open").count(),
        0,
      );
      await searchScreen(page);
      await page.locator("[data-search-filter]").click();
      const geometry = await page
        .locator("[data-search-operator]")
        .evaluateAll((nodes) =>
          nodes.map((e) => {
            const r = e.getBoundingClientRect(),
              label = e.closest("label").getBoundingClientRect();
            return {
              w: r.width,
              h: r.height,
              labelH: label.height,
              rightGap: label.right - r.right,
            };
          }),
        );
      for (const r of geometry) {
        assert.ok(Math.abs(r.w - 48) < 0.1);
        assert.ok(Math.abs(r.h - 28) < 0.1);
        assert.ok(r.labelH >= 44);
        assert.ok(r.rightGap >= 0);
      }
      await page.screenshot({
        path: resolve(
          artifacts,
          `annotation-filter-${width}-${colorScheme}-${scale}.png`,
        ),
      });
      await page.locator("#search-filter [data-search-sheet-done]").click();
      await settleNavigation(page);
      await submitSearch(page);
      assert.ok(
        await page
          .locator("[data-result-date]")
          .evaluate((e) => parseFloat(getComputedStyle(e).fontSize) >= 15),
      );
      await page
        .locator(".navigation-current [data-open-route]")
        .first()
        .click();
      await settleNavigation(page);
      const points = await page
        .locator(".navigation-current .journey-point")
        .evaluateAll((nodes) =>
          nodes.map((e) => {
            const line = e.querySelector(".planner-line"),
              rect = line.getBoundingClientRect(),
              dot = getComputedStyle(line, "::after"),
              rail = getComputedStyle(line, "::before");
            const dotCenter = parseFloat(dot.left),
              railCenter = parseFloat(rail.left);
            const clock = e
                .querySelector(".planner-clock,.journey-departure")
                .getBoundingClientRect(),
              band = e.getBoundingClientRect();
            return {
              dotCenter,
              railCenter,
              clockCenter: clock.y + clock.height / 2,
              bandCenter: band.y + band.height / 2,
              final: e.classList.contains("journey-final"),
              railBottom: parseFloat(rail.bottom),
              lineHeight: rect.height,
            };
          }),
        );
      assert.ok(points.length >= 2);
      for (const r of points) {
        assert.ok(
          Math.abs(r.dotCenter - r.railCenter) < 0.6,
          "dot and rail share the same center",
        );
        if (scale === 1)
          assert.ok(
            Math.abs(r.clockCenter - r.bandCenter) < 1,
            "clock centered in station band",
          );
        if (r.final && scale === 1)
          assert.ok(
            Math.abs(r.railBottom - r.lineHeight / 2) < 1,
            "final rail ends at dot center",
          );
      }
      await page.screenshot({
        path: resolve(
          artifacts,
          `annotation-journey-${width}-${colorScheme}-${scale}.png`,
        ),
      });
      await layout(page, `annotation journey ${colorScheme} ${scale}`);
      await page.evaluate(() => {
        window.__navigation.navigation.root("now");
        window.__navigation.navigation.selectTab("now");
      });
      await settleNavigation(page);
      await page.evaluate(() => {
        const stop = [...window.__state.state.network.stops.values()].find(
          (s) => s.type === "citybus" && s.lines?.includes("204"),
        );
        window.__navigation.navigation.push("nearby", { stopId: stop.id });
      });
      await settleNavigation(page);
      const preview = page.locator(".navigation-current .bus-stop-preview");
      await preview
        .locator("[data-bus-approach]")
        .filter({ hasText: "停留所前" })
        .first()
        .waitFor();
      const chosen = await preview
        .locator("[data-bus-approach]")
        .filter({ hasText: "停留所前" })
        .first()
        .getAttribute("data-bus-approach");
      await preview
        .locator("[data-bus-approach]")
        .filter({ hasText: "停留所前" })
        .first()
        .click();
      await settleNavigation(page);
      await page.locator(".navigation-current .arrival-line").first().waitFor();
      assert.equal(
        await page.locator(".navigation-current").getAttribute("data-screen"),
        "arrival-detail",
      );
      assert.equal(
        await page.locator(".navigation-current .arrival-line").count(),
        1,
      );
      assert.equal(
        await page
          .locator(".navigation-current .arrival-line")
          .getAttribute("data-key"),
        chosen,
      );
      await page
        .locator(".navigation-current .arrival-track-vehicle")
        .waitFor();
      await page.screenshot({
        path: resolve(
          artifacts,
          `annotation-approach-${width}-${colorScheme}-${scale}.png`,
        ),
      });
      await layout(page, `annotation approach ${colorScheme} ${scale}`);
      const transform = await page
        .locator(".navigation-current .arrival-track-position")
        .evaluate((e) => e.style.transform || getComputedStyle(e).transform);
      assert.notEqual(transform, "none");
      await page.evaluate(() => {
        window.__arrivalNode = document.querySelector(
          ".navigation-current .arrival-line",
        );
      });
      const originalPosition = await page
        .locator(".navigation-current .arrival-approach")
        .evaluate((e) => e.style.getPropertyValue("--approach-position"));
      scenario.stopsAway = 4;
      await page.clock.fastForward(21000);
      await page.waitForFunction(
        (prior) =>
          document
            .querySelector(".navigation-current .arrival-approach")
            ?.style.getPropertyValue("--approach-position") !== prior,
        originalPosition,
      );
      assert.ok(
        await page.evaluate(
          () =>
            window.__arrivalNode ===
            document.querySelector(".navigation-current .arrival-line"),
        ),
        "observed position updates preserve the detail DOM",
      );
      await page.reload();
      await settleNavigation(page);
      await page.evaluate(async () => {
        const query = new URL(document.querySelector("script[type=module]").src)
          .search;
        window.__navigation = await import(
          new URL(`js/navigation.js${query}`, location.href).href
        );
      });
      await page.locator(".navigation-current .arrival-line").first().waitFor();
      assert.equal(
        await page
          .locator(".navigation-current .arrival-line")
          .getAttribute("data-key"),
        chosen,
        "reload preserves selected direction",
      );
      await backScreen(page);
      assert.equal(
        await page.locator(".navigation-current").getAttribute("data-screen"),
        "nearby",
      );
      await page.evaluate(() =>
        window.__navigation.navigation.push("nearby", { stopId: "K07" }),
      );
      await settleNavigation(page);
      await page
        .locator(".navigation-current .station-arrivals .arrival-line")
        .first()
        .waitFor();
      assert.match(
        await page.locator(".navigation-current .station-arrivals").innerText(),
        /推定|予定/,
      );
      await page.screenshot({
        path: resolve(
          artifacts,
          `annotation-subway-${width}-${colorScheme}-${scale}.png`,
        ),
      });
      await layout(page, `annotation subway ${colorScheme} ${scale}`);
      await page.locator('[data-tab="settings"]').click();
      await settleNavigation(page);
      assert.equal(
        await page.locator(".navigation-current .native-row").count(),
        await page.locator(".navigation-current .native-row svg").count(),
      );
      await page.screenshot({
        path: resolve(
          artifacts,
          `annotation-settings-${width}-${colorScheme}-${scale}.png`,
        ),
      });
      assert.deepEqual(check.errors, []);
    } catch (error) {
      await page.screenshot({
        path: resolve(
          artifacts,
          `annotation-failure-${width}-${colorScheme}-${scale}.png`,
        ),
      });
      console.error(await page.locator("body").innerText());
      throw error;
    } finally {
      await check.context.close();
    }
  }
  for (const colorScheme of ["light", "dark"]) {
    const date = "2026-10-11";
    const rail = await open({
      width: 390,
      colorScheme,
      time: "2026-10-11T01:07:00Z",
      scenario: {
        gps: "active",
        initialSettings: { autoDetect: false },
        railTrains: [
          {
            key: "observed-local",
            direction: "south",
            category: "local",
            label: "普通",
            dest: "近鉄奈良",
            position: 5,
            delay: 2,
          },
        ],
        staticFeeds: {
          [`kintetsu:${date}`]: {
            validDates: [date],
            services: [
              {
                id: "nearby-local",
                operator: "kintetsu",
                category: "local",
                stops: ["B01", "B02", "K15", "B06", "B07"],
                trips: [
                  {
                    id: "official-local",
                    date,
                    headsign: "近鉄奈良",
                    departures: [600, 602, 610, 612, 614],
                    arrivals: [600, 602, 610, 612, 614],
                  },
                ],
              },
            ],
          },
        },
      },
    });
    try {
      const page = rail.page;
      await page.evaluate(() =>
        window.__navigation.navigation.push("nearby", { stopId: "B07" }),
      );
      await settleNavigation(page);
      const root = page.locator(".navigation-current .station-arrivals");
      await root.locator(".source-dot.live").waitFor();
      assert.equal(await root.locator(".arrival-toggle").count(), 0, "informational rail rows do not advertise an empty disclosure");
      assert.equal(
        (await root.locator(".arrival-lines").innerText()).includes("確認中"),
        false,
        "loading text clears once rows arrive",
      );
      assert.match(
        await root.locator(".arrival-dest").first().innerText(),
        /奈良方面/,
      );
      assert.match(
        await root.locator(".station-service").first().innerText(),
        /普通/,
      );
      assert.match(
        await root.locator(".arrival-minutes").first().innerText(),
        /9\s*分後/,
      );
      assert.match(
        await root.innerText(),
        /位置は実測.*到着は公式時刻と照合した予測/,
      );
      await root.locator(".arrival-track-vehicle").waitFor();
      await layout(page, `annotation Kintetsu ${colorScheme}`);
      await page.screenshot({
        path: resolve(artifacts, `annotation-kintetsu-390-${colorScheme}.png`),
      });
      await rail.context.setOffline(true);
      await page.clock.fastForward(21000);
      await page.waitForFunction(() =>
        document
          .querySelector(".navigation-current [data-station-source]")
          ?.textContent.includes("オフライン"),
      );
      assert.equal(
        await root.locator(".source-dot.live").count(),
        0,
        "offline never keeps observed source styling",
      );
      assert.deepEqual(rail.errors, []);
    } finally {
      await rail.context.close();
    }
  }
  summary.checks.push(
    "Annotation audit: borderless navigation; tap versus long-press Quick dropdown; switch geometry; readable result date; centered station dots/rails/clocks; selected-direction animated approach, reload and Back; scheduled subway estimates; settings symbols; 390px Light/Dark 100/150/200%, 661px Light/Dark; real observed-count updates preserve DOM",
  );
}
