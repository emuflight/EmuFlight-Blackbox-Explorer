"use strict";

/**
 * Workspaces seeded on a fresh install (no saved 'workspaceGraphConfigs' pref).
 * Field names are those an EmuFlight log provides: axisP/I/D/F, gyroADC, motor, and the derived
 * rcCommands (scaled setpoint). adaptGraphs() drops any field missing from the opened log and
 * fills each missing curve with the per-log default scaling.
 * Slot index = workspace id (1-9, 0 last).
 */
function getDefaultWorkspaces() {
    const PALETTE = ["#fb8072", "#8dd3c7", "#ffffb3", "#bebada", "#80b1d3", "#fdb462"];

    // rows: [name, smoothing]
    const graph = (label, rows) => ({
        label: label,
        height: 1,
        fields: rows.map((row, index) => ({
            name: row[0],
            smoothing: row[1],
            color: PALETTE[index % PALETTE.length],
            lineWidth: 1,
        })),
    });

    const axisGraphs = (axis, axisName) => [
        graph("Gyro vs Setpoint " + axisName, [["gyroADC[" + axis + "]", 2000], ["rcCommands[" + axis + "]", 0]]),
        graph("PIDs " + axisName, [["axisP[" + axis + "]", 2000], ["axisI[" + axis + "]", 0], ["axisD[" + axis + "]", 2000], ["axisF[" + axis + "]", 0]]),
    ];

    const workspaces = [];
    workspaces[1] = {
        title: "EmuFlight Default",
        graphConfig: [].concat(
            axisGraphs(0, "Roll"),
            axisGraphs(1, "Pitch"),
            axisGraphs(2, "Yaw"),
            [graph("Motors", [["motor[0]", 2000], ["motor[1]", 2000], ["motor[2]", 2000], ["motor[3]", 2000], ["rcCommands[3]", 0]])]
        ),
    };
    return workspaces;
}
