import { installFastData } from "./fast-data.js";
import { installMotionAssist } from "./motion-assist.js";
import { installInteractionGuard } from "./interaction-guard.js";
import { installNorth3Live } from "./north3-live.js";

function start() {
  installFastData();
  installInteractionGuard();
  installNorth3Live();
  installMotionAssist();
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
