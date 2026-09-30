# AGENTS.md

Project conventions for EmuFlight Blackbox Explorer. Keep this file factual: verify a pattern in
the code before adding it here.

- Coding and Electron/Forge standards: [.github/instructions/ELECTRON-FORGE-JS-BEST-PRACTICES.instructions.md](.github/instructions/ELECTRON-FORGE-JS-BEST-PRACTICES.instructions.md)
- Project overview and usage: [README.md](README.md)
- Issue and support policy: [CONTRIBUTING.md](CONTRIBUTING.md)

## Stack and commands

- Electron + Electron Forge, jQuery, Bootstrap 3. No bundler. Renderer scripts are plain globals
  loaded by `<script>` tags in [index.html](index.html) (order matters).
- Node version: [.nvmrc](.nvmrc). Package manager: `yarn` only (see [package.json](package.json)).
- `yarn install`, `yarn dev` (run the app), `yarn lint` (`eslint .`, config in [eslint.config.js](eslint.config.js)),
  `yarn make` (package).
- There is no test runner and no `test` script. Validate a change with `node --check <file>`,
  `yarn lint`, and by loading a real `.bbl` log in the app.
- Never edit `node_modules/`. Fixes go in tracked source.

## Code map

| Area | File |
|---|---|
| Log header + frame parser, `sysConfig` | [js/flightlog_parser.js](js/flightlog_parser.js) |
| Field/enum tables (`FF_AVERAGING`, `DEBUG_MODE`, ...) | [js/flightlog_fielddefs.js](js/flightlog_fielddefs.js) |
| Field display names + value formatting | [js/flightlog_fields_presenter.js](js/flightlog_fields_presenter.js) |
| Graph curves (scaling) and example graphs | [js/graph_config.js](js/graph_config.js) |
| Graph field picker (`[all]` groups) | [js/graph_config_dialog.js](js/graph_config_dialog.js) |
| Header (config) dialog | [js/header_dialog.js](js/header_dialog.js), markup in [index.html](index.html), styles in [css/header_dialog.css](css/header_dialog.css) |
| Version compare helpers | [js/tools.js](js/tools.js) (`firmwareGreaterOrEqual`) |
| Electron main process | [main.js](main.js) |

## Firmware support

Supported firmware types: Betaflight, Cleanflight, EmuFlight, iNav. [index.html](index.html) has
two header bodies:

- `modal-body no-emuf` (marked `BF/INAV HEADER BODY`): shared by Betaflight, iNav, and Cleanflight.
  Cells inside it use `bf-only` / `no-inav` to show or hide per firmware.
- `modal-body emuf-only` (marked `EMUF ONLY HEADER BODY`): the EmuFlight body, with its own markup
  and its own PID table (`emuf_pid_tuning`).

Change only the body a task names. A Betaflight change must not alter the EmuFlight body.
Both bodies reuse some ids (for example `pid_main`), so select by class or by the body.

- The firmware type and version come from the log's own header lines (`Firmware type`,
  `Firmware revision`). The parser stores them as `sysConfig.firmwareType` and
  `sysConfig.firmwareVersion`.
- Version numbers of different firmwares are unrelated. Compare each against its own type.

## Header pipeline (log header line to screen)

1. `parseHeaderLine()` in [js/flightlog_parser.js](js/flightlog_parser.js) reads `H name:value`.
2. `translateFieldName()` maps a renamed header to its current name through `translationValues`
   (one header line at a time).
3. A `switch (fieldName)` `case` stores the value in `sysConfig`. Integer cases share one group
   that ends in `parseInt`. Other cases use `parseCommaSeparatedString`, raw strings, or floats.
   `sysConfig` defaults are declared once near the top of the parser.
4. A header with no `case` falls to the default branch. It is logged as
   `Ignoring unsupported header` and pushed to `sysConfig.unknownHeaders`.
5. [js/header_dialog.js](js/header_dialog.js) shows known values with `setParameter()` /
   `renderSelect()`, and lists `unknownHeaders` under **Unknown Header Fields**
   (`renderUnknownHeaders()`).

### Rules

- **Parse a header only if the dialog shows it.** A header without a dialog cell must have no
  `case` and no `sysConfig` default, so it appears under Unknown Header Fields. Adding a `case`
  for it removes it from that list.
- To add a displayed header, change all of: the `sysConfig` default, the `case`, an
  `index.html` cell, a `setParameter`/`renderSelect` call, and a `parameterVersion` entry when
  the field is version-limited.
- `parameterVersion` (top of `header_dialog.js`) gates by the table cell's `name` attribute, not
  by the header key. An entry whose name matches no cell has no effect.
  `isParameterValid()` compares `sysConfig.firmwareVersion` to the entry's `min`/`max`.
- A null value adds the `missing` class to the cell. A version mismatch hides the cell.
- Firmware-specific cells carry `bf-only`, `cf-only`, or `emuf-only`. `header_dialog.js` hides
  `bf-only` cells for iNav and EmuFlight logs. The matching rule in `css/header_dialog.css`
  ends in a trailing comma, so do not rely on it to hide or dim cells.
- `updateEmptySections()` (end of the dialog population function) adds `section-empty` (CSS
  `display: none !important`) to a parameter table, or a titled box, in the Betaflight/iNav body
  when none of its named cells is usable. A cell is unusable when it has `missing` or its own or
  its row's `display` is `none`. The class leaves inline display rules intact. The EmuFlight body
  is skipped.
- Select lists come from [js/flightlog_fielddefs.js](js/flightlog_fielddefs.js). Add a list
  there and pass it to `renderSelect()`.

## Frame (trace) fields

- Frame field names come from the log's own `Field I/P/S name` header lines. A field the viewer
  does not know still parses and plots under its raw name.
- `translateLegacyFieldNames()` renames frame fields whose name differs between firmwares or
  versions (for example `gyroData*` to `gyroADC*`, `baroAlt` to `BaroAlt`). It is separate from
  `translationValues`, which renames headers.
- Friendly names: `FRIENDLY_FIELD_NAMES` in the presenter. Value formatting: the `switch` in
  `FlightLogFieldPresenter.decodeFieldToFriendly`. Scaling:
  `GraphConfig.getDefaultCurveForField` in `graph_config.js`. Example graphs:
  `GraphConfig.getExampleGraphConfigs` in `graph_config.js`, guarded by field existence where the
  field is optional.
- `[all]` groups in the field picker are built generically from `name[0]`, `name[1]` siblings.

## Verification rules

- Never guess a version range, a value range, a unit, or an option list. Read the firmware
  source at the tag: `git show <tag>:<path>`. Useful files: `src/main/blackbox/blackbox.c`
  (header and frame fields), `src/main/cli/settings.c` (ranges, lookup tables),
  `src/main/fc/parameter_names.h` (header name constants used from Betaflight 4.3).
- Check the last tag of each minor, and the first tag that has a field, not only one tag.
- `git grep` and `git log -S` over a full firmware clone can take minutes. Prefer
  `git show <tag>:<file>`.
- Match the Betaflight viewer (`betaflight/blackbox-log-viewer`) when changing Betaflight
  handling. Compare its `src/header_dialog.js` and `index.html`. Where its code disagrees with
  the firmware source, follow the firmware and note the difference in the PR.
- State what a check did not cover. No automated test runs on this repo.
