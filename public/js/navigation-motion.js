// One vocabulary for hierarchy, presentation and meaningful data changes.
export const motionTokens = Object.freeze({
  fast: 160,
  standard: 220,
  navigation: 320,
  spring: 260,
  easing: "cubic-bezier(.22,.8,.25,1)",
  springEasing: "cubic-bezier(.2,.85,.2,1.08)",
});
export const reducedMotion = () =>
  globalThis.document?.documentElement.dataset.reduceMotion === "true" ||
  (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
    false);
async function run(element, frames, duration, easing = motionTokens.easing) {
  if (!element || document.hidden) return;
  const animation = element.animate(frames, { duration, easing, fill: "both" });
  try {
    await animation.finished;
  } catch {
  } finally {
    animation.cancel();
  }
}
export async function transition(outgoing, incoming, kind, width) {
  if (!outgoing || outgoing === incoming || kind === "none") return;
  outgoing.hidden = false;
  outgoing.inert = true;
  incoming.hidden = false;
  if (kind === "tab" || kind === "state" || reducedMotion()) {
    incoming.style.zIndex = "3";
    outgoing.style.zIndex = "1";
    await run(
      incoming,
      [{ opacity: 0.3 }, { opacity: 1 }],
      reducedMotion() ? 90 : motionTokens.fast,
    );
    return;
  }
  const push = kind === "push";
  incoming.style.zIndex = push ? "3" : "1";
  outgoing.style.zIndex = push ? "1" : "3";
  const shadow = "-6px 0 20px rgba(0,0,0,.12)";
  (push ? incoming : outgoing).style.boxShadow = shadow;
  await Promise.all([
    run(
      outgoing,
      [
        { transform: "translateX(0)", opacity: 1 },
        {
          transform: `translateX(${push ? -width * 0.25 : width}px)`,
          opacity: push ? 0.8 : 1,
        },
      ],
      motionTokens.navigation,
    ),
    run(
      incoming,
      [
        {
          transform: `translateX(${push ? width : -width * 0.25}px)`,
          opacity: push ? 1 : 0.8,
        },
        { transform: "translateX(0)", opacity: 1 },
      ],
      motionTokens.navigation,
    ),
  ]);
}
export async function settleSwipe(current, parent, { dx, width, commit }) {
  const duration = reducedMotion() ? 90 : motionTokens.spring;
  await Promise.all([
    run(
      current,
      [
        { transform: `translateX(${dx}px)` },
        { transform: `translateX(${commit ? width : 0}px)` },
      ],
      duration,
      commit ? motionTokens.easing : motionTokens.springEasing,
    ),
    run(
      parent,
      [
        {
          transform: parent.style.transform || `translateX(${-width * 0.25}px)`,
          opacity: parent.style.opacity || 1,
        },
        {
          transform: `translateX(${commit ? 0 : -width * 0.25}px)`,
          opacity: commit ? 1 : 0.8,
        },
      ],
      duration,
    ),
  ]);
}
export function stateChange(element, kind = "crossfade") {
  if (!element || reducedMotion() || element.closest("[hidden]")) return;
  run(
    element,
    kind === "station"
      ? [
          { opacity: 0, transform: "translateY(7px)" },
          { opacity: 1, transform: "translateY(0)" },
        ]
      : [{ opacity: 0.25 }, { opacity: 1 }],
    motionTokens.standard,
  );
}
export function updateMeaning(element, html, kind = "crossfade") {
  if (!element || element.innerHTML === html) return;
  const previous =
    kind === "station" && !reducedMotion() && !element.closest("[hidden]")
      ? element.cloneNode(true)
      : null;
  element.innerHTML = html;
  if (previous) {
    const parent = element.parentElement;
    parent.style.position = "relative";
    previous.setAttribute("aria-hidden", "true");
    previous.style.cssText = `position:absolute;left:${element.offsetLeft}px;top:${element.offsetTop}px;width:${element.offsetWidth}px;pointer-events:none`;
    parent.append(previous);
    run(
      previous,
      [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(-7px)" },
      ],
      motionTokens.standard,
    ).finally(() => previous.remove());
  }
  stateChange(element, kind);
}
export async function settleSheet(sheet, dy, { dismiss = false, detent } = {}) {
  if (detent && !dismiss) {
    const startHeight = sheet.offsetHeight;
    sheet.dataset.detent = detent;
    sheet.style.height = "";
    const endHeight = sheet.offsetHeight;
    await run(
      sheet,
      [
        { height: `${startHeight}px`, transform: `translateY(${dy}px)` },
        { height: `${endHeight}px`, transform: "translateY(0)" },
      ],
      reducedMotion() ? 90 : motionTokens.spring,
      motionTokens.springEasing,
    );
    sheet.style.transform = "";
    sheet.style.removeProperty("--sheet-backdrop");
    return;
  }
  await run(
    sheet,
    [
      { transform: `translateY(${dy}px)` },
      { transform: `translateY(${dismiss ? sheet.offsetHeight + 20 : 0}px)` },
    ],
    reducedMotion() ? 90 : motionTokens.spring,
    dismiss ? motionTokens.easing : motionTokens.springEasing,
  );
  sheet.style.transform = "";
  sheet.style.removeProperty("--sheet-backdrop");
  if (dismiss) {
    sheet.style.height = "";
    if (typeof sheet.close === "function") sheet.close();
    else sheet.dispatchEvent(new CustomEvent("mymap-sheet-dismiss"));
  }
}

export function animateState(element, frames, options = {}) {
  if (reducedMotion() || globalThis.document?.hidden) return;
  element.getAnimations?.().forEach((animation) => animation.cancel());
  return element.animate?.(frames, {
    duration: motionTokens.spring,
    easing: motionTokens.easing,
    ...options,
  });
}
