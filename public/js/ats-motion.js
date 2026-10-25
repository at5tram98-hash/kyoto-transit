// ATS in motion. The Now status is redrawn on every tick; this keeps what
// it showed last time and animates only what changed:
//   · a new scene springs in (icon pops, the line slides up out of a blur);
//     a ride locking in flashes the confidence ring full
//   · the ring round the scene icon fills to how sure ATS is
//   · while ATS is sensing (moving, candidates, re-check) rings ripple out
//   · a scene waiting out its hold draws a hairline that fills until it
//     takes over
//   · a status icon whose state changed bounces once (signal bars light
//     one by one)
// prefers-reduced-motion turns all of it off in CSS.
const seen = new WeakMap();
const RIDING = new Set(["riding_bus", "riding_train"]);

function replay(element, name, ms = 900) {
  if (!element) return;
  element.classList.remove(name);
  void element.offsetWidth;
  element.classList.add(name);
  clearTimeout(element[`_${name}`]);
  element[`_${name}`] = setTimeout(() => element.classList.remove(name), ms);
}

const signature = (node) =>
  ["state", "level", "quality", "mode", "scanning"].map((k) => node.dataset[k] ?? "").join("|");

export function animateAtsStatus(root, status) {
  if (!root || !status) return;
  const before = seen.get(root),
    scene = root.querySelector(".now-status-scene");
  root.dataset.atsScene = status.scene;
  root.toggleAttribute("data-ats-scanning", Boolean(status.scanning));
  root.style.setProperty("--ats-confidence", String(Math.round(Math.max(0, Math.min(1, status.confidence ?? 0)) * 100)));

  if (before && before.scene !== status.scene) {
    if (scene) scene.dataset.enter = RIDING.has(status.scene) ? "lock" : "scene";
    replay(scene, "ats-scene-enter");
  }

  // The hold: a hairline that fills over the time left before the new
  // scene takes over. Restarted only when the waiting scene changes.
  const main = root.querySelector(".now-status-main");
  let hold = root.querySelector(".ats-hold");
  if (status.pending && status.pendingLeft > 0 && main) {
    if (!hold) {
      hold = document.createElement("span");
      hold.className = "ats-hold";
      hold.setAttribute("aria-hidden", "true");
      main.append(hold);
    }
    if (hold.dataset.pending !== status.pending) {
      hold.dataset.pending = status.pending;
      hold.style.animationDuration = `${Math.round(status.pendingLeft)}ms`;
      replay(hold, "run", status.pendingLeft + 400);
    }
  } else hold?.remove();

  const icons = new Map();
  for (const node of root.querySelectorAll(".status-icon[data-indicator]")) {
    const name = node.dataset.indicator,
      value = signature(node);
    icons.set(name, value);
    if (before?.icons.has(name) && before.icons.get(name) !== value) replay(node, "ats-pop", 700);
  }
  seen.set(root, { scene: status.scene, icons });
}
