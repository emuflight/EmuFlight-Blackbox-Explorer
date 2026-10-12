"use strict";
// Header parsing through parseHeader with the smallest header it accepts.
const test = require("node:test");
const assert = require("node:assert");
const { parseHeaderText, MIN_HEADER } = require("./helpers/harness.js");

// Without the break after this case, the Cleanflight parseInt overwrote the divided value (550 instead of 5.5).
test("digitalIdleOffset is stored as percent (raw / 100)", () => {
    assert.strictEqual(parseHeaderText(MIN_HEADER + "H digitalIdleOffset:550\n", ["digitalIdleOffset"]).digitalIdleOffset, 5.5);
});

test("dshot_idle_value alias maps to digitalIdleOffset", () => {
    assert.strictEqual(parseHeaderText(MIN_HEADER + "H dshot_idle_value:550\n", ["digitalIdleOffset"]).digitalIdleOffset, 5.5);
});

test("digitalIdleOffset of 0 stays 0", () => {
    assert.strictEqual(parseHeaderText(MIN_HEADER + "H digitalIdleOffset:0\n", ["digitalIdleOffset"]).digitalIdleOffset, 0);
});

test("parseHeader rejects a header without I frame definitions", () => {
    assert.throws(() => parseHeaderText("H Product:Blackbox flight data recorder by Nicholas Sherlock\nH Data version:2\nH digitalIdleOffset:550\n"), /missing required definitions for I frames/);
});
