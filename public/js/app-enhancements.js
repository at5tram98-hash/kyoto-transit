import { installFastData } from "./fast-data.js";
import { installIdleExperience } from "./idle-experience.js";
import { installMotionAssist } from "./motion-assist.js";

function start() {
  installFastData();
  installIdleExperience();
  installMotionAssist();
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
