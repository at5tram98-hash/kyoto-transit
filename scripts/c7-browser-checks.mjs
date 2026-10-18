import assert from "node:assert/strict";

// Focused C-7 operation test. Uses the shared browser fixture, navigation,
// and real event handlers. Never treats absence of data as a found itinerary.
export async function c7BrowserChecks({ open, searchScreen, submitSearch, settleNavigation, summary }) {
  const date = "2026-10-11";
  const emptyFeed = {
    validDates: [date], meta: { operator: "subway", stale: false },
    stops: [], services: [],
  };
  for (const mode of ["light", "dark"]) {
    const test = await open({
      width: 390, height: 844, colorScheme: mode,
      time: "2026-10-11T01:00:00Z",
      scenario: { gps: "denied", subwayFeed: emptyFeed },
    });
    try {
      const { page, errors } = test;
      await searchScreen(page);
      await submitSearch(page);
      const result = page.locator(".navigation-current");
      const editDate = result.locator('[data-c6-recovery="date"]');
      await editDate.waitFor({ timeout: 20000 });
      assert.equal(await result.locator(".planner-result").count(), 0);
      assert.equal(await result.locator('[data-c6-recovery="via"]').count(), 0);
      assert.equal(await result.locator('[data-c6-recovery="filters"]').count(), 1);
      for (const [selector, dialog] of [
        ['[data-c6-recovery="date"]', "#search-date"],
        ['[data-c6-recovery="filters"]', "#search-filter"],
      ]) {
        await result.locator(selector).click();
        await page.locator(dialog).waitFor({state: "visible"});
        await page.locator(`${dialog} [data-search-sheet-cancel]`).click();
        await settleNavigation(page);
        assert.equal(await result.locator(".planner-result").count(), 0);
      }
      assert.deepEqual(errors, [], `C-7 page errors (${mode})`);
      summary.checks.push(`C-7 empty-route explicit recovery, dialogs, preserved no-route state (${mode})`);
    } finally {
      await test.context.close();
    }
  }
}
