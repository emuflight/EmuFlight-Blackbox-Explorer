"use strict";
// Prints a frame digest for one real log, to diff between parser revisions (PARSER_JS=<file> swaps the parser).
// Usage: node test/digest.js <log.BBL>   (yarn test:parser <log.BBL>)
const fs = require("fs");
const { parseLog } = require("./helpers/harness.js");

const logPath = process.argv[2];
if (!logPath) { console.error("usage: node test/digest.js <log.BBL>"); process.exit(2); }

const r = parseLog(fs.readFileSync(logPath));
console.log(JSON.stringify({ logs: r.logs, counts: r.counts, invalidFrames: r.invalidFrames, encodings: r.encodings.join(" "), frames: r.frames, sha256: r.sha256 }));
