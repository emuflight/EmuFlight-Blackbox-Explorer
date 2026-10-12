"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = vm.createContext({ Math, Array });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "expo.js"), "utf8") + "\nthis.ExpoCurve = ExpoCurve;", ctx, { filename: "expo.js" });
const ExpoCurve = ctx.ExpoCurve;

test("expo curve maps 0, -inputRange and +inputRange to 0, -1 and 1", () => {
    const curve = new ExpoCurve(0, 0.700, 750, 1.0, 10);
    assert.strictEqual(curve.lookup(0), 0.0);
    assert.strictEqual(curve.lookup(-750), -1.0);
    assert.strictEqual(curve.lookup(750), 1.0);
});

test("power 1.0 is a straight line", () => {
    const curve = new ExpoCurve(0, 1.0, 500, 1.0, 1);
    assert.strictEqual(curve.lookup(0), 0.0);
    assert.strictEqual(curve.lookup(-500), -1.0);
    assert.strictEqual(curve.lookup(500), 1.0);
    assert.strictEqual(curve.lookup(-250), -0.5);
    assert.strictEqual(curve.lookup(250), 0.5);
});

test("curve points equal (|x|/inputRange)^power * outputRange", () => {
    const curve = new ExpoCurve(0, 0.7, 900, 2.0, 10);
    for (let i = 0; i < 10; i++) {
        const expected = Math.pow(i / 9, 0.7) * 2.0;
        assert(Math.abs(curve.lookup(i * 100) - expected) < 1e-12, "step " + i);
        assert(Math.abs(curve.lookup(-i * 100) + expected) < 1e-12, "step -" + i);
    }
});

test("input beyond inputRange extrapolates monotonically on both sides", () => {
    const curve = new ExpoCurve(0, 0.7, 750, 1.0, 10);
    assert(curve.lookup(1500) > curve.lookup(750));
    assert(curve.lookup(-1500) < curve.lookup(-750));
    assert.strictEqual(curve.lookup(1500), -curve.lookup(-1500));
});

test("offset shifts the input before the curve is applied", () => {
    const curve = new ExpoCurve(100, 1.0, 500, 1.0, 1);
    assert.strictEqual(curve.lookup(-100), 0.0);
    assert.strictEqual(curve.lookup(400), 1.0);
});

test("lookupRaw is linear and ignores power", () => {
    const curve = new ExpoCurve(0, 0.5, 500, 2.0, 10);
    assert.strictEqual(curve.lookupRaw(250), 1.0);
    assert.strictEqual(curve.lookupRaw(-500), -2.0);
});
