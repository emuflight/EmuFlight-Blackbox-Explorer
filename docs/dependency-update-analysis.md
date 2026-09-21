# Dependency Update Analysis

Analysis-only document produced in response to the request to evaluate the
outdated dependencies listed by `yarn outdated` on `master`. No dependency
bumps are applied here; follow-up issues should be filed per package once
this analysis is reviewed.

| Package | Current | Latest | Type |
|---|---|---|---|
| bootstrap | 3.4.1 | 5.3.8 | dependencies |
| electron | 42.10.1 | 44.3.0 | devDependencies |
| eslint | 8.57.1 | 10.10.0 | devDependencies |
| @electron/fuses | 1.8.0 | 2.1.3 | devDependencies |
| lodash | 4.17.21 | 4.18.1 | dependencies |

## bootstrap (3.4.1 → 5.3.8) — **high risk, major rewrite required**

Bootstrap 5 is a rewrite that **drops the jQuery dependency entirely** and
renames most of the `data-*` attributes used to wire up interactive
components. This repo still ships and uses the Bootstrap 3 jQuery-plugin
API extensively:

- `index.html` loads `node_modules/bootstrap/dist/js/bootstrap.min.js`
  together with a vendored **jQuery 1.11.3** (`js/vendor/jquery-1.11.3.min.js`),
  which the Bootstrap 3 build requires as a runtime global (`window.jQuery`).
- `index.html` contains **76** occurrences of the Bootstrap 3 `data-toggle`,
  `data-dismiss`, `data-target`, and `data-parent` attributes. In Bootstrap 5
  these were renamed with a `bs-` prefix (e.g. `data-toggle` → `data-bs-toggle`,
  `data-dismiss` → `data-bs-dismiss`).
- `index.html` also contains ~46 uses of Bootstrap-3-only markup/classes such
  as `panel panel-*`, `well`, `jumbotron`, and `glyphicon` icons — all removed
  or replaced (`card`, plain utility classes, Bootstrap Icons) in Bootstrap 5.
- The application code calls the jQuery plugin API directly (`.modal(...)`,
  `.tooltip(...)`, `.tab(...)`, etc.) in `js/main.js`, `js/graph_config_dialog.js`,
  `js/header_dialog.js`, `js/keys_dialog.js`, `js/user_settings_dialog.js`,
  and `js/video_export_dialog.js`. Bootstrap 5 replaces this with a plain-JS
  API (`bootstrap.Modal.getOrCreateInstance(el).show()`, etc.) — the jQuery
  plugin calls no longer exist unless jQuery is kept as an unofficial add-on.
- Bootstrap 5 also drops the separate `bootstrap-theme.min.css` file that
  `index.html` still references, and changes the grid/utility class names
  (e.g. `visible-*-xs`/`hidden-*-xs`, `pull-left`/`pull-right`).

**Conclusion:** the 3 → 5 jump is not a drop-in bump. It requires migrating
every `data-*` attribute, every jQuery plugin call, and a pass over markup/
class names across `index.html` and the dialog/UI modules. This should be
tracked as its own migration effort, not a routine dependency bump.

**jQuery note:** since Bootstrap 5 no longer requires jQuery, once the
Bootstrap migration lands the vendored jQuery 1.11.3 dependency should be
re-evaluated. If jQuery continues to be used directly by application code
(it is, e.g. `js/vendor/jquery.nouislider.all.min.js`,
`js/vendor/jquery.ba-throttle-debounce.js`), it should be constrained to the
latest jQuery **3.x** release — jQuery 4.x is a separate breaking change
(removal of deprecated APIs, `$.trim`, `$.isFunction`, etc. — see jQuery's
own upgrade guide) and should not be bundled with the Bootstrap migration.

## electron (42.10.1 → 44.3.0) — **moderate risk**

- Both Electron 42 and Electron 44 bundle the **Node.js 24.x** line, so the
  `engines.node` constraint (`>=24.0.0`) in `package.json` and `.nvmrc` (`24`)
  remain satisfied; no Node major-version bump is required for this jump.
- Chromium moves from ~148 to ~152. There are no native Node addons in this
  project (`yarn.lock`/`package.json` show no compiled/native dependencies),
  so there is no `NODE_MODULE_VERSION`/ABI rebuild concern for this repo.
- The project's `@electron-forge/*` tooling (CLI, makers, fuses plugin) is
  pinned to `7.11.2`. Forge 7.11.x is the current major line and is expected
  to support Electron 44, but this should be re-verified against the
  `@electron-forge/cli` release notes at bump time, since Forge major
  releases sometimes track specific Electron majors.
- `forge.config.js` configures fuses via `FuseVersion.V1` / `FuseV1Options`
  (see below) — this API is unaffected by the Electron bump itself.

**Conclusion:** the Electron bump is lower risk than the Bootstrap/eslint
changes because the Node major version doesn't change, but the Forge/fuses
toolchain compatibility with Electron 44 should be confirmed before bumping.

## eslint (8.57.1 → 10.10.0) — **high risk, config migration required**

- This repository currently uses the **legacy `.eslintrc.json` format**
  (`env`, `parserOptions`, `globals`, `ignorePatterns`) — there is no
  `eslint.config.js` in the repo yet.
- ESLint 9 made **flat config (`eslint.config.js`) the default** and ESLint
  10 **removes support for the legacy eslintrc format entirely** (the
  `ESLINT_USE_FLAT_CONFIG=false` escape hatch and `.eslintrc.*` support that
  existed as a bridge in v9 are gone in v10). A straight bump to eslint 10
  will make `yarn lint` fail outright because `.eslintrc.json` will no
  longer be read.
- Migrating requires converting `.eslintrc.json` to `eslint.config.js`:
  - `env: { browser, es2021, node }` → `languageOptions.globals` (from
    the `globals` npm package) plus `languageOptions.ecmaVersion`.
  - `globals: { $, jQuery, THREE, ... }` → merged into
    `languageOptions.globals`.
  - `parserOptions` → `languageOptions.ecmaVersion` /
    `languageOptions.sourceType`.
  - `rules` → unchanged in shape, but `"eslint:recommended"` (implicit in
    v8 setups) must be imported explicitly via `@eslint/js`'s
    `js.configs.recommended` in flat config.
  - `ignorePatterns` → a config object with an `ignores` array (or a
    dedicated global-ignores object) since flat config has no top-level
    `ignorePatterns` key.
- No `eslint.config.js` currently exists in this repo, so this migration
  has to be authored from scratch rather than adjusted.

**Conclusion:** bumping eslint past v9 requires writing a new
`eslint.config.js` (flat config) equivalent to the current `.eslintrc.json`
before the version bump can land, or CI's `yarn lint` step will break.

## @electron/fuses (1.8.0 → 2.1.3) — **low risk**

- `forge.config.js` uses `FuseVersion.V1` and `FuseV1Options` from
  `@electron/fuses` via `@electron-forge/plugin-fuses`.
- The current upstream `@electron/fuses` API (as of the 2.x line) still
  exposes `FuseVersion.V1` / `FuseV1Options` unchanged — v2 primarily adds
  new fuses/options (and an opt-in `strictlyRequireAllFuses` safety check)
  rather than renaming the existing V1 API surface.
- Because this project does not set `strictlyRequireAllFuses: true`, a bump
  should not fail the build even if newer fuses are introduced for Electron
  44.

**Conclusion:** safe to bump independently, but should be bumped alongside
(or after) the Electron major bump so `@electron/fuses` matches the fuses
available in the target Electron binary.

## lodash (4.17.21 → 4.18.1) — **low risk**

- This is a patch/minor bump within the same major version (4.x). No
  breaking API changes are expected; safe to bump on its own with normal
  regression testing (no code changes anticipated).

## Summary / recommended follow-up issues

1. **eslint 8 → 10**: author `eslint.config.js` (flat config) equivalent to
   `.eslintrc.json`, verify `yarn lint` passes, then bump `eslint`/add
   `@eslint/js`.
2. **bootstrap 3 → 5 (+ jQuery)**: dedicated UI migration — replace
   `data-toggle`/`data-dismiss`/`data-target`/`data-parent` attributes,
   replace jQuery plugin calls (`.modal()`, `.tooltip()`, `.tab()`, etc.)
   with the Bootstrap 5 JS API, update removed/renamed classes
   (`panel`, `well`, `jumbotron`, `glyphicon`, grid visibility helpers), and
   re-evaluate whether jQuery (constrained to 3.x, not 4.x) is still needed
   afterwards.
3. **electron 42 → 44**: verify `@electron-forge/*` 7.11.x / fuses plugin
   compatibility with Electron 44, then bump.
4. **@electron/fuses 1.8.0 → 2.1.3**: bump alongside the Electron update.
5. **lodash 4.17.21 → 4.18.1**: routine patch bump, no migration needed.
