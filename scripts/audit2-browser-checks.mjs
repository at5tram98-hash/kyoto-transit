import assert from "node:assert/strict";
import { resolve } from "node:path";
export async function audit2Checks({
  open,
  layout,
  settleNavigation,
  artifacts,
  summary,
}) {
  const date = "2026-10-11";
  const makeFeed = (operator, defs) => ({
    validDates: [date],
    meta: { operator, stale: false },
    services: defs.map(([id, stops, times, headsign]) => ({
      id,
      operator,
      category: "local",
      stops,
      trips: [{ id, date, headsign, departures: times, arrivals: times }],
    })),
  });
  const subway = makeFeed("subway", [
    ["subway-south", ["K01", "K07", "K15"], [600, 615, 630], "竹田"],
    ["subway-north", ["K15", "K07", "K01"], [610, 625, 640], "国際会館"],
  ]);
  const rail = makeFeed("kintetsu", [
    ["rail-south", ["B01", "K15", "B07", "B26"], [600, 610, 614, 650], "西"],
    ["rail-north", ["B26", "B07", "K15", "B01"], [590, 608, 615, 625], "京都"],
  ]);
  if (process.env.AUDIT_BEFORE === "1") {
    for(const width of [390,546]) for(const colorScheme of ["light","dark"]) {
      const run=await open({width,colorScheme,time:'2026-10-11T01:07:00Z',scenario:{gps:'denied',subwayFeed:subway,staticFeeds:{['kintetsu:'+date]:rail},initialSettings:{autoDetect:false},failBoard:true}});
      const {page}=run;
      try {
        await page.screenshot({path:resolve(artifacts,`before-${width}-${colorScheme}-home.png`)});
        for(const id of ['K07','B07','K15','ksu','bus-223']) {
          await page.evaluate(id=>window.__navigation.navigation.push('nearby',{stopId:id}),id);
          await settleNavigation(page);
          if(id.startsWith('K')||id.startsWith('B')) await page.locator('.navigation-current .arrival-line').first().waitFor();
          await page.waitForFunction(()=>!document.querySelector('.navigation-current [aria-busy="true"]'));
          await page.screenshot({path:resolve(artifacts,`before-${width}-${colorScheme}-${id}.png`)});
          await page.evaluate(()=>window.__navigation.navigation.pop());await settleNavigation(page);
        }
      }finally{await run.context.close();}
    }
    summary.checks.push("Baseline screenshots only: original c13b519a58ef at 390/546px Light/Dark; deterministic transport fixtures, original UI, no claim of live provider availability");
    return;
  }
  const cases = [390, 546].flatMap((width) =>
    ["light", "dark"].flatMap((colorScheme) =>
      [1, 1.5, 2].flatMap((scale) =>
        ["no-preference", "reduce"].map((reducedMotion) => ({
          width,
          colorScheme,
          scale,
          reducedMotion,
        })),
      ),
    ),
  );
  for (const c of process.env.AUDIT_REFRESH_ONLY === "1" ? [] : cases) {
    const run = await open({
      ...c,
      time: "2026-10-11T01:07:00Z",
      scenario: {
        timetableOptions: {operator: "kyotobus",name: "京都産業大学前",boards: [{key:"7475_1",label:"国際会館駅前行",routes:["40"]}]},
        foldEntries: [
          { depart: 620, route: "40", destination: "国際会館駅前" },
        ],
        gps: "denied",
        subwayFeed: subway,
        staticFeeds: { ["kintetsu:" + date]: rail },
        initialSettings: { autoDetect: false, fontScale: c.scale },
        railTrains: [
          {
            key: "observed",
            direction: "south",
            category: "local",
            label: "普通",
            dest: "大和西大寺",
            position: 5,
          },
        ],
      },
    });
    const { page } = run,
      prefix = `audit2-${c.width}-${c.colorScheme}-${c.scale}-${c.reducedMotion}`;
    try {
      assert.equal(await page.locator("[data-clock-format]").count(), 0);
      await page.waitForFunction(() =>
        document
          .querySelector("[data-live-location]")
          ?.textContent.includes("許可"),
      );
      assert.match(
        await page.locator("[data-live-map-caption]").innerText(),
        /未取得/,
      );
      assert.ok(
        (await page.locator(".live-map-host svg").boundingBox()).height >= 270,
      );
      // Quick is in the navigation bar; the status shows the sensors as icons.
      assert.equal(await page.locator(".live-navigation-capsule [data-quick-open]").count(), 1);
      assert.equal(await page.locator(".now-status .status-icon").count(), 5);
      await layout(page, prefix + " home");
      await page.screenshot({ path: resolve(artifacts, prefix + "-home.png") });
      for (const status of ["loading", "unavailable"]) {
        await page.evaluate(status => {window.__state.state.locationStatus=status; window.__view.renderNow();},status);
        assert.match(await page.locator("[data-live-location]").innerText(), status === "loading" ? /取得中/ : /取得できません/);
        assert.equal(await page.locator("[data-location-dot]").getAttribute("data-quality"),"missing");
      }
      // Test low accuracy and acquired location separately from denied state.
      await page.evaluate(() => {
        Object.assign(window.__state.state, {
          locationStatus: "active",
          fix: {
            lat: 35.01651,
            lng: 135.75949,
            accuracy: 90,
            timestamp: Date.now(),
            speed: 0,
          },
        });
        window.__view.renderNow();
      });
      assert.match(
        await page.locator("[data-live-location]").innerText(),
        /精度/,
      );
      const mapNode = await page
        .locator(".live-map-host .route-map")
        .evaluate((el) => {
          window.__auditMap = el;
          return el.dataset.mapKey;
        });
      assert.equal(mapNode, "nearby");
      await page.evaluate(() => {
        window.__state.state.fix = {
          ...window.__state.state.fix,
          lat: 35.0166,
          accuracy: 10,
        };
        window.__view.renderNow();
      });
      assert.equal(
        await page
          .locator(".live-map-host .route-map")
          .evaluate((el) => el === window.__auditMap),
        true,
        "GPS preserves map node",
      );
      for (const id of ["K07", "B07", "K15"]) {
        await page.evaluate(
          (id) => window.__navigation.navigation.push("nearby", { stopId: id }),
          id,
        );
        await settleNavigation(page);
        const root = page.locator(".navigation-current .station-arrivals");
        await root.locator(".station-direction-heading").first().waitFor();
        await page.waitForFunction(
          () =>
            !document.querySelector(
              '.navigation-current .station-arrivals[aria-busy="true"]',
            ),
        );
        const headings = await root
          .locator(".station-direction-heading")
          .allTextContents();
        assert.ok(
          headings.length >= 2,
          `both directions retained ${id}: ${headings.join(",")}`,
        );
        if (id === "K15") {
          assert.ok(headings.some((s) => s.includes("近鉄京都線")));
          assert.ok(headings.some((s) => s.includes("烏丸線")));
        }
        assert.equal(await root.locator(".arrival-track").count(), 0);
        assert.doesNotMatch(
          await root.innerText(),
          /西奈良|京都京都方面|国際会館国際会館方面/,
        );
        for (const group of await root
          .locator(".station-direction-rows")
          .all()) {
          const minutes = await group
            .locator(".arrival-minutes b")
            .allTextContents();
          assert.deepEqual(
            minutes.map(Number),
            minutes.map(Number).sort((a, b) => a - b),
          );
        }
        await layout(page, prefix + " " + id);
        await page.screenshot({
          path: resolve(artifacts, prefix + "-" + id + ".png"),
        });
        await page.evaluate(() => window.__navigation.navigation.pop());
        await settleNavigation(page);
      }
      await page.evaluate(() =>
        window.__navigation.navigation.push("nearby", { stopId: "ksu" }),
      );
      await settleNavigation(page);
      const bus = page.locator(".navigation-current [data-bus-stop-preview]");
      await bus.locator(".scheduled-stop-departures").waitFor();
      assert.match(await bus.innerText(), /予定.*あと/);
      assert.equal(await bus.locator(".source-dot.live").count(), 0);
      await layout(page, prefix + " ksu");
      await page.screenshot({ path: resolve(artifacts, prefix + "-ksu.png") });
      assert.deepEqual(run.errors, []);
    } finally {
      await run.context.close();
    }
  }
  const refreshRun = await open({time:'2026-10-11T01:07:00Z',scenario:{gps:'denied',initialSettings:{autoDetect:false}}});
  try {
    const {page}=refreshRun;
    await page.evaluate(() => window.__state.ensureSubwayFeed());

    let release, requests=0;
    const held = new Promise(resolve=>release=resolve);
    await page.route('**/api/static/feed?**',async route=>{
      if(new URL(route.request().url()).searchParams.get('operator')!=='subway') return route.fallback();
      requests++; await held; await route.fulfill({json:subway,headers:{'Access-Control-Allow-Origin':new URL(page.url()).origin}});
    });
    const button=page.locator('[data-live-refresh]').first();
    await button.click();
    assert.equal(await button.isDisabled(),true);
    for(let i=0;i<5;i++) await button.dispatchEvent('click');
    await page.waitForFunction(()=>document.querySelector('[data-live-refresh]')?.getAttribute('aria-busy')==='true');
    release();
    await page.waitForFunction(()=>!document.querySelector('[data-live-refresh]')?.disabled);
    assert.equal(requests,1,'repeated refresh taps coalesce');
    assert.match(await button.innerText(),/更新完了/);
    assert.ok(refreshRun.counts.bus>=2,'manual refresh reaches bus API');
  } finally {await refreshRun.context.close();}
  // No schedule response means no invented departure. Retry and offline path.
  const unavailable = await open({
    time: "2026-10-11T01:07:00Z",
    scenario: {
      gps: "denied",
      failBoard: true,
      initialSettings: { autoDetect: false },
    },
  });
  try {
    const { page } = unavailable;
    await page.evaluate(() =>
      window.__navigation.navigation.push("nearby", { stopId: "ksu" }),
    );
    await settleNavigation(page);
    await page.waitForFunction(() =>
      document
        .querySelector(".navigation-current [data-bus-stop-preview]")
        ?.textContent.includes("取得できません"),
    );
    assert.equal(
      await page
        .locator(".navigation-current .scheduled-stop-departures")
        .count(),
      0,
    );
  } finally {
    await unavailable.context.close();
  }
  summary.checks.push(
    process.env.AUDIT_REFRESH_ONLY === "1" ? "Audit 2 focused: six rapid refresh taps share one request, bus update is awaited, no fabricated timetable on failure" : "Audit 2: 390/546px × Light/Dark × 100/150/200% × motion/reduced; 24 home/location/map and K07/B07/K15/ksu cases, continuous Quick position handoff, directions, source labels, refresh coalescing, no fabricated times on failure",
  );
}
