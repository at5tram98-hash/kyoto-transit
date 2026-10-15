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
        await page.locator("[data-home-submit]").waitFor();
        await page.waitForFunction(() =>
          document
            .querySelector('[data-home-value="from"]')
            .textContent.includes("丸太町"),
        );
        assert.equal(
          await page.locator("#planner-form").count(),
          1,
          "one canonical search form",
        );
        await layout(page, `Yahoo home ${colorScheme} ${scale}`);
        await page.screenshot({
          path: resolve(artifacts, `yahoo-home-${colorScheme}-${scale}.png`),
          animations: "disabled",
        });
        await page.locator('[data-home-field="to"]').click();
        await page.locator("[data-suggestion-input]").fill("国際会館");
        await page.locator('#planner-suggestions [data-stop-id="K01"]').click();
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-view"),
          "now",
        );
        assert.equal(await page.locator("[name=to]").inputValue(), "国際会館");
        assert.equal(
          await page.locator("[data-home-value=to]").textContent(),
          "国際会館",
        );
        if (scale === 1) {
          await page.reload();
          await page.locator("[data-home-submit]").waitFor();
          await settleNavigation(page);
          assert.equal(
            await page.locator("[name=to]").inputValue(),
            "国際会館",
            "Home draft survives reload before submitting",
          );
          assert.equal(
            await page.locator("[data-home-value=to]").textContent(),
            "国際会館",
          );
        }
        await page.locator("[data-home-submit]").click();
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
        await page.locator(".navigation-current [data-export-route]").click();
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
        await page.locator('[data-tab="search"]').click();
        await settleNavigation(page);
        assert.equal(
          await page.locator("[name=to]").inputValue(),
          "国際会館",
          "Search tab uses the same draft",
        );
        await page.locator('[data-tab="now"]').click();
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "route",
          "Now keeps its detail stack across tabs",
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
          "now",
        );
        assert.equal(await page.locator("[name=to]").inputValue(), "国際会館");
        assert.equal(await page.locator("[name=time]").inputValue(), "10:01");
        assert.deepEqual(run.errors, []);
      } finally {
        await run.context.close();
      }
    }
  summary.checks.push(
    "Yahoo screen alignment: one search model, direct Now results/detail, nested sort taps, date cancel/apply, real PNG, station detail/Back, tab stack/draft retention;390px Light/Dark 100/150/200%",
  );
}
