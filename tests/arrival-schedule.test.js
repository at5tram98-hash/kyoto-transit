import test from "node:test";
import assert from "node:assert/strict";
import { scheduledArrivalFallbacks } from "../public/js/arrival-schedule.js";
const date = "2026-10-14";
const network = {
  stops: new Map(),
  services: [
    {
      id: "east",
      operator: "citybus",
      route: "204",
      direction: "east",
      stops: ["a", "b"],
      trips: [{ id: "e", date, headsign: "銀閣寺", departures: [610, 620] }],
    },
    {
      id: "west",
      operator: "citybus",
      route: "204",
      direction: "west",
      stops: ["a", "c"],
      trips: [{ id: "w", date, headsign: "金閣寺", departures: [605, 620] }],
    },
  ],
};
test("arrival schedule respects destination, observed vehicles and current service date", () => {
  const rows = [
    { route: "204", dest: "銀閣寺", status: "接近なし" },
    { route: "204", dest: "金閣寺", stopsAway: 3 },
    { route: "204", dest: "不明" },
  ];
  const result = scheduledArrivalFallbacks(network, "a", rows, {
    date,
    minute: 600,
  });
  assert.equal(result[0].scheduledDeparture, 610);
  assert.equal(result[0].source, "schedule");
  assert.equal(result[1], rows[1]);
  assert.equal(result[2], rows[2]);
  assert.equal(
    scheduledArrivalFallbacks(network, "a", rows, {
      date: "2026-10-15",
      minute: 600,
    })[0],
    rows[0],
  );
});
test("ambiguous direction does not invent a departure for an unknown destination", () => {
  const row = { route: "204", dest: "不明", status: "時刻未確定" };
  assert.equal(
    scheduledArrivalFallbacks(network, "a", [row], { date, minute: 600 })[0],
    row,
  );
});
