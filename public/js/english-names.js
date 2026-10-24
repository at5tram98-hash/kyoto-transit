// In the English UI, rail station and line names arrive from many places as
// Japanese text (timetables, official feeds, stored journeys). Rather than
// translating at every render, rendered text is rewritten once it reaches the
// page: a Japanese name becomes its official English spelling when it stands
// as a whole word. Names inside longer Japanese words, such as the bus stop
// 烏丸丸太町, are left alone, and bus stop names stay as published.
import { placeNameEntries } from "./locale.js";

const LINES = [
  ["地下鉄烏丸線", "Karasuma Line"],
  ["烏丸線", "Karasuma Line"],
  ["近鉄京都線", "Kintetsu Kyoto Line"],
  ["近鉄奈良線", "Kintetsu Nara Line"],
  ["京都線", "Kyoto Line"],
  ["奈良線", "Nara Line"],
  ["臨時", "Extra"],
];
// Japanese characters that join words; the middle dot (・) separates them.
const CJK = "\\u3040-\\u30fa\\u30fc-\\u30ff\\u3400-\\u9fff\\uf900-\\ufaff々";

export function englishNameReplacer(entries = []) {
  const table = new Map([...LINES, ...entries]);
  const names = [...table.keys()].sort((a, b) => b.length - a.length);
  if (!names.length) return (text) => text;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `(?<![${CJK}])(${escaped.join("|")})(?:駅)?(行き|行|方面)?(?![${CJK}])`,
    "gu",
  );
  return (text) =>
    typeof text === "string"
      ? text.replace(pattern, (_, name, suffix) =>
          suffix === "方面"
            ? `towards ${table.get(name)}`
            : suffix
              ? `to ${table.get(name)}`
              : table.get(name),
        ).replace(/([A-Za-z])・(?=[A-Za-z])/g, "$1 · ")
      : text;
}

const ATTRIBUTES = ["aria-label", "title", "placeholder", "alt"];
let observer = null;

export function startEnglishNames(root = document.body) {
  observer?.disconnect();
  const replace = englishNameReplacer(placeNameEntries());
  const fixText = (node) => {
    const next = replace(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  };
  const fixElement = (el) => {
    for (const name of ATTRIBUTES) {
      const value = el.getAttribute?.(name);
      if (value) {
        const next = replace(value);
        if (next !== value) el.setAttribute(name, next);
      }
    }
  };
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return fixText(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (/^(SCRIPT|STYLE|TEXTAREA|INPUT)$/.test(node.nodeName)) return;
    fixElement(node);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode())
      if (n.nodeType === Node.TEXT_NODE) fixText(n);
      else fixElement(n);
  };
  walk(root);
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") fixText(record.target);
      else if (record.type === "attributes") fixElement(record.target);
      else record.addedNodes.forEach(walk);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRIBUTES,
  });
  return observer;
}

export function stopEnglishNames() {
  observer?.disconnect();
  observer = null;
}
