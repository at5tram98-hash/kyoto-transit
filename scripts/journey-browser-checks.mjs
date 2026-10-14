import assert from "node:assert/strict";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";

export async function journeyUpgradeChecks({
  open,
  setRide,
  searchScreen,
  submitSearch,
  backScreen,
  settleNavigation,
  layout,
  artifacts,
  summary,
}) {
  const date = "2026-10-11",
    feed = {
      validDates: [date],
      meta: { operator: "subway", stale: false },
      stops: [
        ["K07", "丸太町"],
        ["K06", "今出川"],
        ["K05", "鞍馬口"],
        ["K04", "北大路"],
        ["K03", "北山"],
        ["K02", "松ヶ崎"],
        ["K01", "国際会館"],
      ].map(([id, name]) => ({ id, name })),
      services: [
        {
          id: "journey-first",
          operator: "subway",
          label: "地下鉄烏丸線",
          category: "local",
          stops: ["K07", "K06", "K05", "K04"],
          platforms: ["1", "1", "1", "1"],
          trips: [605, 615, 630].map((m) => ({
            id: `first-${m}`,
            date,
            arrivals: [m, m + 3, m + 5, m + 7],
            departures: [m, m + 3, m + 5, m + 7],
            headsign: "北大路",
          })),
        },
        {
          id: "journey-second",
          operator: "subway",
          label: "地下鉄烏丸線",
          category: "local",
          stops: ["K04", "K03", "K02", "K01"],
          platforms: ["2", "2", "2", "2"],
          trips: [616, 632, 650].map((m) => ({
            id: `second-${m}`,
            date,
            arrivals: [m, m + 3, m + 6, m + 9],
            departures: [m, m + 3, m + 6, m + 9],
            headsign: "国際会館",
          })),
        },
      ],
    };
  for (const colorScheme of ["light", "dark"])
    for (const scale of [1, 1.5, 2]) {
      const run = await open({
          width: 390,
          colorScheme,
          reducedMotion: scale === 2 ? "reduce" : "no-preference",
          time: "2026-10-11T01:00:00Z",
          scenario: { gps: "denied", subwayFeed: feed },
        }),
        { page } = run;
      const shot = async (name) => {
        await layout(page, `journey ${name} ${colorScheme} ${scale}`);
        const problems = await page.evaluate(() => {
          const root = document.querySelector(".navigation-current"),
            problems = [];
          for (const e of root.querySelectorAll(
            ".journey-departure,.trip-choice-row,.trip-choice-description,.trip-choice-times,.planner-clock",
          )) {
            const r = e.getBoundingClientRect();
            if (
              r.width &&
              (r.x < -0.5 ||
                r.right > innerWidth + 0.5 ||
                e.scrollWidth > e.clientWidth + 1)
            )
              problems.push(e.className);
          }
          const footer = root.querySelector(".screen-bottom-action"),
            button = footer?.querySelector("button");
          if (button && !footer.hidden) {
            const r = button.getBoundingClientRect(),
              bar = document.querySelector(".tabbar").getBoundingClientRect();
            if (
              r.bottom > bar.y - 8 ||
              !button.contains(
                document.elementFromPoint(
                  r.x + r.width / 2,
                  r.y + r.height / 2,
                ),
              )
            )
              problems.push("CTA covered");
          }
          return problems;
        });
        assert.deepEqual(problems, [], `${name} ${colorScheme} ${scale}`);
        await page.screenshot({
          path: resolve(
            artifacts,
            `journey-${name}-${colorScheme}-${scale}.png`,
          ),
        });
      };
      try {
        await page.evaluate(
          (s) => (document.documentElement.style.fontSize = `${16 * s}px`),
          scale,
        );
        await searchScreen(page);
        await submitSearch(page);
        await page
          .locator(".navigation-current [data-open-route]")
          .first()
          .click();
        await settleNavigation(page);
        assert.equal(
          await page
            .locator(".navigation-current .planner-times strong")
            .nth(1)
            .textContent(),
          "10:25",
        );
        await page
          .locator(".navigation-current .planner-leg-stops summary")
          .first()
          .click();
        await shot("original");
        await page.locator('.navigation-current [data-change-leg="0"]').click();
        await page
          .locator(".navigation-current .trip-choice-row")
          .first()
          .waitFor();
        await shot("choices");
        await page
          .locator(".navigation-current .trip-choice-row")
          .filter({ hasText: "10:15" })
          .click();
        await page
          .locator(".navigation-current [data-apply-trip]:enabled")
          .waitFor();
        await shot("preview");
        await page.locator(".navigation-current [data-apply-trip]").click();
        await settleNavigation(page);
        assert.equal(
          await page
            .locator(".navigation-current .planner-times strong")
            .nth(1)
            .textContent(),
          "10:41",
        );
        assert.match(
          await page
            .locator('.navigation-current [data-change-leg="1"]')
            .textContent(),
          /10:32/,
        );
        assert.equal(
          await page
            .locator(".navigation-current .planner-leg-stops")
            .first()
            .getAttribute("open"),
          "",
        );
        await shot("updated");
        await page.locator('.navigation-current [data-change-leg="1"]').click();
        await page
          .locator(".navigation-current .trip-choice-row")
          .first()
          .waitFor();
        assert.equal(
          await page
            .locator(".navigation-current .trip-choice-row")
            .filter({ hasText: "10:16" })
            .isDisabled(),
          true,
        );
        await page
          .locator(".navigation-current .trip-choice-row")
          .filter({ hasText: "10:50" })
          .click();
        await page
          .locator(".navigation-current [data-apply-trip]:enabled")
          .waitFor();
        await page.locator('.tabbar [data-tab="timetable"]').click();
        await settleNavigation(page);
        await page.locator('.tabbar [data-tab="now"]').click();
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "departures",
        );
        await page.reload();
        await page
          .locator(".navigation-current [data-apply-trip]:enabled")
          .waitFor();
        await backScreen(page);
        assert.equal(
          await page
            .locator(".navigation-current .planner-times strong")
            .nth(1)
            .textContent(),
          "10:41",
        );
        await page.reload();
        await page
          .locator(".navigation-current [data-change-leg]")
          .first()
          .waitFor();
        assert.equal(
          await page
            .locator(".navigation-current .planner-times strong")
            .nth(1)
            .textContent(),
          "10:41",
        );
        await page.locator('.navigation-current [data-change-leg="0"]').click();
        await page
          .locator(".navigation-current .trip-choice-row")
          .first()
          .waitFor();
        await page.goBack();
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "route",
        );
        const readPlan = () =>
          page.evaluate(async () => {
            const query = new URL(
                document.querySelector("script[type=module]").src,
              ).search,
              { state } = await import(
                new URL(`js/vnext-state.js${query}`, location.href).href
              );
            return {
              phase: state.itinerary?.phase,
              legIndex: state.itinerary?.legIndex,
              current: state.ride?.tripId,
              destination: state.ride?.userDestination?.id,
              armed: state.armedJourney?.ride.tripId,
              trips: state.itinerary?.route.legs
                .filter((l) => l.kind === "ride")
                .map((l) => l.tripId),
            };
          });
        await page
          .locator('.navigation-current [data-arm-route="0"][data-arm-leg="0"]')
          .last()
          .click();
        await settleNavigation(page);
        assert.deepEqual((await readPlan()).trips, ["first-615", "second-632"]);
        await page.reload();
        await page.locator(".navigation-current [data-board-armed]").waitFor();
        assert.equal((await readPlan()).armed, "first-615");
        await page.clock.setSystemTime(new Date("2026-10-11T01:15:00Z"));
        await page.locator(".navigation-current [data-board-armed]").click();
        await settleNavigation(page);
        assert.equal((await readPlan()).current, "first-615");
        assert.equal((await readPlan()).phase, "riding");
        assert.equal((await readPlan()).destination, "K04");
        await page
          .locator('.navigation-current [data-context-action="destination"]')
          .click();
        await page.locator("#personal-stop").selectOption("K05");
        await page.locator("[data-save-destination]").click();
        assert.match(
          await page
            .locator(".navigation-current .itinerary-summary")
            .textContent(),
          /元の旅程と異なります/,
        );
        await page
          .locator('.navigation-current [data-context-action="destination"]')
          .click();
        await page.locator("#personal-stop").selectOption("K04");
        await page.locator("[data-save-destination]").click();
        assert.equal((await readPlan()).destination, "K04");
        await page.locator(".navigation-current [data-open-itinerary]").click();
        await settleNavigation(page);
        assert.match(
          await page
            .locator(".navigation-current .planner-timeline")
            .textContent(),
          /10:32/,
        );
        await shot("itinerary");
        await page.locator(".navigation-current [data-itinerary-next]").click();
        await settleNavigation(page);
        assert.equal((await readPlan()).phase, "transfer");
        assert.equal((await readPlan()).current, undefined);
        assert.equal((await readPlan()).armed, "second-632");
        await shot("transfer");
        await page.reload();
        await page.locator(".navigation-current [data-board-armed]").waitFor();
        assert.equal((await readPlan()).armed, "second-632");
        await page.clock.setSystemTime(new Date("2026-10-11T01:32:00Z"));
        await page.locator(".navigation-current [data-board-armed]").click();
        await settleNavigation(page);
        assert.equal((await readPlan()).current, "second-632");
        await page.locator(".navigation-current #ride-end").click();
        await settleNavigation(page);
        await page.reload();
        await page.locator(".app-shell[data-navigation-depth]").waitFor();
        assert.equal((await readPlan()).phase, undefined);
        assert.equal((await readPlan()).armed, undefined);
        assert.deepEqual(run.errors, []);
      } catch (error) {
        await writeFile(
          resolve(artifacts, `journey-failure-${colorScheme}-${scale}.json`),
          JSON.stringify(
            await page.evaluate(() => ({
              route: window.__navigation.navigation.route,
              data: window.__navigation.navigation.recalled("search-data"),
              screen: document.querySelector(".navigation-current")?.dataset,
            })),
            null,
            2,
          ),
        );
        await page.screenshot({
          path: resolve(
            artifacts,
            `journey-failure-${colorScheme}-${scale}.png`,
          ),
        });
        throw error;
      } finally {
        await run.context.close();
      }
    }
  for (const colorScheme of ["light", "dark"])
    for (const scale of [1, 1.5, 2]) {
      const run = await open({
          width: 390,
          colorScheme,
          reducedMotion: scale === 2 ? "reduce" : "no-preference",
          time: "2026-10-11T01:00:00Z",
          scenario: { gps: "denied", subwayFeed: feed },
        }),
        { page } = run;
      try {
        await page.evaluate(
          (s) => (document.documentElement.style.fontSize = `${16 * s}px`),
          scale,
        );
        await searchScreen(page);
        await page.locator('[name="time"]').fill("10:06");
        await submitSearch(page);
        await page
          .locator(".navigation-current [data-open-route]")
          .first()
          .waitFor();
        await page
          .locator(".navigation-current [data-previous-departure]")
          .click();
        await page.waitForFunction(() =>
          document
            .querySelector(".navigation-current [data-planner-results]")
            ?.textContent.includes("10:25"),
        );
        assert.match(
          await page
            .locator(".navigation-current .planner-times")
            .first()
            .textContent(),
          /10:05/,
        );
        await layout(page, `previous departure ${colorScheme} ${scale}`);
        await page.screenshot({
          path: resolve(
            artifacts,
            `journey-previous-${colorScheme}-${scale}.png`,
          ),
        });
        await setRide(page, "citybus", true);
        await page
          .locator('.navigation-current [data-navigation-screen="stops"]')
          .click();
        await settleNavigation(page);
        await page
          .locator(".navigation-current .station-name-button")
          .first()
          .click();
        await settleNavigation(page);
        const preview = page.locator(".navigation-current .bus-stop-preview");
        await preview.locator(".arrival-compact strong").first().waitFor();
        assert.ok(
          (await preview.locator(".arrival-compact > div").count()) <= 3,
        );
        await preview.locator('[data-preview-route="204"]').click();
        assert.ok(
          (
            await preview.locator(".arrival-route-badge").allTextContents()
          ).every((text) => text === "204"),
        );
        await layout(page, `bus stop preview ${colorScheme} ${scale}`);
        await page.screenshot({
          path: resolve(
            artifacts,
            `journey-stop-preview-${colorScheme}-${scale}.png`,
          ),
        });
        await preview.locator("[data-open-arrivals]").click();
        await settleNavigation(page);
        await page
          .locator(".navigation-current .arrival-line")
          .first()
          .waitFor();
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "arrivals",
        );
        assert.ok(
          (await page.locator(".navigation-current .arrival-line").count()) >=
            4,
        );
        assert.ok(
          await page
            .locator(".navigation-current .arrival-source")
            .first()
            .textContent(),
        );
        await layout(page, `arrival hierarchy ${colorScheme} ${scale}`);
        await page.screenshot({
          path: resolve(
            artifacts,
            `journey-arrivals-${colorScheme}-${scale}.png`,
          ),
        });
        await backScreen(page);
        assert.equal(
          await preview
            .locator('[data-preview-route="204"]')
            .getAttribute("aria-pressed"),
          "true",
        );
        assert.deepEqual(run.errors, []);
      } finally {
        await run.context.close();
      }
    }
  summary.checks.push(
    "Journey upgrade: departure tap, exact trip selection, downstream connection changes, unreachable earlier connection, preview/cancel, Tab + selected draft reload, Browser Back, full itinerary arm/reload/board/transfer/next ride/explicit end; previous departure and bus stop route chips → all arrivals → Back;390px light/dark 100–200%",
  );
}
