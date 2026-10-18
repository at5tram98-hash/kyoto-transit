import assert from "node:assert/strict";

// Quality audit: D-1–D-3 as one journey across responsive breakpoints.
// This is complementary to the large pre-existing regression suite.
export async function dQualityChecks({ open, settleNavigation, summary }) {
  for (const variant of [
    { width: 390, height: 844, colorScheme: "light", scale: 1 },
    { width: 390, height: 844, colorScheme: "dark", scale: 2 },
    { width: 768, height: 1024, colorScheme: "light", scale: 1.5 },
    { width: 1024, height: 800, colorScheme: "light", scale: 1 },
    { width: 1280, height: 860, colorScheme: "dark", scale: 2 },
  ]) {
    const run = await open({
      ...variant,
      reducedMotion: variant.scale === 2 ? "reduce" : "no-preference",
      scenario: { gps: "denied" },
    });
    try {
      const { page, errors } = run;
      const desktop = variant.width >= 1024;
      const geometry = async () => page.evaluate(() => {
        const app = document.querySelector(".navigation-app");
        const nav = document.querySelector(".tabbar");
        const main = document.querySelector(".navigation-app main");
        const tabs = [...nav.querySelectorAll(".tab-button")].map(el => ({
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
        }));
        const n = nav.getBoundingClientRect();
        const m = main.getBoundingClientRect();
        return {display: getComputedStyle(app).display,
          nav: {left:n.left,right:n.right,top:n.top,bottom:n.bottom},
          main: {left:m.left,right:m.right,top:m.top,bottom:m.bottom},
          overflow: document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
          tabs,
        };
      });
      await page.locator('[data-tab="settings"]').click();
      await settleNavigation(page);
      const groups = await page.locator("[data-settings-group]").evaluateAll(nodes =>
        nodes.map(n => n.dataset.settingsGroup));
      assert.deepEqual(groups, ["transit","experience","saved","about"]);
      for (const id of [
        "pass","distance","auto","routes","notifications","location",
        "display","accessibility","info","privacy","terms","advanced","permissions",
      ]) {
        assert.equal(await page.locator(`[data-setting-page="${id}"]`).count(), 1,
          `D settings reachable: ${id}`);
      }
      assert.equal(await page.locator("[data-saved-page]").count(), 2);
      const rowHeights = await page.locator("[data-settings-group] .native-row").evaluateAll(
        rows => rows.map(row => row.getBoundingClientRect().height));
      assert.ok(rowHeights.length >= 10 && rowHeights.every(height => height >= 44),
        "D-5 Settings rows must remain readable and touchable");
      await page.locator('[data-setting-page="accessibility"]').click();
      await settleNavigation(page);
      const textSize = page.locator('[data-setting-value="fontScale"]');
      await textSize.selectOption(String(variant.scale));
      assert.equal(await textSize.inputValue(), String(variant.scale));
      await page.locator('[data-setting="highContrast"]').check();
      assert.equal(
        await page.locator("html").getAttribute("data-high-contrast"), "true",
      );
      await page.locator('[data-setting="reduceMotion"]').check();
      assert.equal(
        await page.locator("html").getAttribute("data-reduce-motion"), "true",
      );
      await page.locator('[data-navigation-back]').click();
      await settleNavigation(page);
      if (desktop) {
        const active = async () =>
          page.locator(".tab-button.active").getAttribute("data-tab");
        await page.locator('[data-tab="settings"]').focus();
        await page.keyboard.press("ArrowUp");
        await settleNavigation(page);
        assert.equal(await active(), "operations", "D-4 ArrowUp opens the preceding tab");
        await page.keyboard.press("ArrowDown");
        await settleNavigation(page);
        assert.equal(await active(), "settings");
        await page.keyboard.press("Home");
        await settleNavigation(page);
        assert.equal(await active(), "now");
        await page.keyboard.press("End");
        await settleNavigation(page);
        assert.equal(await active(), "settings");
      } else {
        await page.locator('[data-tab="settings"]').focus();
        await page.keyboard.press("ArrowUp");
        assert.equal(await page.locator(".tab-button.active").getAttribute("data-tab"),
          "settings", "D-4 must not replace mobile keyboard behavior");
      }
      const homeGeometry = await geometry();
      assert.equal(homeGeometry.display, desktop ? "grid" : "flex");
      assert.ok(homeGeometry.overflow <= 1,
        `No viewport horizontal overflow ${JSON.stringify(variant)}: ${JSON.stringify(homeGeometry)}`);
      assert.ok(homeGeometry.tabs.every(t => t.width >= 43.5 && t.height >= 43.5));
      if(desktop) {
        assert.ok(homeGeometry.nav.right <= homeGeometry.main.left+2,
          "desktop rail must not overlap the content column");
      } else {
        assert.ok(homeGeometry.nav.top >= homeGeometry.main.top + 240,
          "mobile/tablet navigation must remain near the bottom");
      }
      await page.locator('[data-tab="search"]').click();
      await settleNavigation(page);
      assert.ok(await page.locator("#planner-form .planner-submit").isVisible());
      await page.locator('[data-tab="timetable"]').click();
      await settleNavigation(page);
      await page.locator('[data-tab="operations"]').click();
      await settleNavigation(page);
      await page.locator('[data-tab="now"]').click();
      await settleNavigation(page);
      assert.equal(await page.locator(".navigation-current").count(), 1);
      assert.deepEqual(errors, []);
      summary.checks.push(
        `D quality ${variant.width}px ${variant.colorScheme} scale=${variant.scale}; hierarchy, touch sizes, contrast, motion, tabs, overflow`,
      );
    } finally {
      await run.context.close();
    }
  }
}
