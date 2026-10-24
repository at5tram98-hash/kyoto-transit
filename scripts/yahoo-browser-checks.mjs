import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function yahooScreenChecks({
  open,
  settleNavigation,
  layout,
  artifacts,
  summary,
}) {
  for (const colorScheme of ["light", "dark"])
    for (const scale of [1, 1.5, 2]) {
      const run = await open({
        width: 390,
        height: 844,
        colorScheme,
        time: "2026-10-11T01:00:00Z",
        reducedMotion: scale === 2 ? "reduce" : "no-preference",
      });
      const { page } = run;
      try {
        await page.evaluate(
          (s) => (document.documentElement.style.fontSize = `${s * 16}px`),
          scale,
        );
        await page.locator("[data-live-full-map]").waitFor();
        assert.equal(
          await page.locator("#now-search form").count(),
          0,
          "Live does not duplicate the planner",
        );
        assert.equal(
          await page.locator("#planner-form").count(),
          1,
          "one canonical search form",
        );
        assert.equal(await page.locator("#view-title").textContent(), "今");
        await layout(page, `Live ${colorScheme} ${scale}`);
        await page.screenshot({
          path: resolve(artifacts, `live-home-${colorScheme}-${scale}.png`),
          animations: "disabled",
        });
        assert.equal(await page.locator("[data-clock-format]").count(), 0, "clock format control was removed from Now");
        await page.evaluate(() => {window.__state.settings.hour12 = true; window.__view.renderNow();});
        assert.match(await page.locator("[data-live-clock]").textContent(), /AM|PM|午前|午後/);
        await page.evaluate(() => {window.__state.settings.hour12 = false; window.__view.renderNow();});

        assert.equal(
          await page.locator(".live-map-host .map-controls").count(),
          0,
        );
        assert.ok((await page.locator(".live-map-host .map-tile").count()) > 0);
        await page.locator("[data-live-stop-search]").click();
        await page.locator(".live-stop-input input").fill("丸太町");
        await page.locator("[data-live-stop=K07]").click();
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "nearby",
        );
        await page.locator("[data-navigation-back]").click();
        await settleNavigation(page);
        await page.locator(".live-navigation-capsule [data-quick-open]").click();
        await page.locator("#context-sheet[open] [data-quick-destination=K01]").click();
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-view"),
          "search",
        );
        assert.equal(await page.locator("[name=to]").inputValue(), "国際会館");
        if (scale === 1) {
          await page.reload();
          await page.locator("#planner-form").waitFor();
          await settleNavigation(page);
          assert.equal(
            await page.locator("[name=to]").inputValue(),
            "国際会館",
            "Quick Select draft survives reload before search",
          );
        }
        await page.locator("#planner-form .planner-submit").click();
        await page
          .locator(".navigation-current [data-open-route]")
          .first()
          .waitFor();
        await settleNavigation(page);
        await layout(page, `Yahoo results ${colorScheme} ${scale}`);
        await page.screenshot({
          path: resolve(artifacts, `yahoo-results-${colorScheme}-${scale}.png`),
          animations: "disabled",
        });
        assert.equal(
          Number(
            await page
              .locator(".navigation-current")
              .getAttribute("data-search-revision"),
          ),
          1,
          "one results push retains search revision",
        );
        await page
          .locator(".navigation-current [data-result-order=fare] span")
          .click();
        assert.equal(
          await page
            .locator(".navigation-current [data-result-order=fare]")
            .getAttribute("aria-pressed"),
          "true",
        );
        await page.locator(".navigation-current [data-edit-date]").click();
        const previous = await page
          .locator("#search-date [name=time]")
          .inputValue();
        await page.locator("#search-date [name=time]").fill("11:00");
        await page.locator("#search-date h2").click();
        await page.keyboard.press("Escape");
        await page.locator("#search-date").waitFor({ state: "hidden" });
        await settleNavigation(page);
        assert.equal(
          await page.locator("#search-date [name=time]").inputValue(),
          previous,
          "dismiss restores the date draft",
        );
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "results",
        );
        await page.locator(".navigation-current [data-edit-date]").click();
        await page.locator("#search-date [name=time]").fill("10:01");
        await page.locator("#search-date [data-search-sheet-done]").click();
        await page.waitForFunction(() =>
          document
            .querySelector(".navigation-current [data-result-clock]")
            ?.textContent.includes("10:01"),
        );
        await settleNavigation(page);
        await page
          .locator(".navigation-current [data-open-route]")
          .first()
          .click();
        await settleNavigation(page);
        await layout(page, `Yahoo detail ${colorScheme} ${scale}`);
        await page.screenshot({
          path: resolve(artifacts, `yahoo-detail-${colorScheme}-${scale}.png`),
          animations: "disabled",
        });
        const downloadPromise = page.waitForEvent("download");
        await page.locator(".navigation-current [data-route-more]").click();
        await page.locator("#context-sheet [data-export-route]").click();
        const download = await downloadPromise;
        const png = await readFile(await download.path());
        assert.equal(png.subarray(1, 4).toString(), "PNG");
        assert.equal(png.readUInt32BE(16), 1520, "real route PNG width");
        await page
          .locator(".navigation-current [data-route-stop]")
          .first()
          .click();
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "nearby",
        );
        await page.locator("[data-navigation-back]").click();
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "route",
        );
        await page.locator('[data-tab="now"]').click();
        await settleNavigation(page);
        assert.equal(
          await page.locator("[name=to]").inputValue(),
          "国際会館",
          "Search tab uses the same draft",
        );
        await page.locator('[data-tab="search"]').click();
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "route",
          "Search keeps its detail stack across tabs",
        );
        await page.locator("[data-navigation-back]").click();
        await settleNavigation(page);
        assert.match(
          await page
            .locator(".navigation-current [data-result-clock]")
            .textContent(),
          /10:01/,
        );
        await page.locator("[data-navigation-back]").click();
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-view"),
          "search",
        );
        assert.equal(await page.locator("[name=to]").inputValue(), "国際会館");
        assert.equal(await page.locator("[name=time]").inputValue(), "10:01");
        assert.deepEqual(run.errors, []);
      } finally {
        await run.context.close();
      }
    }
  summary.checks.push(
    "Live/Search separation: one search model, Quick Select, stop-only search, clock, independent Search results/detail, nested sort taps, date cancel/apply, real PNG, station detail/Back, tab stack/draft retention;390px Light/Dark 100/150/200%",
  );
}
