import assert from "node:assert/strict";

export async function d3BrowserChecks({open, settleNavigation, summary}) {
  for (const engineMode of ["normal","reduce"]) {
    const run=await open({
      width:1280,height:860,colorScheme:"light",
      reducedMotion:engineMode==="reduce"?"reduce":"no-preference",
      scenario:{gps:"denied"},
    });
    const {page,errors}=run;
    try {
      await page.locator('[data-tab="settings"]').click();
      await settleNavigation(page);
      assert.deepEqual(
        await page.locator("[data-settings-group]").evaluateAll(nodes=>
          nodes.map(n=>n.dataset.settingsGroup)),
        ["transit","experience","saved","about"],
      );
      for(const id of ["pass","distance","notifications","auto","location","display","accessibility","routes","info","privacy","terms","advanced","permissions"]) {
        assert.ok(await page.locator(`[data-setting-page="${id}"]`).count(),`D-1 retains ${id}`);
      }
      assert.equal(await page.locator("[data-saved-page]").count(),2);
      await page.locator('[data-setting-page="notifications"]').click();
      await settleNavigation(page);
      assert.ok(await page.locator("[data-setting=alightAssist]").count());
      await page.locator("[data-navigation-back]").click();
      await settleNavigation(page);
      const columns=await page.evaluate(()=>{
        const shell=document.querySelector(".navigation-app");
        const nav=document.querySelector(".tabbar").getBoundingClientRect();
        const main=document.querySelector(".navigation-app main").getBoundingClientRect();
        const computed=getComputedStyle(shell);
        return {display:computed.display,navRight:nav.right,mainLeft:main.left,
          navHeight:nav.height,mainWidth:main.width,
          firstTabHeight:document.querySelector(".tab-button").getBoundingClientRect().height};
      });
      assert.equal(columns.display,"grid","D-2 desktop shell uses two-column grid");
      assert.ok(columns.navRight<=columns.mainLeft+2,JSON.stringify(columns));
      assert.ok(columns.mainWidth>700,JSON.stringify(columns));
      assert.ok(columns.firstTabHeight>=44);
      await page.locator('[data-tab="search"]').click();
      await settleNavigation(page);
      assert.ok(await page.locator("#planner-form").isVisible());
      if(engineMode==="reduce"){
        const count=await page.evaluate(()=>[...document.querySelectorAll(".navigation-current")].flatMap(e=>e.getAnimations()).length);
        assert.equal(count,0,"D-3 reduced motion must not leave active navigation animations");
      }
      assert.deepEqual(errors,[]);
      summary.checks.push(`D-1 hierarchy/D-2 desktop columns/D-3 motion ${engineMode}`);
    } finally {
      await run.context.close();
    }
  }
}
