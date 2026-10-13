// WebKit can reject a page.evaluate started inside a Playwright route callback
// after the owning context has already begun teardown. The browser smoke suite
// deliberately closes many isolated contexts, so this is a teardown race, not
// an application failure. Ignore only that exact Playwright TargetClosed race;
// every assertion, page error and any other unhandled rejection still fails CI.
process.on("unhandledRejection", (reason) => {
  const text = String(reason?.message ?? reason ?? "");
  const isRouteTeardownRace =
    reason?.name?.includes("TargetClosedError") &&
    text.includes("page.evaluate: Target page, context or browser has been closed") &&
    text.includes("while running route callback");

  if (isRouteTeardownRace) {
    console.warn("Ignored Playwright route teardown race:", text.split("\n")[0]);
    return;
  }

  throw reason instanceof Error ? reason : new Error(text);
});

await import("./browser-smoke.mjs");
