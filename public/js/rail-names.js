// Only documented destination abbreviations from official Kintetsu boards.
// Unknown names are preserved, never inferred from the direction of travel.
const destinations = Object.freeze({
  京: "京都",
  国: "国際会館",
  田: "新田辺",
  宮: "近鉄宮津",
  西: "大和西大寺",
  奈: "近鉄奈良",
  橿: "橿原神宮前",
  天: "天理",
});
export function railDestinationName(value) {
  const name = String(value ?? "").trim();
  return destinations[name] ?? name;
}
