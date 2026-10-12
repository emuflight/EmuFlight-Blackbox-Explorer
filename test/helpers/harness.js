"use strict";
// Shared Node harness: loads the parser files into one vm context and parses a log through the real decode path.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const JS_DIR = path.join(__dirname, "..", "..", "js");
const FILES = ["tools.js", "datastream.js", "decoders.js", "imu.js", "flightlog_fielddefs.js", "flightlog_fields_presenter.js", "flightlog_index.js", "flightlog_parser.js"];

// tools.js builds jQuery objects at load time; a chainable no-op stub is enough for parser code.
const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });

// PARSER_JS=<file> swaps the parser source, to compare two revisions by digest.
function createContext() {
    const ctx = vm.createContext({ console, Math, Uint8Array, Date, parseInt, parseFloat, isNaN, ArrayBuffer, DataView, Array, Object, String, Number, JSON, window: {}, $: stub, jQuery: stub, document: stub, navigator: { userAgent: "node" }, localStorage: stub });
    for (const f of FILES) {
        vm.runInContext(fs.readFileSync((f === "flightlog_parser.js" && process.env.PARSER_JS) || path.join(JS_DIR, f), "utf8"), ctx, { filename: f });
    }
    ctx.semver = require("../../js/vendor/semver.js"); // index.html exposes it as a window global
    return ctx;
}

// Parses every log in a file buffer. Returns counts, invalid-frame count, encodings and the frame digest.
function parseLog(buffer) {
    const ctx = createContext();
    ctx.data = new Uint8Array(buffer);
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
                if (frame) { hash.push(JSON.stringify([type, frame])); } // E frames are { event, data } objects
            };
            parser.parseLogData(false);
        }
        return JSON.stringify({ logs: index.getLogCount(), counts: counts, shortFrames: bad, invalidFrames: badCount, nanValues: nan, encodings: Object.keys(encs).map(Number), hash: hash });
    })()`, ctx);
    const r = JSON.parse(out);
    r.sha256 = crypto.createHash("sha256").update(r.hash.join("\n")).digest("hex");
    r.frames = r.hash.length;
    delete r.hash;
    return r;
}

// Runs parseHeader on header text and returns the named sysConfig keys. The text needs I and P frame definitions
// (name, signed, predictor, encoding for I; predictor, encoding for P) or parseHeader throws.
const MIN_HEADER = [
    "H Product:Blackbox flight data recorder by Nicholas Sherlock",
    "H Data version:2",
    "H Field I name:loopIteration,time",
    "H Field I signed:0,0",
    "H Field I predictor:0,0",
    "H Field I encoding:1,1",
    "H Field P predictor:6,2",
    "H Field P encoding:9,0",
].join("\n") + "\n";

function parseHeaderText(text, keys) {
    const ctx = createContext();
    ctx.data = new Uint8Array(Buffer.from(text, "latin1"));
    ctx.keys = keys;
    return JSON.parse(vm.runInContext("(function () { var p = new FlightLogParser(data), out = {}; p.parseHeader(0, data.length); keys.forEach(function (k) { out[k] = p.sysConfig[k]; }); return JSON.stringify(out); })()", ctx));
}

module.exports = { createContext, parseLog, parseHeaderText, MIN_HEADER };
