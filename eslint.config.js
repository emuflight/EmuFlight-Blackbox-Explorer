const globals = require("globals");

module.exports = [
  {
    ignores: ["dist/", "out/", "node_modules/", "js/vendor/"],
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jquery,
        "chrome": "readonly",
        "THREE": "readonly",
        "Modernizr": "readonly",
        "ArrayDataStream": "writable",
        "Craft2D": "writable",
        "Craft3D": "writable",
        "ExpoCurve": "writable",
        "FIFOCache": "writable",
        "FlightLog": "writable",
        "FlightLogEvent": "writable",
        "FlightLogGrapher": "writable",
        "FlightLogParser": "writable",
        "FlightLogFieldPresenter": "writable",
        "FlightLogIndex": "writable",
        "GraphConfig": "writable",
        "GraphLegend": "writable",
        "WorkspaceSelection": "writable",
        "IMU": "writable",
        "SeekBar": "writable",
      },
    },
    rules: {
      "no-debugger": "warn",
      "no-unused-vars": ["warn", {
        vars: "local",
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^[A-Z_][A-Z0-9_]*$",
      }],
      "complexity": "warn",
      "curly": "warn",
      "eqeqeq": ["warn", "smart"],
      "no-case-declarations": "warn",
      "no-fallthrough": "warn",
      "no-unreachable": "warn",
    },
  },
];
