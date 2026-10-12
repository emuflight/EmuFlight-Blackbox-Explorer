"use strict";
// Parses a real log fixture through the real parser decode path and checks frame invariants.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { parseLog } = require("./helpers/harness.js");

// First 40040 bytes of a real EmuFlight log, cut on a frame boundary (the log is torn in the middle of a frame
// at most other cut points, which the parser reports as one invalid frame).
const FIXTURE = path.join(__dirname, "fixtures", "helio_v2_imuf258_head.bbl");
const fixture = fs.readFileSync(FIXTURE);

test("fixture parses with I and P frames and no invalid, short or NaN frames", () => {
    const r = parseLog(fixture);
    assert.strictEqual(r.logs, 1);
    assert(r.counts.I > 0 && r.counts.P > 0, "expected I and P frames");
    assert.strictEqual(r.invalidFrames, 0);
    assert.strictEqual(r.shortFrames, 0, "I/P frame shorter than frameDef.count");
    assert.strictEqual(r.nanValues, 0, "NaN in decoded frame");
});

test("fixture frame counts and digest match the recorded run (regression pin)", () => {
    // Pins recorded from a run of this parser on this fixture. Re-derive with `node test/digest.js <fixture>`
    // after an intended parser change.
    const r = parseLog(fixture);
    assert.deepStrictEqual(r.counts, { I: 18, E: 2, S: 2, P: 1059 });
    assert.strictEqual(r.frames, 1081);
    assert.strictEqual(r.sha256, "e47e1d52c428d5d90dfd18c3c4bb54a26c77d10866bfc227b8901b6aaa554ffb");
});

test("fixture exercises the decoder encodings the reference log uses", () => {
    assert.deepStrictEqual(parseLog(fixture).encodings.sort((a, b) => a - b), [0, 1, 3, 6, 7, 8, 9]);
});

test("a log torn mid-frame keeps its earlier frames and reports at most one invalid frame", () => {
    const r = parseLog(fixture.subarray(0, 40000));
    assert(r.counts.I > 0 && r.counts.P > 0, "frames before the cut must survive");
    assert.strictEqual(r.invalidFrames, 1);
    assert.strictEqual(r.nanValues, 0);
});

test("data with no log header yields no logs and no frames", () => {
    const r = parseLog(Buffer.from("not a blackbox log\n".repeat(50)));
    assert.strictEqual(r.logs, 0);
    assert.strictEqual(r.frames, 0);
});
