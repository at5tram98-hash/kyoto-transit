import { state, serviceName, toast } from "./vnext-state.js";

function normalized(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s・ーｰ\-]/g, "")
    .replace(/京都市バス|京都バス|地下鉄|近鉄|烏丸線|京都線|系統/g, "");
}

function derivedMotion() {
  const points = (state.samples ?? [])
    .filter((p) => Number.isFinite(p?.timestamp))
    .slice(-8);
  if (points.length < 2) return { span: 0, acceleration: null };
  const samples = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dt = (b.timestamp - a.timestamp) / 1000;
    if (dt <= 0 || dt > 35) continue;
    if (Number.isFinite(a.speed) && Number.isFinite(b.speed))
      samples.push((b.speed - a.speed) / dt);
  }
  return {
    span: (points.at(-1).timestamp - points[0].timestamp) / 1000,
    acceleration: samples.length
      ? samples.reduce((sum, value) => sum + value, 0) / samples.length
      : null,
  };
}

function speechCtor() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

function candidateTokens(candidate) {
  const ride = candidate?.ride;
  if (!ride) return [];
  return [
    ride.route,
    ride.destination,
    ride.label,
    serviceName(ride),
    ...(ride.officialStops ?? []).map((stop) => stop.name),
  ]
    .map(normalized)
    .filter((value) => value.length >= 2);
}

function bestCandidate(transcript) {
  const text = normalized(transcript);
  const ranked = (state.rideCandidates ?? []).map((candidate, index) => ({
    index,
    score: candidateTokens(candidate).reduce(
      (score, token) => score + (text.includes(token) ? Math.min(8, token.length) : 0),
      0,
    ),
  }));
  ranked.sort((a, b) => b.score - a.score);
  if (!ranked[0] || ranked[0].score < 3) return null;
  if (ranked[1] && ranked[0].score === ranked[1].score) return null;
  return ranked[0].index;
}

function addSpeechAssist() {
  const block = document.querySelector(".ride-choice-block");
  if (!block || block.querySelector("[data-announcement-assist]")) return;
  const candidates = state.rideCandidates ?? [];
  if (!candidates.length || !speechCtor()) return;
  const top = candidates[0]?.score ?? 0,
    second = candidates[1]?.score ?? 0,
    uncertain = top < 72 || (candidates.length > 1 && top - second < 14);
  if (!uncertain) return;

  const motion = derivedMotion(),
    button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-action announcement-assist";
  button.dataset.announcementAssist = "";
  button.innerHTML = `<span>アナウンスで確認</span><small>判定が曖昧なときだけ使用 · マイクはタップ後のみ</small>`;
  button.title = Number.isFinite(motion.acceleration)
    ? `移動継続 ${Math.round(motion.span)}秒 / 推定加速度 ${motion.acceleration.toFixed(2)}m/s²`
    : `移動継続 ${Math.round(motion.span)}秒`;
  block.append(button);

  button.addEventListener("click", () => {
    const Recognition = speechCtor();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "ja-JP";
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;
    button.disabled = true;
    button.querySelector("span").textContent = "アナウンスを確認中…";
    recognition.onresult = (event) => {
      const alternatives = [...event.results]
        .flatMap((result) => [...result])
        .map((item) => item.transcript);
      const match = alternatives
        .map(bestCandidate)
        .find((index) => Number.isInteger(index));
      if (Number.isInteger(match)) {
        const choice = document.querySelector(`[data-ride-candidate="${match}"]`);
        if (choice) {
          toast("アナウンスと候補が一致しました");
          choice.click();
          return;
        }
      }
      toast("アナウンスだけでは便を確定できませんでした");
    };
    recognition.onerror = () => toast("マイクから確認できませんでした");
    recognition.onend = () => {
      if (!button.isConnected) return;
      button.disabled = false;
      button.querySelector("span").textContent = "アナウンスで確認";
    };
    try {
      recognition.start();
    } catch {
      button.disabled = false;
      toast("マイクを開始できませんでした");
    }
  });
}

export function installMotionAssist() {
  const panel = document.querySelector("#vehicle-panel");
  if (!panel) return;
  const observer = new MutationObserver(addSpeechAssist);
  observer.observe(panel, { childList: true, subtree: true });
  addSpeechAssist();
}
