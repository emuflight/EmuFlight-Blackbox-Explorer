# AGENTS.md

Design and logic expectations for EmuFlight Blackbox Explorer. Verify a pattern in code before
adding it here.

- Coding standards: [.github/instructions/ELECTRON-FORGE-JS-BEST-PRACTICES.instructions.md](.github/instructions/ELECTRON-FORGE-JS-BEST-PRACTICES.instructions.md)
- Usage: [README.md](README.md) · Issues and support: [CONTRIBUTING.md](CONTRIBUTING.md)

## Stack

- Electron + Forge, jQuery, Bootstrap 3, no bundler. Renderer scripts are plain globals loaded
  by `<script>` tags in [index.html](index.html); order matters.
- Window uses `nodeIntegration: true`, `contextIsolation: false`; no preload script
  ([main.js](main.js)). No application menu (`Menu.setApplicationMenu(null)`).
- Global shortcuts in `main.js`: DevTools keys only when `DEVTOOLS_ENABLED`; zoom keys in a
  `before-input-event` handler in every mode.
- `yarn` only; Node per [.nvmrc](.nvmrc). `yarn dev`, `yarn lint`, `yarn make`. Never edit
  `node_modules/`.
- No test runner. Validate with `node --check`, `yarn lint`, and real `.bbl` logs.

## Code map

| Area | File |
|---|---|
| Header + frame parser, `sysConfig` | [js/flightlog_parser.js](js/flightlog_parser.js) |
| Enum / select lists | [js/flightlog_fielddefs.js](js/flightlog_fielddefs.js) |
| Field names, value formatting | [js/flightlog_fields_presenter.js](js/flightlog_fields_presenter.js) |
| Graph curves, example graphs | [js/graph_config.js](js/graph_config.js) |
| Header dialog | [js/header_dialog.js](js/header_dialog.js), [index.html](index.html), [css/header_dialog.css](css/header_dialog.css) |
| Version helpers | [js/tools.js](js/tools.js) (`firmwareGreaterOrEqual`) |

## Firmware and header bodies

- Types: Betaflight, Cleanflight, EmuFlight, iNav. Type and version come from the log's
  `Firmware type` / `Firmware revision` lines (`sysConfig.firmwareType`, `.firmwareVersion`).
  Compare a version only against its own type.
- `index.html` has two header bodies:
  - `modal-body no-emuf`: Betaflight, iNav, Cleanflight. `bf-only` / `no-inav` cells.
  - `modal-body emuf-only`: EmuFlight, with its own PID table (`emuf_pid_tuning`).
- Change only the body a task names. Both bodies reuse ids (for example `pid_main`); select by
  class or body.

## Header pipeline

1. `parseHeaderLine()` reads `H name:value`. Betaflight 4.0+ `feedforward_weight` is renamed
   `ff_weight` first; otherwise `translateFieldName()` applies `translationValues`.
2. A `case` stores the value in `sysConfig` (defaults declared once at the top of the parser).
3. No `case`: logged as `Ignoring unsupported header`, pushed to `sysConfig.unknownHeaders`, and
   listed under **Unknown Header Fields** (`renderUnknownHeaders()`).
4. The dialog fills cells with `setParameter()` / `setParameterFloat()` / `renderSelect()`.

Rules:
- Parse a header only if the dialog shows it. A header without a cell gets no `case` and no
  default, so it lands in Unknown Header Fields.
- A displayed header needs: `sysConfig` default, `case`, `index.html` cell, dialog call, and a
  `parameterVersion` entry if version-limited.
- `parameterVersion` (top of `header_dialog.js`) gates by the cell's `name` attribute, never the
  header key. A name matching no cell does nothing.
- A missing value adds `missing` (red). In the Betaflight/iNav body the setters also clear the
  input and show a blank select option. The EmuFlight body keeps its old handling
  (`isEmufBody()`).
- `bf-only` cells are hidden by `header_dialog.js` for iNav and EmuFlight logs, not by CSS.
- `updateEmptySections()` adds `section-empty` (`display: none !important`) to a parameter table
  or titled box with no usable value cell. Value cell = named cell holding an input or select.
  Unusable = `missing`, or own or row `display: none`. Skips the EmuFlight body and boxes holding
  other tables or unnamed inputs.
- PID table (`#pid_main.pid_tuning`): six equal columns (label, P, I, D Max, D, FF). Arrays are
  `[P, I, D, D Max (d_min), FF]`; `ff_weight` pads to length 4 first. FF column shows for
  Betaflight 4.0+.

### Version gates (firmware-verified)

| Cell | Range |
|---|---|
| antiGravityMode / antiGravityThreshold | up to 4.3.x (gain: 3 decimals up to 4.3.x) |
| anti_gravity_cutoff_hz, anti_gravity_p_gain | 4.4+ |
| feedforwardBoost, dynNotchCount / Q / MinHz | 4.1+ |
| dynNotchMaxHz | 4.2+ |
| simplified_* (PID and filter sliders) | 4.3+ |
| rcSmoothingRxAverage | up to 4.4.x |
| rcSmoothingRxSmoothed, thrust_linear | 4.5+ |
| dyn_idle_start_increase | 4.5.x |

## Frame fields

- Names come from the log's `Field I/P/S name` lines. An unknown field still parses and plots
  under its raw name.
- `translateLegacyFieldNames()` renames frame fields across firmwares and versions (separate
  from `translationValues`, which renames headers): `gyroData*`, `baroAlt`, iNav `vbat`.
- Friendly names: `FRIENDLY_FIELD_NAMES`. Value text: `FlightLogFieldPresenter.decodeFieldToFriendly`.
  Scale: `GraphConfig.getDefaultCurveForField`. Example graphs: `GraphConfig.getExampleGraphConfigs`
  (guard optional fields by existence). `[all]` picker groups are built from `name[n]` siblings.
- `eRPM[n]` logs `eRPM / 100`; shown as rpm and Hz from `motor_poles`.

## Verification

- Never guess a range, unit, version, or option list. Read firmware at the tag:
  `git show <tag>:<path>`. Files: `src/main/blackbox/blackbox.c` (fields),
  `src/main/cli/settings.c` (ranges, lookups), `src/main/fc/parameter_names.h` (names, 4.3+).
- Check the first tag with a field and the first and last tag of each minor; header names can
  change between point releases.
- Avoid `git grep` and `git log -S` on a full firmware clone; they take minutes.
- Match the Betaflight viewer (`betaflight/blackbox-log-viewer`) for Betaflight handling; where
  it disagrees with firmware source, follow the firmware.
- Headless header check: load `flightlog_fielddefs`, `tools`, `cache`, `datastream`, `decoders`,
  `imu`, presenter, parser, `flightlog_index`, `flightlog` into a Node `vm` with stubbed `$`
  (including `$.extend`); open a log and capture `Ignoring unsupported header` messages.
- State what a check did not cover.
