// The legacy worker serves cached modules regardless of their version query.
// Adopt the stable worker before loading any new app modules on that upgrade.
(async () => {
  const entry = document.getElementById("app-entry");
  const serviceWorker = navigator.serviceWorker;
  const controller = serviceWorker?.controller;
  try {
    if (controller && new URL(controller.scriptURL).searchParams.has("v")) {
      const url = new URL("sw.js", location.href);
      const registration = await serviceWorker.register(url.href, {
        scope: "./",
        updateViaCache: "none",
      });
      await new Promise((resolve, reject) => {
        const ready = () => {
          if (serviceWorker.controller?.scriptURL === url.href) {
            clearTimeout(timeout);
            serviceWorker.removeEventListener("controllerchange", ready);
            resolve();
          }
        };
        const timeout = setTimeout(() => {
          serviceWorker.removeEventListener("controllerchange", ready);
          reject(new Error("The previous app could not be updated"));
        }, 15000);
        serviceWorker.addEventListener("controllerchange", ready);
        registration.waiting?.postMessage({ type: "ACTIVATE_UPDATE" });
        ready();
      });
      location.reload();
      return;
    }
    const script = document.createElement("script");
    script.type = "module";
    script.src = entry.src;
    entry.replaceWith(script);
  } catch {
    const hero = document.getElementById("now-hero");
    const message = document.createElement("p");
    message.className = "hero-card";
    message.textContent =
      "アプリを更新できませんでした。通信を確認し、再読み込みしてください。";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.style.minHeight = "44px";
    retry.style.maxWidth = "100%";
    retry.textContent = "再読み込み";
    retry.addEventListener("click", () => location.reload());
    message.append(document.createElement("br"), retry);
    hero.replaceChildren(message);
  }
})();
