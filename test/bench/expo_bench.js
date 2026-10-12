"use strict";
// Manual benchmark, not part of `yarn test`. Usage: node test/bench/expo_bench.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = vm.createContext({ Math });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "js", "expo.js"), "utf8") + "\nthis.ExpoCurve = ExpoCurve;", ctx, { filename: "expo.js" });

const curve = new ctx.ExpoCurve(0, 0.700, 750, 1.0, 10);
let acc = 0;
for (let trial = 0; trial < 10; trial++) {
    const start = Date.now();
    for (let i = 0; i < 10000000; i++) { acc += curve.lookup(Math.random() * 750); }
    console.log(Date.now() - start, "ms");
}
console.log("Checksum:", acc);
