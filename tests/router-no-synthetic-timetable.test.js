import test from "node:test";
import assert from "node:assert/strict";
import { route } from "../public/js/router.js";

test("authoritative timetable service without trips does not synthesize a headway trip", () => {
  const network = {
    mode: "timetable",
    validDates: ["2026-10-18"],
    stops: new Map([
      ["A", { id: "A", name: "A" }],
      ["B", { id: "B", name: "B" }],
    ]),
    walks: [],
    services: [
      {
        id: "official-empty",
        operator: "subway",
        label: "Official",
        stops: ["A", "B"],
        offsets: [0, 2],
        headway: 5,
        first: 300,
        last: 1400,
        category: "local",
        prototype: false,
      },
    ],
  };
  const result = route(network, {
    from: "A",
    to: "B",
    date: "2026-10-18",
    start: 600,
    trainType: "all",
    buffer: 3,
    maxWalk: 30,
  });
  assert.equal(result, null);
});
