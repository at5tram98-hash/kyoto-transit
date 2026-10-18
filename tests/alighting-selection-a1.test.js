import test from "node:test";
import assert from "node:assert/strict";
import { selectedAlightingStop } from "../public/js/ride-destination.js";
import { heroModel } from "../public/js/now-model.js";
import { nextStationHero, timelineRow } from "../public/js/now-components.js";

const stops = [
  { id: "K07", name: "丸太町", time: 600, departure: 600 },
  { id: "K08", name: "烏丸御池", time: 602, departure: 602 },
  { id: "K09", name: "四条", time: 604, departure: 604 },
  { id: "K10", name: "五条", time: 606, departure: 606 },
];
const ride = {
  operator: "subway",
  category: "local",
  from: "K07",
  to: "K08", // Candidate next stop; not a personal alighting choice
  destination: "竹田",
  officialStops: stops,
};
const progress = {
  stops,
  currentIndex: 0,
  nextIndex: 1,
  next: stops[1],
  arrival: 602,
};
const modelFor = (nextRide) =>
  heroModel(nextRide, progress, { minute: 600, locationStatus: "denied" });

test("detected ride never infers alighting stop from next or final known station", () => {
  assert.equal(selectedAlightingStop(ride), null);
  const model = modelFor(ride);
  assert.equal(model.userDestination, null);
  assert.equal(model.destinationArrival, null);
  assert.equal(model.nextIsDestination, false);
  const html = nextStationHero(model, ride, progress);
  assert.match(html, /降車地点を選ぶと/);
  assert.match(html, /降車地点を選択してください/);
  assert.match(html, /選択する/);
  assert.doesNotMatch(html, /undefined/);
});

test("explicit rider selection overrides ride.to and retains selected arrival", () => {
  const chosen = { ...ride, userDestination: { id: "K10", name: "五条" } };
  assert.equal(selectedAlightingStop(chosen)?.id, "K10");
  const model = modelFor(chosen);
  assert.equal(model.userDestination?.id, "K10");
  assert.equal(model.destinationArrival, 606);
  assert.equal(model.nextIsDestination, false);
  assert.match(nextStationHero(model, chosen, progress), /五条/);
});

test("timeline does not label the next stop as alighting unless explicitly chosen", () => {
  const row = (index, nextRide) =>
    timelineRow(stops[index], {
      index, progress, minute: 600, shift: 0, bus: false, ride: nextRide,
    });
  assert.doesNotMatch(row(1, ride), /<li class="[^"]*destination[^"]*"/);
  assert.match(row(3, { ...ride, userDestinationId: "K10" }), /<li class="[^"]*destination[^"]*"/);
});

test("invalid explicit selection safely becomes unselected", () => {
  const invalid = { ...ride, userDestination: { id: "B99" } };
  assert.equal(selectedAlightingStop(invalid), null);
  const model = modelFor(invalid);
  assert.equal(model.userDestination, null);
  assert.equal(model.nextIsDestination, false);
});
