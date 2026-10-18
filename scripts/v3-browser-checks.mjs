import assert from "node:assert/strict";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";

export async function v3RedesignChecks({
  open,
  setRide,
  searchScreen,
  submitSearch,
  backScreen,
  tabRoot,
  settleNavigation,
  layout,
  artifacts,
  summary,
}) {
  const tasks = [];
  const date = "2026-10-11";
  const feed = {
    validDates: [date],
    meta: { operator: "subway", stale: false },
    stops: [
      ["K07", "丸太町"],
      ["K06", "今出川"],
      ["K01", "国際会館"],
    ].map(([id, name]) => ({ id, name })),
    services: [
      {
        id: "v3-subway",
        operator: "subway",
        label: "地下鉄烏丸線",
        category: "local",
        stops: ["K07", "K06", "K01"],
        platforms: ["2", "2", "2"],
        trips: [605, 615, 625, 635].map((m) => ({
          id: `v3-${m}`,
          date,
          arrivals: [m, m + 3, m + 17],
          departures: [m, m + 3, m + 17],
          headsign: "国際会館",
        })),
      },
    ],
  };
  for (const colorScheme of ["light", "dark"])
    for (const scale of [1, 1.5, 2]) {
      const run = await open({
        width: 390,
        height: 844,
        colorScheme,
        time: "2026-10-11T01:00:00Z",
        reducedMotion: scale === 2 ? "reduce" : "no-preference",
        scenario: {
          subwayFeed: feed,
          gps: "active",
          standalone: scale === 1.5,
        },
      });
      const { page } = run;
      const record = async (name) => {
        await layout(page, `v3 ${name} ${colorScheme} ${scale}`);
        const issues = await page.evaluate(() => {
          const root =
            document.querySelector("dialog[open]") ??
            document.querySelector(".navigation-current");
          const out = [];
          for (const e of root.querySelectorAll(
            "button,input:not([type=hidden]),select,.trip-choice-description,.arrival-dest,.arrival-minutes,.suggestion-toolbar",
          )) {
            if (e.closest("[hidden]") || !e.getBoundingClientRect().width)
              continue;
            const r = e.getBoundingClientRect();
            if (
              (!e.closest(".live-quick-destinations") &&
                (r.x < -0.5 || r.right > innerWidth + 0.5)) ||
              e.scrollWidth > e.clientWidth + 1
            )
              out.push({
                name: e.className,
                width: r.width,
                right: r.right,
                scroll: e.scrollWidth,
              });
            const target = e.matches("input[type=checkbox]")
              ? e.closest("label")
              : e;
            if (
              e.matches("button,input,select") &&
              (target.getBoundingClientRect().width < 43.5 ||
                target.getBoundingClientRect().height < 43.5)
            )
              out.push({ small: e.className });
          }
          return out;
        });
        assert.deepEqual(
          issues,
          [],
          `v3 bounds ${name} ${colorScheme} ${scale}`,
        );
        await page.screenshot({
          path: resolve(artifacts, `v3-${name}-${colorScheme}-${scale}.png`),
        });
      };
      try {
        await page.evaluate(
          (s) => (document.documentElement.style.fontSize = `${s * 16}px`),
          scale,
        );
        assert.deepEqual(
          await page.locator(".tab-button span").allTextContents(),
          ["今", "検索", "時刻表", "運行情報", "設定"],
        );
        assert.equal(
          await page
            .locator("[data-open-app-menu],#app-menu-sheet,#quick-journey-form")
            .count(),
          0,
        );
        await record("home");
        // Canonical Search tab and Home share the same input model.
        await searchScreen(page);
        await settleNavigation(page);
        await page.locator("[name=to]").click();
        await page.locator("[data-suggestion-input]").fill("国際会館");
        await record("suggestions");
        await page.locator("#planner-suggestions [data-stop-id=K01]").click();
        await settleNavigation(page);
        await page.locator("[data-search-date]").click();
        await record("date-sheet");
        const initial = await page
          .locator("#search-date")
          .evaluate((e) => e.offsetHeight);
        if (scale === 1) {
          const handle = await page
            .locator("#search-date .sheet-drag-handle")
            .boundingBox();
          await page.mouse.move(
            handle.x + handle.width / 2,
            handle.y + handle.height / 2,
          );
          await page.mouse.down();
          await page.mouse.move(
            handle.x + handle.width / 2,
            handle.y + handle.height / 2 + 20,
          );
          const transform = await page
            .locator("#search-date")
            .evaluate((e) => e.style.transform);
          assert.match(
            transform,
            /translateY\(20px\)/,
            "Sheet follows finger 1:1",
          );
          await page.mouse.up();
        }
        assert.equal(
          await page.locator("#search-date").getAttribute("data-detent"),
          "fit",
        );
        await record("date-fit");
        await page.locator("#search-date [data-search-sheet-done]").click();
        await settleNavigation(page);
        if (scale === 1) {
          await page.evaluate(() => {
            Object.defineProperty(visualViewport, "height", {
              configurable: true,
              value: innerHeight - 320,
            });
            visualViewport.dispatchEvent(new Event("resize"));
          });
          await page.locator("[data-search-date]").click();
          await page.locator("#search-date").evaluate(async (e) => {
            await Promise.allSettled(e.getAnimations().map((a) => a.finished));
          });
          const keyboardSheet = await page
            .locator("#search-date")
            .boundingBox();
          assert.ok(
            keyboardSheet.y >= 0 &&
              keyboardSheet.y + keyboardSheet.height <= 525,
            `date Sheet stays above simulated keyboard ${JSON.stringify(keyboardSheet)}`,
          );
          assert.equal(await page.locator(".tabbar").isVisible(), false);
          await record("date-keyboard");
          await page.locator("#search-date [data-search-sheet-done]").click();
          await page.evaluate(() => {
            delete visualViewport.height;
            visualViewport.dispatchEvent(new Event("resize"));
          });
          await settleNavigation(page);
        }
        await submitSearch(page);
        await page
          .locator(".navigation-current [data-open-route]")
          .first()
          .waitFor();
        await settleNavigation(page);
        await record("results");
        assert.equal(await page.locator(".result-order button").count(), 4);
        await page.locator(".navigation-current [data-result-order=walking]").click();
        assert.equal(
          await page.locator(".navigation-current [data-result-order=walking]").getAttribute("aria-pressed"),
          "true",
          "least-walking sort is interactive and visibly selected",
        );
        assert.ok(
          await page.locator(".navigation-current .route-compared-result").count() > 0,
          "route comparison summaries render without deleting existing route actions",
        );
        // B: one tap performs a real following-departure search.
        await page.locator(".navigation-current [data-next-departure]").click();
        await page
          .locator(".navigation-current .planner-times strong")
          .first()
          .filter({ hasText: "10:15" })
          .waitFor();
        await settleNavigation(page);
        await page
          .locator(".navigation-current [data-result-order=fare]")
          .click();
        assert.equal(
          await page
            .locator(".navigation-current [data-result-order=fare]")
            .getAttribute("aria-pressed"),
          "true",
        );
        // Replacing results for another departure must not add a phantom Back step.
        await backScreen(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "search",
        );
        await submitSearch(page);
        await page
          .locator(".navigation-current [data-open-route]")
          .first()
          .waitFor();
        await settleNavigation(page);
        assert.equal(
          await page
            .locator(".navigation-current [data-result-order=fare]")
            .getAttribute("aria-pressed"),
          "true",
        );
        await page
          .locator(".navigation-current .planner-times strong")
          .first()
          .filter({ hasText: "10:15" })
          .waitFor();
        await settleNavigation(page);
        await page
          .locator(".navigation-current .planner-result")
          .first()
          .click({ position: { x: 25, y: 35 } });
        await settleNavigation(page);
        await record("journey");
        assert.equal(
          await page.locator(".route-actions [data-share-route]").count(),
          1,
        );
        // C: departure -> following official trip; application includes suffix/fare.
        await page.locator('[data-change-leg="0"]').click();
        await page
          .locator("#trip-choice-sheet .trip-choice-row")
          .first()
          .waitFor();
        await record("trip-sheet");
        await page
          .locator("#trip-choice-sheet .trip-choice-row")
          .filter({ hasText: "10:25" })
          .click();
        await page.waitForFunction(
          () => !document.querySelector("#trip-choice-sheet").open,
        );
        await settleNavigation(page);
        assert.equal(
          await page
            .locator(".navigation-current .planner-times strong")
            .nth(1)
            .textContent(),
          "10:42",
        );
        assert.match(
          await page.locator('[data-change-leg="0"]').textContent(),
          /10:25/,
        );
        await record("changed-journey");
        // Preserve Search stack while using timetable, including saved route.
        await page.locator("[data-save-route]").click();
        await tabRoot(page, "timetable");
        await page.locator("[data-timetable-stop=K07]").waitFor();
        await record("timetable-home");
        assert.equal(await page.locator("[data-timetable-line]").count(), 4);
        await page.locator("[data-tab=search]").click();
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "route",
        );
        assert.match(
          await page.locator('[data-change-leg="0"]').textContent(),
          /10:25/,
        );
        await tabRoot(page, "settings");
        await record("other");
        await page.locator("[data-saved-page=routes]").click();
        await settleNavigation(page);
        assert.equal(await page.locator("[data-saved-route]").count(), 1);
        await backScreen(page);
        await page.locator("[data-setting-page=display]").click();
        await settleNavigation(page);
        await page.locator("[data-setting=highContrast]").check();
        await record("high-contrast");
        await page.locator("[data-setting=highContrast]").uncheck();
        await backScreen(page);
        // D/E: actual nearby stop context contains compact 204 then its sheet.
        await tabRoot(page, "now");

        await page.evaluate(() => window.__emitPosition());
        await page
          .locator(".nearby-guide .compact-departures")
          .first()
          .waitFor();
        await record("nearby");
        assert.match(await page.locator("#nearby-panel").textContent(), /204/);
        await page
          .locator(".nearby-row[data-operator=citybus]")
          .first()
          .click();
        await settleNavigation(page);
        await page.locator(".place-sheet .arrival-compact").waitFor();
        await record("stop-sheet");
        assert.ok((await page.locator(".place-map .map-tile").count()) > 0);
        await page.locator('[data-preview-route="204"]').click();
        assert.match(
          await page.locator(".place-sheet .arrival-compact").textContent(),
          /204/,
        );
        await page.locator("[data-save-place]").click();
        await page.locator("[data-open-arrivals]").click();
        await settleNavigation(page);
        const row = page
          .locator(
            "#arrival-live .arrival-line:has(.arrival-approach:not([hidden]))",
          )
          .first();
        await row.waitFor();
        // The overview now shows an observed approach immediately (NOW-07).
        // Expansion still reveals secondary arrivals through the same control.
        assert.equal(await row.locator(".arrival-approach").isVisible(), true);
        await row.locator(".arrival-toggle").click();
        assert.equal(await row.locator(".arrival-approach").isVisible(), true);
        assert.equal(
          await row.locator(".arrival-toggle").getAttribute("aria-expanded"),
          "true",
        );
        await record("arrival-expanded");
        await backScreen(page);
        assert.equal(
          await page.locator("[data-save-place]").getAttribute("aria-pressed"),
          "true",
        );
        await tabRoot(page, "settings");
        await page.locator("[data-saved-page=places]").click();
        await settleNavigation(page);
        assert.equal(await page.locator("[data-saved-place]").count(), 1);
        // F/G: official state is visible at once; ride Hero survives changes.
        await setRide(page, "subway");
        await record("rail");
        assert.ok(await page.locator(".journey-next-name").isVisible());
        assert.ok(await page.locator(".personal-destination").isVisible());
        if (scale === 1) {
          const hero = await page
            .locator(".personal-destination")
            .boundingBox();
          assert.ok(
            hero.y + hero.height < 750,
            "alighting destination is above the tab bar without scrolling",
          );
        }
        await tabRoot(page, "operations");
        await page.locator(".operation-summary").waitFor();
        await record("operations");
        assert.match(
          await page.locator(".operation-summary").textContent(),
          /影響なし/,
        );
        await page.locator("[data-operations-arrivals]").click();
        await settleNavigation(page);
        assert.ok(
          (await page.locator("#arrival-live .arrival-line").count()) > 0,
        );
        await setRide(page, "kyotobus");
        await page.evaluate(() => {
          const { state, tokyoNow } = window.__state;
          const service = state.network.services.find(
            (s) => s.operator === "kyotobus" && s.route === "40",
          );
          const ids = service.stops;
          state.ride = {
            ...state.ride,
            route: "40",
            from: ids[0],
            to: ids.at(-1),
            destination: state.network.stops.get(ids.at(-1)).name,
            officialStops: ids.map((id, i) => ({
              id,
              name: state.network.stops.get(id).name,
              time: tokyoNow().minute - 2 + i * 15,
            })),
          };
          window.__view.renderNow();
        });
        await record("kyoto-bus");
        const heroColors = await page
          .locator(".journey-display")
          .evaluate((e) => {
            const css = getComputedStyle(e);
            return {
              transport: css.getPropertyValue("--transport-color").trim(),
              hero: css.getPropertyValue("--journey-accent").trim(),
            };
          });
        assert.equal(
          heroColors.hero,
          heroColors.transport,
          "visible Hero tint inherits the actual operator in both themes",
        );
        const busColor = await page
          .locator(".journey-display")
          .evaluate((e) =>
            getComputedStyle(e).getPropertyValue("--transport-color").trim(),
          );
        await setRide(page, "citybus");
        await record("city-bus");
        assert.notEqual(
          busColor,
          await page
            .locator(".journey-display")
            .evaluate((e) =>
              getComputedStyle(e).getPropertyValue("--transport-color").trim(),
            ),
        );
        assert.deepEqual(run.errors, []);
        tasks.push({
          colorScheme,
          scale,
          A: {
            taps: 4,
            start:
              "Now, departure Marutamachi, current date, choose destination",
          },
          B: { taps: 1 },
          C: { taps: 2, start: "Route Detail" },
          D: { taps: 0, condition: "fresh GPS, provider data" },
          E: "Stop Sheet route filter",
          F: "official normal route summary",
          G: "next stop and destination visible",
          standalone: scale === 1.5,
        });
      } catch (error) {
        await page.screenshot({
          path: resolve(artifacts, `v3-failure-${colorScheme}-${scale}.png`),
        });
        throw error;
      } finally {
        await run.context.close();
      }
    }
  await writeFile(
    resolve(artifacts, "v3-tasks.json"),
    JSON.stringify(tasks, null, 2),
  );
  summary.checks.push(
    "v3 Tasks A–G: five tabs, one owned search, full-screen suggestions, date/choice detents + finger tracking, 1-tap previous/next, sort, 2-tap exact trip change, saved places/routes, contextual stop map + sheet, expandable stable arrivals, operation status, route colors;390px Light/Dark 100/150/200%, High Contrast, Reduce Motion, browser/standalone",
  );
}
