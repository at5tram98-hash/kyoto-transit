import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createNetwork } from "../public/js/network.js";

export async function completionChecks({
  open,
  searchScreen,
  submitSearch,
  settleNavigation,
  backScreen,
  layout,
  artifacts,
  summary,
}) {
  const date = "2026-10-11",
    time = `${date}T01:00:00Z`,
    network = createNetwork(
      JSON.parse(
        await readFile(
          new URL("../public/data/bus-catalog.json", import.meta.url),
        ),
      ),
    ),
    stop = (id) => ({ id, name: network.stops.get(id).name }),
    service = (id, stops, starts, offsets, operator = "subway") => ({
      id,
      operator,
      label: id,
      category: "local",
      stops,
      trips: starts.map((minute) => ({
        id: `${id}:${minute}`,
        date,
        arrivals: offsets.map((n) => minute + n),
        departures: offsets.map((n) => minute + n),
        headsign: network.stops.get(stops.at(-1)).name,
      })),
    }),
    rail = {
      validDates: [date],
      meta: { operator: "subway" },
      stops: ["K07", "K06", "K04", "K01"].map(stop),
      services: [
        service(
          "completion-first",
          ["K07", "K06", "K04"],
          [605, 615, 630],
          [0, 3, 7],
        ),
        service("completion-second", ["K04", "K01"], [616, 632, 650], [0, 9]),
      ],
    };
  const shot = async (page, name) => {
    await layout(page, name);
    const collisions = await page.evaluate(() => {
      const issues = [];
      for (const row of document.querySelectorAll(".setting-row:has(select)")) {
        const label = row.querySelector("span")?.getBoundingClientRect(),
          control = row.querySelector("select").getBoundingClientRect();
        if (
          label?.width &&
          label.right > control.left + 1 &&
          label.left < control.right - 1 &&
          label.bottom > control.top + 1 &&
          label.top < control.bottom - 1
        )
          issues.push("setting label and selector overlap");
      }
      const tabs = [...document.querySelectorAll(".tab-button span")].map(
        (node) => node.getBoundingClientRect(),
      );
      for (let i = 1; i < tabs.length; i++)
        if (tabs[i].left - tabs[i - 1].right < 8)
          issues.push("tab label gap smaller than 8px");
      for (const node of document.querySelectorAll(
        ".place-label,.route-rank",
      )) {
        const box = node.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const text = range.getBoundingClientRect();
        if (
          text.left < box.left + 2 ||
          text.right > box.right - 2 ||
          text.top < box.top - 1 ||
          text.bottom > box.bottom + 1
        )
          issues.push(`clipped label: ${node.textContent}`);
      }
      for (const node of document.querySelectorAll(".departure-neighbor")) {
        if (!node.getBoundingClientRect().width) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if (range.getClientRects().length > 1)
          issues.push(`split departure action: ${node.textContent}`);
      }
      return issues;
    });
    assert.deepEqual(collisions, [], name);
    await page.screenshot({
      path: resolve(artifacts, `${name}.png`),
      animations: "disabled",
    });
  };
  for (const colorScheme of ["light", "dark"])
    for (const scale of [1, 1.5, 2]) {
      const run = await open({
          width: 390,
          height: 844,
          time,
          colorScheme,
          reducedMotion: scale === 2 ? "reduce" : "no-preference",
          scenario: {
            gps: "denied",
            subwayFeed: rail,
            initialSettings: {
              locale: "en",
              fontScale: scale,
              autoDetect: false,
            },
          },
        }),
        { page } = run,
        prefix = `completion-en-${colorScheme}-${scale}`;
      try {
        assert.equal(await page.locator("html").getAttribute("lang"), "en");
        assert.equal(
          await page.locator('[data-tab="search"]').textContent(),
          "Search",
        );
        assert.match(
          await page.locator("[data-live-stop-search]").textContent(),
          /Search stations/,
        );
        if (colorScheme === "light" && scale === 1) {
          const quick = page.locator(".live-quick-destinations");
          const before = await quick.evaluate((el) => el.scrollLeft);
          await page.clock.fastForward(2000);
          await page.waitForFunction(
            (value) =>
              document.querySelector(".live-quick-destinations").scrollLeft >
              value,
            before,
          );
          // A wheel with deltaX scrolls natively in WebKit after dispatch;
          // pointerdown tests cancellation without requesting a manual scroll.
          await quick.dispatchEvent("pointerdown", { pointerType: "touch" });
          const stopped = await quick.evaluate((el) => el.scrollLeft);
          await page.clock.fastForward(3000);
          await page.waitForTimeout(100);
          assert.equal(
            await quick.evaluate((el) => el.scrollLeft),
            stopped,
            "interaction stops the optional native auto-scroll",
          );
        }
        if (colorScheme === "dark" && scale === 2) {
          const quick = page.locator(".live-quick-destinations"),
            before = await quick.evaluate((el) => el.scrollLeft);
          await page.clock.fastForward(2000);
          await page.waitForTimeout(100);
          assert.equal(
            await quick.evaluate((el) => el.scrollLeft),
            before,
            "Reduce Motion disables auto-scroll",
          );
        }
        await shot(page, `${prefix}-live`);
        await searchScreen(page);
        await page.locator('[name="from"]').fill("Marutamachi");
        await page.locator('#planner-suggestions [data-stop-id="K07"]').click();
        await page.locator('[name="to"]').fill("Kokusaikaikan");
        await page.locator('#planner-suggestions [data-stop-id="K01"]').click();
        await shot(page, `${prefix}-search`);
        await submitSearch(page);
        await page
          .locator(".navigation-current [data-open-route]")
          .first()
          .waitFor();
        assert.match(
          await page
            .locator(".navigation-current [data-result-date]")
            .textContent(),
          /Oct/,
        );
        await shot(page, `${prefix}-results`);
        await page
          .locator(".navigation-current [data-open-route]")
          .first()
          .click();
        await settleNavigation(page);
        assert.match(
          await page.locator("#view-title").textContent(),
          /Journey details/,
        );
        assert.equal(
          await page
            .locator(".navigation-current .journey-station-button")
            .first()
            .evaluate((el) => {
              const range = document.createRange();
              range.selectNodeContents(el.firstChild);
              return range.getClientRects().length;
            }),
          1,
          "the station name Marutamachi must remain readable on one line",
        );
        await shot(page, `${prefix}-journey`);
        await page
          .locator(".navigation-current .screen-bottom-action [data-arm-route]")
          .first()
          .click();
        await settleNavigation(page);
        await page.locator(".navigation-current [data-board-armed]").click();
        await settleNavigation(page);
        const currentTrip = await page.evaluate(
          () => window.__state.state.ride.tripId,
        );
        await page.locator(".navigation-current [data-open-itinerary]").click();
        await settleNavigation(page);
        const future = page.locator(".navigation-current [data-change-leg]");
        assert.equal(
          await future.count(),
          1,
          "the current ride is locked; only a future ride is editable",
        );
        const before = await page.evaluate(() =>
          window.__state.state.itinerary.rides
            .filter(Boolean)
            .map((r) => r.tripId),
        );
        await future.click();
        await page
          .locator(
            "#trip-choice-sheet [data-trip-choice]:not(.selected):not(:disabled)",
          )
          .first()
          .waitFor();
        await shot(page, `${prefix}-future-services`);
        await page
          .locator(
            "#trip-choice-sheet [data-trip-choice]:not(.selected):not(:disabled)",
          )
          .first()
          .click();
        await page.waitForFunction(
          (old) =>
            window.__state.state.itinerary.rides.filter(Boolean).at(-1)
              .tripId !== old,
          before.at(-1),
        );
        await settleNavigation(page);
        assert.equal(
          await page.evaluate(() => window.__state.state.ride.tripId),
          currentTrip,
        );
        assert.equal(
          await page.evaluate(() => window.__state.state.itinerary.phase),
          "riding",
        );
        await shot(page, `${prefix}-future-updated`);
        await page.locator('[data-tab="operations"]').click();
        await settleNavigation(page);
        await page.locator('[data-operation-id="citybus"]').click();
        await settleNavigation(page);
        const save = page.locator(
          '.navigation-current [data-operation-save="citybus"]',
        );
        await save.click();
        assert.equal(await save.getAttribute("aria-pressed"), "true");
        await shot(page, `${prefix}-service-detail`);
        await backScreen(page);
        assert.match(
          await page.locator(".navigation-current").textContent(),
          /Saved routes/,
        );
        assert.equal(
          await page
            .locator('.navigation-current [data-operation-id="citybus"]')
            .count(),
          1,
        );
        await shot(page, `${prefix}-saved-services`);
        await page.locator('[data-tab="settings"]').click();
        await settleNavigation(page);
        await page.locator('[data-setting-page="display"]').click();
        await settleNavigation(page);
        await shot(page, `${prefix}-settings`);
        if (colorScheme === "light" && scale === 1) {
          await page
            .locator('[data-setting-value="locale"]')
            .selectOption("ja");
          await page.waitForFunction(
            () =>
              document.documentElement.lang === "ja" &&
              document.querySelector('[data-tab="search"]')?.textContent ===
                "検索",
          );
          await page.locator(".app-shell[data-navigation-depth]").waitFor();
          assert.equal(
            await page.evaluate(async () => {
              const query = new URL(
                document.querySelector('script[type="module"]').src,
              ).search;
              window.__state = await import(
                new URL(`js/vnext-state.js${query}`, location.href)
              );
              return window.__state.state.ride?.tripId;
            }),
            currentTrip,
            "language reload preserves the current ride",
          );
          assert.deepEqual(
            await page.evaluate(
              () => window.__state.settings.favoriteOperations,
            ),
            ["citybus"],
          );
        }
        assert.deepEqual(run.errors, []);
      } finally {
        await run.context.close();
      }
    }
  const cityFrom = network.busIds.get("烏丸丸太町"),
    cityTo = network.busIds.get("京都駅前"),
    altRail = {
      validDates: [date],
      meta: { operator: "subway" },
      stops: ["K07", "K11"].map(stop),
      services: [service("avoid-rail", ["K07", "K11"], [605], [0, 7])],
    },
    altBus = {
      validDates: [date],
      meta: { operator: "citybus" },
      stops: [cityFrom, cityTo].map(stop),
      services: [
        {
          ...service(
            "avoid-bus",
            [cityFrom, cityTo],
            [610, 625],
            [0, 20],
            "citybus",
          ),
          route: "206",
        },
      ],
    },
    run = await open({
      time,
      scenario: {
        gps: "denied",
        subwayFeed: altRail,
        subwayOperationStatus: "suspended",
        staticFeeds: { [`citybus:${date}`]: altBus },
        initialSettings: { autoDetect: false },
      },
    }),
    { page } = run;
  try {
    await searchScreen(page);
    await page.locator('[name="to"]').fill("京都");
    await page.locator('#planner-suggestions [data-stop-id="K11"]').click();
    await submitSearch(page);
    await page.locator(".navigation-current [data-open-route]").first().click();
    await settleNavigation(page);
    await page
      .locator(".navigation-current .screen-bottom-action [data-arm-route]")
      .first()
      .click();
    await settleNavigation(page);
    const armed = await page.evaluate(
      () => window.__state.state.armedJourney.ride.tripId,
    );
    await page.locator('[data-tab="operations"]').click();
    await settleNavigation(page);
    await page.locator("[data-operations-replan]").click();
    await page
      .locator(".navigation-current [data-open-route]")
      .first()
      .waitFor();
    assert.ok(
      !(await page.locator('[name="operators"]').inputValue())
        .split(",")
        .includes("subway"),
    );
    await page.locator(".navigation-current [data-open-route]").first().click();
    await settleNavigation(page);
    assert.equal(
      await page
        .locator('.navigation-current .journey-ride[data-operator="subway"]')
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator('.navigation-current .journey-ride[data-operator="citybus"]')
        .count(),
      1,
    );
    assert.equal(
      await page.evaluate(() => window.__state.state.armedJourney.ride.tripId),
      armed,
    );
    await shot(page, "completion-disruption-avoided");
    await backScreen(page);
    await backScreen(page);
    assert.equal(
      await page.locator('[name="operators"]').inputValue(),
      "kintetsu,citybus,kyotobus",
    );
    assert.deepEqual(run.errors, []);
  } finally {
    await run.context.close();
  }
  const unknown = await open({
    time,
    scenario: {
      gps: "denied",
      subwayFeed: rail,
      initialSettings: { locale: "en", autoDetect: false },
    },
  });
  try {
    const { page } = unknown;
    await searchScreen(page);
    await submitSearch(page);
    await page.locator(".navigation-current [data-open-route]").first().click();
    await settleNavigation(page);
    await page
      .locator(".navigation-current .screen-bottom-action [data-arm-route]")
      .click();
    await settleNavigation(page);
    await page.locator(".navigation-current [data-board-armed]").click();
    await settleNavigation(page);
    const id = await page.evaluate(() => {
      const { state } = window.__state;
      for (const stop of state.ride.officialStops)
        stop.time = stop.arrival = stop.departure = null;
      window.__view.renderNow();
      return state.itinerary.id;
    });
    await page.locator('[data-tab="operations"]').click();
    await settleNavigation(page);
    await page.locator('[data-operation-id="citybus"]').click();
    await settleNavigation(page);
    await page.locator('[data-operation-avoid="citybus"]').click();
    await settleNavigation(page);
    assert.equal(
      await page.locator('[data-tab="search"]').getAttribute("aria-current"),
      "page",
    );
    assert.match(
      await page.locator("#search-inline-status").textContent(),
      /Confirm a departure time after you alight/,
    );
    const recoveryOrigin = await page.locator('[name="fromId"]').inputValue();
    assert.equal(
      await page.locator('[name="from"]').inputValue(),
      network.stops.get(recoveryOrigin).en,
    );
    assert.equal(
      await page.locator(".navigation-current [data-open-route]").count(),
      0,
    );
    assert.equal(
      await page.evaluate(() => window.__state.state.itinerary.id),
      id,
    );
    assert.equal(
      await page.evaluate(() => window.__state.state.itinerary.phase),
      "riding",
    );
    await shot(page, "completion-unknown-arrival-review");
    // The normal form remains usable once the rider explicitly chooses search.
    await page.locator("#planner-form .planner-submit").click();
    await page
      .locator(".navigation-current [data-open-route]")
      .first()
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.__state.state.itinerary.id),
      id,
    );
    assert.deepEqual(unknown.errors, []);
  } finally {
    await unknown.context.close();
  }
  const recovery = await open({
    time,
    scenario: {
      gps: "denied",
      subwayFeed: rail,
      initialSettings: { autoDetect: false },
    },
  });
  try {
    const { page } = recovery;
    await searchScreen(page);
    await submitSearch(page);
    await page.locator(".navigation-current [data-open-route]").first().click();
    await settleNavigation(page);
    await page
      .locator(".navigation-current .screen-bottom-action [data-arm-route]")
      .click();
    await settleNavigation(page);
    await page.locator(".navigation-current [data-board-armed]").click();
    await settleNavigation(page);
    await page
      .locator('.navigation-current [data-context-action="destination"]')
      .click();
    await page.locator("#personal-stop").selectOption("K06");
    await page.locator("[data-save-destination]").click();
    await settleNavigation(page);
    await page.clock.setSystemTime(new Date(`${date}T01:10:00Z`));
    await page.locator(".navigation-current [data-open-itinerary]").click();
    await settleNavigation(page);
    assert.equal(await page.locator("[data-itinerary-recover]").count(), 1);
    await shot(page, "completion-changed-destination");
    await page.locator(".navigation-current [data-itinerary-next]").click();
    await page
      .locator(".navigation-current [data-open-route]")
      .first()
      .waitFor();
    assert.equal(await page.locator('[name="fromId"]').inputValue(), "K06");
    assert.equal(await page.locator('[name="toId"]').inputValue(), "K01");
    assert.equal(await page.evaluate(() => window.__state.state.ride), null);
    await shot(page, "completion-onward-recalculated");
    assert.deepEqual(recovery.errors, []);
  } finally {
    await recovery.context.close();
  }
  const tomorrow = "2026-10-12",
    nightTrip = service("night-first", ["K07", "K04"], [1435], [0, 7]),
    tomorrowService = service("night-connection", ["K04", "K01"], [5], [0, 9]);
  tomorrowService.trips.forEach((trip) => {
    trip.date = tomorrow;
  });
  const night = await open({
    time: `${date}T14:50:00Z`,
    scenario: {
      gps: "denied",
      initialSettings: { autoDetect: false },
      staticFeeds: {
        [`subway:${date}`]: {
          validDates: [date],
          meta: { operator: "subway" },
          stops: ["K07", "K04"].map(stop),
          services: [nightTrip],
        },
        [`subway:${tomorrow}`]: {
          validDates: [tomorrow],
          meta: { operator: "subway" },
          stops: ["K04", "K01"].map(stop),
          services: [tomorrowService],
        },
      },
    },
  });
  try {
    const { page } = night;
    await searchScreen(page);
    await submitSearch(page);
    await page
      .locator(".navigation-current [data-open-route]")
      .first()
      .waitFor();
    const legs = await page.evaluate(() =>
      window.__navigation.navigation
        .recalled("search-data")
        .at(-1)
        .routes[0].legs.filter((l) => l.kind === "ride"),
    );
    assert.deepEqual(
      legs.map((l) => l.serviceDate),
      [date, tomorrow],
    );
    assert.equal(legs[1].depart, 1445);
    await page.locator(".navigation-current [data-open-route]").first().click();
    await settleNavigation(page);
    await shot(page, "completion-midnight-connection");
    assert.deepEqual(night.errors, []);
  } finally {
    await night.context.close();
  }
  summary.checks.push(
    "Completion flows: English Live/search/results/journey/future trip edits/service details/saved lines/settings at 390px light/dark 100–200%, official English station aliases, language reload preserving the active ride, current-ride lock, real planner excludes a suspended operator and finds the bus alternative without replacing the armed journey until selection",
  );
  summary.checks.push(
    "Recovery and midnight: explicitly alighting at a changed destination launches a genuine onward search from that stop without inferring boarding; initial late-night search joins the following day's official connection and retains both original service dates",
  );
  summary.checks.push(
    "Unknown onboard arrival: show departure-time confirmation instead of automatically searching from the current time; preserve the current ride and permit an explicit manual search",
  );
}
