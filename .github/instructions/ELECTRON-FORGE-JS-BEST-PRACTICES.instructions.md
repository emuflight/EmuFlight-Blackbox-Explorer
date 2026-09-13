---
name: Electron Forge JS Best Practices
description: Best-practices guide for Electron Forge, JavaScript, and jQuery in EmuFlight Blackbox Explorer
applyTo: 'main.js, index.js, forge.config.js, js/**/*.js, *.{json,yml,md}, .github/**/*.md, index.html'
---

# Electron/Forge JavaScript Project Best Practices

## 1. General Principles

- Use standard, linear commits; avoid `git commit --amend` or history rewrites unless explicitly required.
- Keep all debugging logs transparent; never suppress errors or unknowns — log for root-cause analysis.
- Remove code only once it is actually unreachable, confirmed by checking call sites — not on the
  assumption that "post-migration" makes something dead. `js/nwjs_compat_shim.js` looks like
  migration leftover but is load-bearing; see § 11 (Legacy & Compatibility).

## 2. Electron/Forge & Node Integration

- Use Electron Forge for packaging, building, and cross-platform support.
- Keep all Electron main-process code in `main.js`; renderer logic lives in `js/`, third-party
  vendor scripts in `js/vendor/`. There is no preload script or `contextBridge` — see § 5
  (Electron Security).
- `require()` is used throughout `main.js` and in renderer code, since `nodeIntegration: true`
  gives every renderer script a real Node `require()` (`index.html`, `js/main.js`,
  `js/nwjs_compat_shim.js`, `js/tools.js` all use it directly) — do not read this as
  Node/Electron-context-only. The actual boundary is web workers: `js/webworkers/*.js` run
  without Node integration and use `importScripts()`, not `require()`.
- Use `process.env.NODE_ENV` for environment-specific logic (dev vs. prod).

### Process Lifecycle & Signal Handling

- Register `process.on('SIGINT')` and `process.on('SIGTERM')` handlers at the very top of `main.js`,
  before any other logic — this is the existing convention, keep new lifecycle code consistent with it.
- These handlers ensure graceful shutdown and prevent zombie processes holding the single-instance
  lock file (relevant in dev mode with `electron-forge start` watch).
- Always log signal/exit handling for debugging dev/prod lifecycle issues.

### IPC Handlers

- Define `ipcMain.handle()` handlers in `main.js`, one per feature (file dialogs, window creation).
- Use async/await in IPC handlers; always handle errors and don't suppress them.
- For binary file operations, use `Buffer.from()` and `arrayBuffer()`/`Uint8Array` conversions to
  avoid data corruption — see § Chrome API Compatibility Shim below for the existing pattern.

## 3. JavaScript & jQuery

- Use strict mode (`'use strict';`) in new JS files. Only a minority of existing files declare
  it (`js/gui.js`, `js/configuration.js`, `js/localization.js`, and a few dialog modules) —
  JSHint's `globalstrict: true` permits it repo-wide, but it isn't yet a universal convention.
  Don't treat its absence in an untouched file as something to retrofit incidentally.
- This codebase loads jQuery, Bootstrap, and other libraries as plain globals via `<script>` tags
  in `index.html` (no bundler, no ES modules) — match this pattern for new vendor scripts rather
  than introducing a second module system.
- Always namespace global variables and functions to avoid collisions.
- Use `let`/`const` for all new variable declarations; avoid `var` except for legacy compatibility.
- **NaN vs. falsy coercion:** never use `Number(x) || fallback` for numeric defaults — `0` is
  falsy and gets incorrectly replaced. Use `Number.isNaN(Number(x)) ? fallback : Number(x)`.
- **Null guards at call-site:** guard optional object references (e.g.
  `BrowserWindow.getFocusedWindow()`) with `if (obj)` before passing them to functions, even when
  the callee has an internal guard — consistency prevents silent no-ops that are hard to trace.
- **Single entry point for shared state:** route all mutations to a shared variable through one
  orchestrating function. `setGraphZoom()` (`js/main.js:499`) is the only site that assigns
  `graphZoom` — every caller (`.graph-zoom-control` slider, keyboard shortcuts, double-click
  reset) goes through it rather than mutating the variable directly. Thin helpers that update
  state directly create bypass paths that cause desynchronization.
- **`for...of` must declare the loop variable:** always write `for (const item of array)` — bare
  `for (item of array)` without `const`/`let` creates an implicit global in sloppy mode and throws
  `ReferenceError` in strict mode. This is a silent runtime-only failure that linters may not catch.

## 4. 3rd Party Dependencies & Yarn

- Use yarn for all dependency management; never mix with npm.
- Use Yarn 1.x (Classic) only — `packageManager` in `package.json` pins this.
- Commit `yarn.lock` to version control.
- Follow the existing `package.json` convention of range-based version specifiers (`^`, `~`), not
  exact pins — `bootstrap: "~3.4.1"`, `html2canvas: "^1.0.0-rc.5"`, `lodash: "^4.17.21"`. Commit
  `yarn.lock` to keep installs reproducible despite the ranges.
- New browser-side libraries are vendored under `js/vendor/`, not installed via npm — match this
  for consistency with the existing script-tag loading model.
- Use the latest stable Node.js LTS per the engines field in `package.json`; update
  `.github/workflows/*` when a new LTS is released.

## 5. Electron Security

- `main.js` uses `nodeIntegration: true` and `contextIsolation: false` for every `BrowserWindow` —
  required by the current jQuery/global-script renderer architecture. There is no preload script
  or `contextBridge` anywhere in this codebase.
- Don't add `contextIsolation: true` or a preload script for a single feature without also
  restructuring how the renderer loads scripts — a partial change leaves two conflicting security
  models in the same window.
- Validate IPC message arguments before they reach `fs`/`shell`/`dialog` calls. The current
  handlers (`show-save-dialog`, `open-new-window` in `main.js`) pass `options`/`filePath` straight
  through unvalidated — treat that as a gap to close on touch, not a pattern to copy for new
  handlers.

## 6. Testing & Linting

- Uses JSHint (`.jshintrc`), not ESLint — declare new browser globals under `globals` there.
- No test runner is configured. `test/index.js` is a standalone script loaded by `test/index.html`
  in a browser, asserting `ExpoCurve` math with a hand-rolled `assert()` that throws a bare
  string and reports via `alert()`. There is no `test` script in `package.json` and no CI test
  step. Never report "tests pass" for this repo — say explicitly that no harness exists instead.
- Adding a test framework requires explicit user go-ahead before touching `package.json`/`yarn.lock`.

## 7. Documentation & Instructions

- Keep all project instructions in `.github/instructions/` with a clear `applyTo:` pattern.
- Keep `README.md` up to date with build, run, and contribution instructions.

## 8. UI/UX

- Use CSS classes for styling; avoid inline styles.
- Keep dialogs and modals compact: use `max-height`, `overflow-y: auto`, and consistent padding.
- The handful of existing user-facing strings that go through `chrome.i18n.getMessage()`
  (`_locales/en/messages.json`, e.g. the update-notice dialog) should keep using that path for
  edits — most of the UI is plain hardcoded text and does not need a translation key added.

## 9. Chrome API Compatibility Shim

- `js/nwjs_compat_shim.js` polyfills the subset of Chrome Apps APIs NW.js used to provide
  (`chrome.storage`, `chrome.i18n`, `chrome.runtime`, `chrome.fileSystem`) that Electron doesn't —
  it must load before any script that touches `chrome.*`, and it is a plain global script, not a
  preload/`contextBridge` module.
- The `chrome.fileSystem` FileWriter shim (`makeFileWriter()`) tracks `position` and the open file
  descriptor itself — it is not the real File API's `FileWriter`. Any change to it must preserve:
  partial-write retry (`fs.write()` can return fewer `bytesWritten` than requested), a hard error
  on a zero-byte write against a non-empty remainder (rather than looping), and calling
  `onerror`/`onwriteend` on every code path, including a rejected `blob.arrayBuffer()` — the
  caller (`js/vendor/webm-writer`) awaits one of those before issuing the next write and stalls
  forever otherwise.
- `close()` is not part of the real `FileWriter` contract; callers (e.g.
  `js/flightlog_video_renderer.js`) must call it explicitly once an export finishes or is
  cancelled — nothing else closes the descriptor.

## 10. Version Control & Branching

- Use feature branches for all new work; keep `master` clean.
- Never force-push to shared branches unless coordinated; document the reason when it happens.

## 11. Legacy & Compatibility

- The NW.js -> Electron/Forge packaging migration is complete; remaining "legacy" surface is the
  jQuery/global-script renderer model and the `nwjs_compat_shim.js` polyfills above — both
  intentional, not migration debt to clean up opportunistically.
- Remove legacy code only after confirming no active code path depends on it.
