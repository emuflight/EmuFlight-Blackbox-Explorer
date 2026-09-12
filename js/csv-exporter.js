"use strict";

/**
 * @typedef {object} ExportOptions
 * @property {string} columnDelimiter
 * @property {string} stringDelimiter
 * @property {boolean} quoteStrings
 */

/**
 * @constructor
 * @param {FlightLog} flightLog 
 * @param {ExportOptions} [opts={}]
 */
let CsvExporter = function(flightLog, opts={}) {

    var opts = _.merge({
        columnDelimiter: ",",
        stringDelimiter: "\"",
        quoteStrings: true,
    }, opts);

    /** 
     * @param {function} success is a callback triggered when export is done
     */
    function dump(success) {
        let frames = _(flightLog.getChunksInTimeRange(flightLog.getMinTime(), flightLog.getMaxTime()))
                .map(chunk => chunk.frames).value(),
            // Absolute path resolves against the OS filesystem root under Electron's file://
            // protocol, not the app directory — relative resolves against this document's own
            // location like any normal browser resource reference.
            worker = new Worker("js/webworkers/csv-export-worker.js");

        worker.onmessage = event => {
            success(event.data);
            worker.terminate();
        };
        // Without this, a worker load/script failure never reaches success or the console —
        // the export button just does nothing, with no visible cause.
        worker.onerror = event => {
            console.error("CSV export worker failed:", event.message || event);
            worker.terminate();
        };
        worker.postMessage({
            sysConfig: flightLog.getSysConfig(),
            fieldNames: flightLog.getMainFieldNames(),
            frames: frames,
            opts: opts,
        });
    }

    // exposed functions
    return {
        dump: dump,
    };
};