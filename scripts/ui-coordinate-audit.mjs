import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Coordinate evidence is independent of visual snapshots: rectangles, spacing,
// text bounds and effective hit targets are measured in the browser viewport.
export async function runCoordinateAudit({
  open,
  setRide,
  tabRoot,
  searchScreen,
  submitSearch,
  settleNavigation,
  backScreen,
  artifacts,
  summary,
  baseline = false,
  extended = false,
}) {
  const records = [];
  const cases = extended
    ? [390, 805].flatMap((width) =>
        ["light", "dark"].flatMap((colorScheme) =>
          (width === 390 ? [1, 1.5, 2] : [1]).map((scale) => ({
            width,
            colorScheme,
            scale,
          })),
        ),
      )
    : ["light", "dark"].map((colorScheme) => ({
        width: 390,
        colorScheme,
        scale: 1,
      }));
  await mkdir(artifacts, { recursive: true });
  const date = "2026-10-11";
  const fullFeed = {
    validDates: [date],
    meta: { operator: "subway", stale: false },
    stops: [
      ["K07", "丸太町"],
      ["K06", "今出川"],
      ["K05", "鞍馬口"],
      ["K04", "北大路"],
      ["K01", "国際会館"],
    ].map(([id, name]) => ({ id, name })),
    services: [
      {
        id: "browser-subway",
        operator: "subway",
        label: "地下鉄烏丸線",
        category: "local",
        stops: ["K07", "K06", "K05", "K04", "K01"],
        platforms: ["1", "1", "1", "1", "1"],
        trips: [605, 615, 630].map((m, i) => ({
          id: i === 0 ? "browser-trip" : `audit-${i}`,
          date,
          arrivals: [m, m + 3, m + 5, m + 7, m + 17],
          departures: [m, m + 3, m + 5, m + 7, m + 17],
          headsign: "国際会館",
        })),
      },
    ],
  };
  for (const c of cases) {
    const scenario = {
      initialSettings: { fontScale: c.scale },
      gps: "denied",
      subwayFeed: fullFeed,
      foldEntries: [615, 630, 640].map((depart, i) => ({
        depart,
        category: i % 2 ? "express" : "local",
        destination: "国際会館",
        tripId: `audit-fold-${i}`,
      })),
    };
    const run = await open({
        width: c.width,
        colorScheme: c.colorScheme,
        time: "2026-10-11T01:00:00Z",
        reducedMotion: c.scale === 2 ? "reduce" : "no-preference",
        scenario,
      }),
      { page } = run;
    const capture = async (name) => {
      await settleNavigation(page);
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {})),
        );
      });
      const data = await page.evaluate(() => {
        const rect = (e) => {
          const r = e.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
          };
        };
        const visible = (e) =>
          !!e.getBoundingClientRect().width &&
          !!e.getBoundingClientRect().height &&
          !e.closest("[hidden],[inert]") &&
          ![e, ...ancestors(e)].some((n) => {
            const s = getComputedStyle(n);
            return (
              s.display === "none" ||
              s.visibility === "hidden" ||
              s.opacity === "0"
            );
          });
        function ancestors(e) {
          const out = [];
          for (let p = e.parentElement; p; p = p.parentElement) out.push(p);
          return out;
        }
        const root =
          document.querySelector("dialog[open]") ??
          document.querySelector(".navigation-current");
        const targets = [
          ...root.querySelectorAll(
            "button,input:not([type=hidden]),select,summary",
          ),
        ]
          .filter(visible)
          .map((e) => ({
            tag: e.tagName,
            selector: e.id ? `#${e.id}` : e.className,
            name:
              e.getAttribute("aria-label") ?? e.textContent.trim().slice(0, 90),
            rect: rect(e),
            effective: rect(
              e.matches("input[type=checkbox]") && e.closest("label")
                ? e.closest("label")
                : e,
            ),
          }));
        const spacing = [];
        for (const group of root.querySelectorAll(
          ".screen-action-group,.planner-leg-actions,.search-shortcuts,.map-controls,.route-actions,.planner-place-tools,.live-navigation-capsule,.live-map-actions,.live-direction-segments",
        )) {
          const items = [...group.children].filter(
            (e) => visible(e) && e.matches("button,label"),
          );
          for (let i = 1; i < items.length; i++) {
            const a = rect(items[i - 1]),
              b = rect(items[i]);
            const gap =
              b.y >= a.bottom - 1
                ? b.y - a.bottom
                : b.x >= a.right - 1
                  ? b.x - a.right
                  : -Math.min(a.right - b.x, a.bottom - b.y);
            spacing.push({ group: group.className, gap, first: a, second: b });
          }
        }
        const collisions = [];
        const actions = [
          ...root.querySelectorAll(".primary-action,.secondary-action"),
        ].filter(visible);
        for (let i = 0; i < actions.length; i++)
          for (let j = i + 1; j < actions.length; j++) {
            const a = rect(actions[i]),
              b = rect(actions[j]);
            if (
              a.width &&
              b.width &&
              Math.min(a.right, b.right) - Math.max(a.x, b.x) > 0 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 0
            )
              collisions.push({
                a: actions[i].textContent,
                b: actions[j].textContent,
              });
          }
        const nativeRows = [...root.querySelectorAll(".native-row")]
          .filter(visible)
          .map((row) => {
            const chevron = row.querySelector(".chevron,.chev");
            return {
              label: row.textContent.trim(),
              rect: rect(row),
              chevron: chevron ? rect(chevron) : null,
            };
          });
        const blocks = {};
        for (const selector of [
          ".idle-status",
          ".quick-journey",
          ".quick-search-more",
          ".planner-form",
          ".planner-submit",
          ".planner-result",
          ".route-actions",
          ".context-facts",
          ".nearby-guide",
        ]) {
          const e = root.querySelector(selector);
          if (e) blocks[selector] = { ...rect(e), visible: visible(e) };
        }
        const textOverflow = [
          ...root.querySelectorAll(
            ".native-row b,.planner-leg b,.planner-times strong,.setting-row b,.planner-via-row label>span",
          ),
        ]
          .filter(visible)
          .filter(
            (e) =>
              e.scrollWidth > e.clientWidth + 1 ||
              e.scrollHeight > e.clientHeight + 1,
          )
          .map((e) => ({ text: e.textContent, rect: rect(e) }));
        const button = root.querySelector(
            ".screen-bottom-action [data-arm-route]",
          ),
          bar = document.querySelector(".tabbar"),
          footerTarget =
            button && visible(button)
              ? {
                  rect: rect(button),
                  tabTop: bar && visible(bar) ? rect(bar).y : innerHeight,
                  hit: button.contains(
                    document.elementFromPoint(
                      rect(button).x + rect(button).width / 2,
                      rect(button).y + rect(button).height / 2,
                    ),
                  ),
                }
              : null;
        return {
          footerTarget,
          root: root.id || root.dataset.screen,
          viewport: { width: innerWidth, height: innerHeight },
          targets,
          spacing,
          collisions,
          nativeRows,
          blocks,
          textOverflow,
        };
      });
      const filename = `${name}-${c.width}-${c.colorScheme}-${c.scale}`;
      records.push({ screen: name, ...c, filename, ...data });
      await page.screenshot({ path: resolve(artifacts, `${filename}.png`) });
      if (!baseline) {
        if (data.footerTarget) {
          assert.ok(
            data.footerTarget.rect.bottom <= data.footerTarget.tabTop - 7.5,
            `${filename}: CTA is covered by the tab bar`,
          );
          assert.ok(
            data.footerTarget.hit,
            `${filename}: CTA cannot be tapped at its center`,
          );
        }
        assert.deepEqual(data.collisions, [], `${filename}: action overlap`);
        assert.deepEqual(data.textOverflow, [], `${filename}: label clipping`);
        assert.ok(
          data.targets.every(
            (t) => t.effective.width >= 43.5 && t.effective.height >= 43.5,
          ),
          `${filename}: targets below44px ${JSON.stringify(data.targets.filter((t) => t.effective.width < 43.5 || t.effective.height < 43.5))}`,
        );
        assert.ok(
          data.spacing.every((s) => s.gap >= 7.5),
          `${filename}: action gap below8px ${JSON.stringify(data.spacing.filter((s) => s.gap < 7.5))}`,
        );
        assert.ok(
          data.nativeRows.every(
            (r) => !r.chevron || r.rect.right - r.chevron.right <= 20.5,
          ),
          `${filename}: chevron is not at trailing edge`,
        );
        const hidden = data.blocks[".quick-search-more"];
        if (hidden && !hidden.visible)
          assert.equal(
            hidden.height,
            0,
            `${filename}: collapsed search reserves blank space`,
          );
      }
      summary.layouts++;
    };
    try {
      await page.evaluate(
        (scale) =>
          (document.documentElement.style.fontSize = `${16 * scale}px`),
        c.scale,
      );
      await page.locator("[data-view=now] [data-live-plan]").waitFor();
      await capture("now-home");
      await searchScreen(page);
      await page.locator("[data-search-date]").click();
      await capture("search-date");
      await page.locator("#search-date [data-search-sheet-done]").click();
      await settleNavigation(page);
      await searchScreen(page);
      await capture("search");
      await page.locator("[name=to]").fill("京都");
      await capture("stop-picker");
      if (baseline) await page.locator("[name=to]").blur();
      else {
        await page.keyboard.press("Escape");
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "search",
        );
      }
      await page.locator("[name=to]").fill("国際会館");
      if (baseline) await page.locator("[name=to]").blur();
      else {
        await page.keyboard.press("Escape");
        await settleNavigation(page);
        assert.equal(
          await page.locator(".navigation-current").getAttribute("data-screen"),
          "search",
        );
      }
      await page.locator("[data-add-via]").click();
      await page.locator("[name=via0]").fill("北大路");
      if (baseline) await page.locator("[name=via0]").blur();
      else await page.keyboard.press("Escape");
      await capture("search-via");
      await page.locator("[data-remove-via]").click();
      await page.locator(".planner-conditions").click();
      await capture("search-filter");
      await page.locator("dialog[open] [data-search-sheet-done]").click();
      await settleNavigation(page);
      await submitSearch(page);
      await page
        .locator(".navigation-current [data-open-route]")
        .first()
        .waitFor();
      await capture("search-results");
      await page
        .locator(".navigation-current [data-open-route]")
        .first()
        .click();
      await capture("route-detail");
      await page.locator(".planner-leg-stops summary").first().click();
      await capture("route-stops");
      await setRide(page);
      await capture("rail-ride");
      await page.locator("[data-navigation-screen=stops]").click();
      await capture("rail-stops");
      await page
        .locator(".station-name-button[data-station-detail=K09]")
        .click();
      await capture("station-detail");
      await backScreen(page);
      await backScreen(page);
      await page.locator("[data-context-action=destination]").click();
      await capture("destination-sheet");
      await page.locator("[data-context-close]").click();
      await settleNavigation(page);
      await page.locator(".ride-action-list [data-open-foldback]").click();
      await capture("foldback-home");
      await page.locator("[data-foldback-mode=train]").click();
      await capture("foldback-station");
      await page.locator("#target-station").selectOption("K08");
      await page.locator("[data-load-target-trains]").click();
      await page.locator("[data-target-index]").first().waitFor();
      await capture("foldback-trains");
      await page.locator('[data-target-index="1"]').click();
      await capture("foldback-confirm");
      await page.locator("[data-sheet-close]").click();
      await settleNavigation(page);
      for (const [route, name] of [
        ["map", "ride-map"],
        ["delay", "delay-analysis"],
        ["trains", "live-trains"],
      ]) {
        await page.locator(`[data-navigation-screen=${route}]`).click();
        if (route === "map") await page.locator(".map-controls").waitFor();
        await capture(name);
        await backScreen(page);
      }
      await setRide(page, "citybus");
      await capture("bus-ride");
      await page.locator("[data-navigation-screen=stops]").click();
      await capture("bus-stops");
      await page.locator(".station-name-button").last().click();
      await capture("bus-stop-detail");
      await backScreen(page);
      await backScreen(page);
      await page.locator("[data-navigation-screen=arrivals]").click();
      await page.locator("#arrival-live .arrival-line").first().waitFor();
      await capture("arrivals");
      scenario.foldEntries = undefined;
      await tabRoot(page, "timetable");
      await capture("timetable-home");
      await page.locator("[data-timetable-line=subway]").click();
      await settleNavigation(page);
      await page.locator("[data-timetable-stop=K07]").click();
      await page.locator(".minute-cell").first().waitFor();
      await capture("station-timetable");
      await page.locator(".minute-cell").first().click();
      try {
        await page.locator("#timetable-trip .stop-timeline").waitFor();
      } catch (error) {
        await page.screenshot({
          path: resolve(
            artifacts,
            `timetable-trip-failure-${c.width}-${c.colorScheme}-${c.scale}.png`,
          ),
        });
        throw new Error(
          `${error.message}\nTrip content: ${await page.locator("#timetable-trip").textContent()}\nPage errors: ${JSON.stringify(run.errors)}`,
          { cause: error },
        );
      }
      await capture("timetable-trip");
      await tabRoot(page, "operations");
      await page.locator("[data-operation-id]").first().waitFor();
      await capture("operations");
      await page.locator("[data-operation-id=subway]").click();
      await capture("operation-detail");
      await tabRoot(page, "settings");
      await capture("settings");
      for (const id of ["pass", "distance", "routes", "info"]) {
        await page.locator(`[data-setting-page=${id}]`).click();
        await capture(`settings-${id}`);
        await backScreen(page);
      }
      assert.deepEqual(run.errors, []);
    } finally {
      await writeFile(
        resolve(artifacts, "coordinates.json"),
        JSON.stringify({ baseline, records }, null, 2),
      );
      await run.context.close();
    }
  }
  summary.checks.push(
    baseline
      ? `Baseline coordinate capture: ${new Set(records.map((r) => r.screen)).size} screens; problems recorded without passing geometry assertions`
      : `UI coordinate audit: ${new Set(records.map((r) => r.screen)).size} screens, effective44px targets, standalone action8px gaps, trailing chevrons, no clipped labels, collapsed search has zero layout height`,
  );
}
