import { chromium } from "playwright";
import { createServer } from "node:http";
import { resolve, extname } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
let server, localURL;
if (process.env.AUDIT_URL === "local") {
  const root=resolve("dist");
  const mime={".html":"text/html",".js":"application/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml",".webmanifest":"application/manifest+json"};
  server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(path==='/'?'/index.html':path));const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'}).end(body);}catch{res.writeHead(404).end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  localURL=`http://127.0.0.1:${server.address().port}`;
}
const out = process.env.AUDIT_OUTPUT ?? "../../outputs/before";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  geolocation: { latitude: 35.0697, longitude: 135.7572, accuracy: 15 },
  permissions: ["geolocation"],
  serviceWorkers: "block",
});
const page = await context.newPage();
page.on("requestfailed",r=>console.log("REQUEST FAILED",r.url(),r.failure()));
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
await page.addInitScript(() => {
  localStorage.setItem(
    "mymap-vnext-settings",
    JSON.stringify({ autoDetect: false }),
  );
  window.__audit = {
    callbacks: 0,
    records: 0,
    guarded: false,
    longTasks: [],
    ticks: 0,
  };
  const Native = MutationObserver;
  window.MutationObserver = class extends Native {
    constructor(callback) {
      super((records, observer) => {
        if (this.north3) {
          window.__audit.callbacks++;
          window.__audit.records += records.length;
          if (window.__audit.callbacks > 200) {
            window.__audit.guarded = true;
            observer.disconnect();
            return;
          }
        }
        callback(records, observer);
      });
    }
    observe(target, options) {
      this.north3 = target.id === "nearby-panel";
      return super.observe(target, options);
    }
  };
  new PerformanceObserver((list) =>
    window.__audit.longTasks.push(
      ...list
        .getEntries()
        .map((e) => ({ duration: e.duration, start: e.startTime })),
    ),
  ).observe({ type: "longtask", buffered: true });
  setInterval(() => window.__audit.ticks++, 100);
});
let calls = 0;
await page.route("**/api/citybus/arrivals?*", async (route) => {
  calls++;
  await route.fulfill({
    json: {
      source: "live",
      stale: false,
      asOf: new Date().toISOString(),
      results: [
        {
          key: "north3",
          route: "北3",
          dest: "北大路バスターミナル",
          source: "live",
          stopsAway: 2,
        },
      ],
    },
  });
});
const session = await context.newCDPSession(page);
await session.send("Performance.enable");
await page.goto(
  localURL ?? process.env.AUDIT_URL ?? "https://at5tram98-hash.github.io/kyoto-transit/",
);
try {
  await page.locator(".live-map-host svg").waitFor();
} catch (e) {
  console.log(await page.locator("body").innerText());
  await browser.close();
if (server) server.close();
  throw e;
}
await page.waitForTimeout(3000);
const phases = {};
if (process.env.AUDIT_STRESS === "1") {
  await page.evaluate(async () => {
    const q=new URL(document.querySelector('script[type=module]').src).search;
    const {state}=await import(new URL(`js/vnext-state.js${q}`,location.href));
    const {renderNow}=await import(new URL(`js/vnext-view.js${q}`,location.href));
    window.__auditMap=document.querySelector('.live-map-host .route-map');
    for(let i=0;i<60;i++) {
      state.fix={lat:35.0697+i*.000001,lng:135.7572,accuracy:15,timestamp:Date.now(),speed:0};
      renderNow();
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
  });
  phases.gpsBurst = await page.evaluate(()=>({sameMap:window.__auditMap===document.querySelector('.live-map-host .route-map'),callbacks:window.__audit.callbacks,nodes:document.querySelectorAll('*').length}));
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));
    window.__auditClock = document.querySelector('[data-live-clock]').textContent;
  });
  const beforeHidden=calls;
  await page.waitForTimeout(2100);
  phases.hidden = await page.evaluate(()=>({clockUnchanged:window.__auditClock===document.querySelector('[data-live-clock]').textContent,quickActive:document.querySelector('.live-quick-strip').dataset.active}));
  phases.hidden.networkRequests=calls-beforeHidden;
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  const stop=Date.now()+60000;
  while(Date.now()<stop) await page.waitForTimeout(1000);
  phases.soakSeconds=60;
}
const metrics = await session.send("Performance.getMetrics");
const result = await page.evaluate(() => ({
  ...window.__audit,
  mapNodes: document.querySelectorAll(".map-canvas").length,
  bodyNodes: document.querySelectorAll("*").length,
  location: document.querySelector("[data-live-location]")?.textContent,
}));
result.phases = phases;
result.citybusCalls = calls;
result.metrics = metrics.metrics;
result.url = page.url();
await page.screenshot({ path: out + "/now-390.png", fullPage: true });
await writeFile(out + "/performance.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await browser.close();
if (server) server.close();
