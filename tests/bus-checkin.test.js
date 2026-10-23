import test from "node:test";
import assert from "node:assert/strict";
import {
  checkInStops,
  checkInChoices,
  createShakeDetector,
  createVolumeDoublePress,
} from "../public/js/bus-checkin.js";

const network = {
  stops: new Map(
    ["a", "b", "c", "d"].map((id) => [id, { id, name: `停${id}`, type: "citybus" }]),
  ),
  services: [
    { operator: "citybus", route: "204", stops: ["a", "b", "c", "a"] },
    { operator: "citybus", route: "10", stops: ["d", "b", "c"] },
    { operator: "citybus", route: "10", stops: ["c", "b", "d"] },
    { operator: "citybus", route: "93", stops: ["c", "d"] },
  ],
};

test("check-in offers every route and direction leaving the stop", () => {
  const choices = checkInChoices(network.stops.get("b"), { network, minute: 600 });
  assert.deepEqual(
    choices.map((c) => `${c.ride.route}>${c.ride.to}`),
    ["10>c", "10>d", "204>b"],
  );
  assert.ok(choices.every((c) => c.ride.officialStops[0].id === "b"));
});

test("check-in leaves out routes that terminate at the stop", () => {
  assert.deepEqual(checkInChoices(network.stops.get("d"), { network, minute: 600 }).map((c) => c.ride.route), ["10"]);
});

test("check-in stops are nearby bus stops only", () => {
  const rows = checkInStops([
    { id: "K07", meters: 20, stop: { type: "subway" } },
    { id: "b", meters: 90, stop: { type: "citybus" } },
    { id: "b", meters: 90, stop: { type: "citybus" } },
    { id: "kb", meters: 95, stop: { type: "kyotobus" } },
    { id: "far", meters: 900, stop: { type: "citybus" } },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["b", "kb"]);
});

test("a deliberate shake checks in once; gentle motion does not", () => {
  const shake = createShakeDetector();
  assert.equal(shake({ x: 3, y: 1, z: 1 }, 0), false);
  assert.equal(shake({ x: 18, y: 0, z: 0 }, 100), false);
  assert.equal(shake({ x: -18, y: 0, z: 0 }, 300), false);
  assert.equal(shake({ x: 18, y: 0, z: 0 }, 500), true);
  assert.equal(shake({ x: 18, y: 0, z: 0 }, 700), false, "cooldown");
  const slow = createShakeDetector();
  assert.equal(
    [0, 1500, 3000].map((t) => slow({ x: 18, y: 0, z: 0 }, t)).some(Boolean),
    false,
  );
  const gravity = createShakeDetector();
  assert.equal(gravity({ x: 0, y: 0, z: 9.81, gravity: true }, 0), false);
});

test("volume-down pressed twice quickly checks in", () => {
  const press = createVolumeDoublePress();
  assert.equal(press("AudioVolumeDown", 0), false);
  assert.equal(press("AudioVolumeDown", 400), true);
  assert.equal(press("AudioVolumeDown", 2000), false);
  assert.equal(press("AudioVolumeUp", 2100), false);
  assert.equal(press("AudioVolumeDown", 3000), false);
});
