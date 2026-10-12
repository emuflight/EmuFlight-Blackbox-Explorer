"use strict";
// Node harness: parse a real blackbox log with js/flightlog_parser.js and check frame invariants.
// Usage: node test/parser_frames.js <log.BBL>   (prints a digest to diff between code revisions)
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const assert = require("assert");

const logPath = process.argv[2];
if (!logPath) { console.error("usage: node test/parser_frames.js <log.BBL>"); process.exit(2); }

// tools.js builds jQuery objects at load time; a chainable no-op stub is enough for parser code.
const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });
const ctx = vm.createContext({ console, Math, Uint8Array, Date, parseInt, parseFloat, isNaN, ArrayBuffer, DataView, Array, Object, String, Number, JSON, window: {}, $: stub, jQuery: stub, document: stub, navigator: { userAgent: "node" }, localStorage: stub });
for (const f of ["tools.js", "datastream.js", "decoders.js", "imu.js", "flightlog_fielddefs.js", "flightlog_fields_presenter.js", "flightlog_index.js", "flightlog_parser.js"]) {
    vm.runInContext(fs.readFileSync((f === "flightlog_parser.js" && process.env.PARSER_JS) || path.join(__dirname, "..", "js", f), "utf8"), ctx, { filename: f });
}

const data = new Uint8Array(fs.readFileSync(logPath));
ctx.data = data;
const out = vm.runInContext(`(function () {
    var index = new FlightLogIndex(data), parser = new FlightLogParser(data), hash = [], counts = {}, bad = 0, badCount = 0, nan = 0;
    var encs = {};
    for (var n = 0; n < index.getLogCount(); n++) {
        parser.parseHeader(index.getLogBeginOffset(n), index.getLogBeginOffset(n + 1));
        ["I", "P"].forEach(function (t) { (parser.frameDefs[t].encoding || []).forEach(function (e) { encs[e] = true; }); });
        parser.onFrameReady = function (valid, frame, type) {
            if (!valid) { badCount++; return; }
            counts[type] = (counts[type] || 0) + 1;
            if (frame && (type === "I" || type === "P")) {
                if (frame.length < parser.frameDefs[type].count) { bad++; }
                for (var i = 0; i < frame.length; i++) { if (typeof frame[i] === "number" && isNaN(frame[i])) { nan++; } }
            }
            if (frame) { hash.push(Array.prototype.join.call(frame, ",")); }
        };
        parser.parseLogData(false);
    }
    return JSON.stringify({ logs: index.getLogCount(), counts: counts, shortFrames: bad, invalidFrames: badCount, nanValues: nan, encodings: Object.keys(encs), hash: hash });
})()`, ctx);
const r = JSON.parse(out);
const digest = crypto.createHash("sha256").update(r.hash.join("\n")).digest("hex");

assert(r.logs >= 1, "no logs found");
assert(r.counts.I > 0 && r.counts.P > 0, "expected I and P frames");
assert.strictEqual(r.shortFrames, 0, "I/P frame shorter than frameDef.count");
assert.strictEqual(r.nanValues, 0, "NaN in decoded frame");
console.log(JSON.stringify({ logs: r.logs, counts: r.counts, invalidFrames: r.invalidFrames, encodings: r.encodings.join(" "), frames: r.hash.length, sha256: digest }));
console.log("OK");
