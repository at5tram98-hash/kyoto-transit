import test from "node:test";
import assert from "node:assert/strict";
import { rideAlightOptions, rideStartInput } from "../public/js/ride-start.js";

const ride = {
  operator: "citybus", route: "205", destination: "京都駅前",
  officialStops: [
    { id: "a", name: "A", time: 600 }, { id: "b", name: "B", time: 603 },
    { id: "c", name: "C", time: 607, estimated: true }, { id: "d", name: "D", time: 1442 },
  ],
};

test("乗車中の便の先の停留所だけを、遅れを反映した到着見込みと一緒に出す", () => {
  const options = rideAlightOptions(ride, { minute: 604, shift: 2 });
  assert.deepEqual(options.map((o) => [o.id, o.arrive]), [["b", 605], ["c", 609], ["d", 1444]]);
  assert.equal(options[1].estimated, true);
  // The observed next stop wins over the timetable.
  assert.deepEqual(rideAlightOptions(ride, { minute: 600, nextId: "c" }).map((o) => o.id), ["c", "d"]);
});

test("降りる停留所の到着時刻から検索を始め、日付をまたぐときは翌日にする", () => {
  const now = { date: "2026-10-25", minute: 604 };
  const input = rideStartInput(ride, { id: "c", name: "C", arrive: 609 }, now);
  assert.equal(input.fromId, "c");
  assert.equal(input.time, "10:09");
  assert.equal(input.date, "2026-10-25");
  assert.equal(input.rideStart.alightId, "c");
  const late = rideStartInput(ride, { id: "d", name: "D", arrive: 1444 }, now);
  assert.equal(late.date, "2026-10-26");
  assert.equal(late.time, "00:04");
  // Unknown arrival: from now.
  assert.equal(rideStartInput(ride, { id: "c", name: "C", arrive: null }, now).time, "10:04");
});
