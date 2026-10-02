const { app, BrowserWindow, WebContentsView, Menu, ipcMain, dialog, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

// electron-forge's packageAfterCopy hook (forge.config.js) bakes buildMode into the packaged
// app's own package.json — a live env var from the `make` step doesn't survive into a later
// double-click launch, so this is the only way a packaged build can tell it was made with
// `yarn make:debug`/`yarn package:debug`.
function getBuildMode() {
  return require('./package.json').buildMode || 'release';
}

// No menu bar exists to hang a "Toggle Developer Tools" item on (see Menu.setApplicationMenu(null)
// below), so a packaged dev-release build's only way to reach DevTools is this global keybinding.
const DEVTOOLS_ENABLED = process.env.NODE_ENV === 'development' || getBuildMode() !== 'release';

// Register signal handlers at the very top to catch Ctrl+C/SIGTERM before anything else.
// In dev mode (yarn dev), these ensure the process exits without leaving a zombie
// process holding the single-instance lock file.
process.on('SIGINT', () => {
  console.log('SIGINT received, quitting...');
  if (app) {
    app.quit();
    setTimeout(() => process.exit(0), 2000).unref();
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, quitting...');
  if (app) {
    app.quit();
    setTimeout(() => process.exit(0), 2000).unref();
  } else {
    process.exit(0);
  }
});

// One window per opened blackbox log, matching the legacy NW.js "open in new window" behavior.
const windows = new Set();

// Minimum resize dimensions for the initial window; secondary windows use the
// same minimum but a smaller default size (see js/main.js NEW_WINDOW_WIDTH/HEIGHT).
const MIN_WINDOW_WIDTH = 930;
const MIN_WINDOW_HEIGHT = 480;
const NEW_WINDOW_WIDTH = 1000;
const NEW_WINDOW_HEIGHT = 760;

function getWindowIconPath() {
  const iconCandidatesByPlatform = {
    linux: 'images/emuf_icon_128.png',
    win32: 'images/emu_icon.ico',
    darwin: 'images/emu_icon.icns',
  };

  return path.join(__dirname, iconCandidatesByPlatform[process.platform] || iconCandidatesByPlatform.linux);
}

// Persisted app config: zoom level and the last folder used in Open/Save dialogs.
const CONFIG_DIR = path.join(app.getPath('userData'), 'config');
const APP_CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_ZOOM_LEVEL = 0;
const MIN_ZOOM_LEVEL = -9;
const MAX_ZOOM_LEVEL = 9;

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function clampZoom(level) {
  const n = Number(level);
  return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, Number.isNaN(n) ? DEFAULT_ZOOM_LEVEL : n));
}

function loadConfig() {
  try {
    if (fs.existsSync(APP_CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(APP_CONFIG_FILE, 'utf8'));
      return {
        zoomLevel: typeof config.zoomLevel === 'number' ? config.zoomLevel : DEFAULT_ZOOM_LEVEL,
        lastDialogFolder: typeof config.lastDialogFolder === 'string' ? config.lastDialogFolder : '',
      };
    }
  } catch (e) {
    console.error('Failed to load app config:', e);
  }
  return { zoomLevel: DEFAULT_ZOOM_LEVEL, lastDialogFolder: '' };
}

function saveConfig(patch) {
  try {
    ensureConfigDir();
    const sanitizedPatch = {};
    if ('zoomLevel' in patch) {
      sanitizedPatch.zoomLevel = clampZoom(patch.zoomLevel);
    }
    if ('lastDialogFolder' in patch) {
      sanitizedPatch.lastDialogFolder = typeof patch.lastDialogFolder === 'string' ? patch.lastDialogFolder : '';
    }
    const existing = loadConfig();
    fs.writeFileSync(APP_CONFIG_FILE, JSON.stringify({ ...existing, ...sanitizedPatch }, null, 2));
  } catch (e) {
    console.error('Failed to save app config:', e);
  }
}

// Clamps, applies to this window, and persists only on actual change. Reads the window's
// own live zoom as "previous" rather than shared state — BBE opens one window per log, so
// a global zoom variable would desync from whichever window wasn't the one just zoomed.
function applyZoom(win, level) {
  if (!win || win.isDestroyed() || !win.webContents) {
    return;
  }
  const previous = win.webContents.getZoomLevel();
  const clamped = clampZoom(level);
  win.webContents.setZoomLevel(clamped);
  if (clamped !== previous) {
    saveConfig({ zoomLevel: clamped });
  }
  positionFindBar(win);
}

// Ctrl/Cmd +, -, 0 for the app zoom. Shared by the main page and the find bar view, which
// has its own webContents and would otherwise swallow these keys while it has focus.
function handleZoomKey(win, event, input) {
  if (input.code === 'Equal' || input.code === 'NumpadAdd') {
    event.preventDefault();
    applyZoom(win, win.webContents.getZoomLevel() + 1);
  } else if (input.code === 'Minus' || input.code === 'NumpadSubtract') {
    event.preventDefault();
    applyZoom(win, win.webContents.getZoomLevel() - 1);
  } else if (input.code === 'Digit0' || input.code === 'Numpad0') {
    event.preventDefault();
    applyZoom(win, DEFAULT_ZOOM_LEVEL);
  }
}

// Find-in-page. Electron ships no find UI, and chromium find also matches the text of any
// field in the searched page, so the bar lives in its own WebContentsView (find_bar.html,
// js/find_bar.js) that findInPage on the main page never sees.
const FIND_BAR_WIDTH = 380;
const FIND_BAR_HEIGHT = 40;
const FIND_BAR_MARGIN = 8;
const findViews = new Map(); // BrowserWindow -> WebContentsView
const findRequestIds = new Map(); // BrowserWindow -> latest findInPage request id

function findViewOwner(webContents) {
  for (const [win, view] of findViews) {
    if (view.webContents === webContents) {
      return win;
    }
  }
  return null;
}

// The bar follows the main window's zoom: same zoom level in its own page, and the view
// bounds scale with it (view bounds are in unzoomed window pixels).
function positionFindBar(win) {
  const view = findViews.get(win);
  if (!view || win.isDestroyed()) {
    return;
  }
  view.webContents.setZoomLevel(win.webContents.getZoomLevel());
  const factor = win.webContents.getZoomFactor();
  const { width: contentWidth } = win.getContentBounds();
  const width = Math.min(Math.round(FIND_BAR_WIDTH * factor), contentWidth);
  view.setBounds({
    x: Math.max(0, Math.round((contentWidth - width) / 2)),
    y: Math.round(FIND_BAR_MARGIN * factor),
    width,
    height: Math.round(FIND_BAR_HEIGHT * factor),
  });
}

function showFindBar(win) {
  let view = findViews.get(win);
  if (!view) {
    view = new WebContentsView({
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    view.webContents.loadFile('find_bar.html');
    // Zoom set before the page finishes loading is dropped; apply it again once loaded.
    view.webContents.on('did-finish-load', () => positionFindBar(win));
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.control || input.meta) && !input.alt) {
        handleZoomKey(win, event, input);
      }
    });
    findViews.set(win, view);
  }
  win.contentView.addChildView(view); // re-adding an attached view moves it to the top
  positionFindBar(win);
  const focusInput = () => {
    view.webContents.focus();
    view.webContents.send('find-bar-show');
  };
  if (view.webContents.isLoading()) {
    // First open: page not ready yet. One pending callback, however often Ctrl+F repeats.
    if (!view.focusPending) {
      view.focusPending = true;
      view.webContents.once('did-finish-load', () => {
        view.focusPending = false;
        if (!win.isDestroyed()) {
          focusInput();
        }
      });
    }
  } else {
    focusInput();
  }
}

function hideFindBar(win) {
  const view = findViews.get(win);
  if (!view) {
    return;
  }
  findRequestIds.delete(win);
  win.webContents.stopFindInPage('clearSelection');
  win.contentView.removeChildView(view);
  win.webContents.focus();
}

// Page script run when DevTools closes (see createWindow): blur a focused link, and the
// next link to take focus unless the user presses a key or clicks first.
const BLUR_LINK_FOCUS_SCRIPT = `(() => {
  const blurLink = (el) => {
    if (el && el.tagName === 'A') {
      el.blur();
    }
  };
  const cancel = () => {
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('keydown', cancel, true);
    document.removeEventListener('mousedown', cancel, true);
  };
  const onFocusIn = (e) => {
    blurLink(e.target);
    cancel();
  };
  blurLink(document.activeElement);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('keydown', cancel, true);
  document.addEventListener('mousedown', cancel, true);
})()`;

/**
 * Create a window loading index.html. If filePath is given, it is pushed to the
 * renderer as an 'open-blackbox-file' event once the page finishes loading —
 * this is the single mechanism the renderer listens on, whether the file came
 * from the initial launch argv, a file association open, or a second-instance
 * relaunch (see js/main.js onOpenFileAssociation()).
 */
function createWindow(filePath, { isFirstWindow } = {}) {
  const win = new BrowserWindow({
    width: isFirstWindow ? 1280 : NEW_WINDOW_WIDTH,
    height: isFirstWindow ? 800 : NEW_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    icon: getWindowIconPath(),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false, // keep video/graph playback timers running at full rate when unfocused
    },
  });

  windows.add(win);
  win.on('closed', () => windows.delete(win));

  // Open target="_blank"/window.open() links (release notes, update page) in the
  // system browser instead of a second Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Same for direct navigation attempts (e.g. a plain <a> without target="_blank"). This blocks
  // every non-app-origin navigation outright, not just http(s) — with nodeIntegration:true, a
  // navigation to an arbitrary file:// URL would otherwise load untrusted local HTML into this
  // same Node-enabled window, unblocked by an http(s)-only check.
  const appPath = require('url').pathToFileURL(__dirname).toString();
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(appPath)) {
      return;
    }
    event.preventDefault();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
  });

  // Surface renderer console output in the terminal running yarn dev.
  win.webContents.on('console-message', (event) => {
    const { level, message, lineNumber, sourceId } = event;
    if ((level === 'error' || level === 'warning') && message) {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${lineNumber})`);
    }
  });

  // App-content zoom shortcuts. DevTools has its own built-in Ctrl+/-/0 zoom that takes
  // over once a DevTools panel has keyboard focus, so this only needs the page itself.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) {
      return;
    }
    if (input.code === 'KeyF' && !input.shift) {
      event.preventDefault();
      showFindBar(win);
    } else {
      handleZoomKey(win, event, input);
    }
  });

  win.webContents.on('found-in-page', (event, result) => {
    const view = findViews.get(win);
    // Drop results of superseded requests; they would show the old query's count.
    if (view && findRequestIds.get(win) === result.requestId) {
      view.webContents.send('found-in-page-result', {
        active: result.activeMatchOrdinal,
        matches: result.matches,
        final: result.finalUpdate,
      });
    }
  });

  // Closing DevTools makes Chromium focus the first link and draw its focus ring. The
  // focus can land before or after this event, so blur a focused link now and arm a
  // one-shot blur for the next link focus; any key press or click cancels it.
  win.webContents.on('devtools-closed', () => {
    if (win.isDestroyed()) {
      return;
    }
    win.webContents.executeJavaScript(BLUR_LINK_FOCUS_SCRIPT).catch(() => {
      // Window closed while the script was pending; nothing left to blur.
    });
  });

  win.on('resize', () => positionFindBar(win));
  win.on('closed', () => {
    const view = findViews.get(win);
    findViews.delete(win);
    findRequestIds.delete(win);
    // A child view's webContents is not released with its window.
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.close();
    }
  });

  win.loadFile('index.html');

  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }

  // New windows inherit the persisted zoom level.
  win.webContents.once('did-finish-load', () => {
    applyZoom(win, loadConfig().zoomLevel);
  });

  if (filePath) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('open-blackbox-file', filePath);
    });
  }

  return win;
}

// Same extensions js/main.js's loadFiles() itself recognizes as openable.
const OPENABLE_FILE_RE = /\.(?:bbl|txt|cfl|bfl|log|avi|mov|mp4|mpeg|json)$/i;

function getFilePathFromArgs(args, workingDirectory = process.cwd()) {
  // Don't assume a fixed argv index for the file path: in dev mode, Forge/Electron's own
  // positional args (the executable path, the app directory "." Forge passes) aren't always at
  // the same index across invocation methods (yarn dev vs. electron-forge start directly), and
  // the executable path itself is a real file too — an existence check alone isn't enough to
  // rule it out. Match by extension against what the app itself can actually open, and require
  // it to be a real file (not a directory that happens to share the extension pattern, e.g. a
  // folder literally named "backup.json") — fs.existsSync alone doesn't distinguish those, and
  // reading a directory as a file crashes with EISDIR downstream.
  // A relative arg resolves against workingDirectory, not this process's own cwd — matters for
  // 'second-instance', where a new launch's cwd can differ from the already-running instance's.
  const filePath = args.find((arg) => {
    if (!OPENABLE_FILE_RE.test(arg)) {
      return false;
    }
    try {
      return fs.statSync(path.resolve(workingDirectory, arg)).isFile();
    } catch (e) {
      return false;
    }
  });
  return filePath ? path.resolve(workingDirectory, filePath) : null;
}

// macOS can emit 'open-file' before 'ready' (e.g. a file dropped on the dock icon while the app
// wasn't running yet), once per selected file if the user opened several at once — each call
// would overwrite a single pending value, silently dropping all but the last. Queue them here
// instead of chaining a second whenReady().then() onto the initial-window creation below — both
// firing once ready resolves would open duplicate windows for what's really one launch.
let pendingOpenFilePaths = [];

const lockAcquired = app.requestSingleInstanceLock();

if (!lockAcquired) {
  console.log('Another instance is already running. Exiting.');
  app.quit();
} else {
  app.on('second-instance', (event, argv, workingDirectory) => {
    // A second launch (e.g. double-clicking another .BBL) opens a new window in
    // this process instead of spawning a second one.
    createWindow(getFilePathFromArgs(argv, workingDirectory));
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // no menu bar, matching the legacy NW.js window

    if (DEVTOOLS_ENABLED) {
      // Registered globally (not a per-window before-input-event handler) so it dispatches
      // reliably even once a DevTools panel itself has keyboard focus. Two accelerators, matching
      // EmuConfigurator's toggleDevTools menu role (which gets CommandOrControl+Shift+I as its
      // role default) plus its hidden F12 duplicate — an explicit accelerator on a role item
      // replaces the role default rather than adding to it, so EFC needs two menu items for two
      // triggers; a menu-less globalShortcut just registers both directly.
      const toggleDevTools = () => {
        const win = BrowserWindow.getFocusedWindow();
        if (win) {
          win.webContents.toggleDevTools();
        }
      };
      globalShortcut.register('F12', toggleDevTools);
      globalShortcut.register('CommandOrControl+Shift+I', toggleDevTools);
    }

    ipcMain.handle('find-in-page', (event, text, options) => {
      const win = findViewOwner(event.sender);
      if (!win || typeof text !== 'string' || text === '') {
        return;
      }
      const { forward, newSession } = options || {};
      // Electron's findNext flag means "begin a new session": true starts one, false steps
      // within it. Stepping with true restarts the session and repeats a match at the wrap.
      const findOptions = { findNext: newSession === true };
      if (forward === false) {
        findOptions.forward = false;
      }
      findRequestIds.set(win, win.webContents.findInPage(text, findOptions));
    });

    ipcMain.handle('stop-find-in-page', (event) => {
      const win = findViewOwner(event.sender);
      if (win) {
        findRequestIds.delete(win);
        win.webContents.stopFindInPage('clearSelection');
      }
    });

    ipcMain.handle('close-find-bar', (event) => {
      const win = findViewOwner(event.sender);
      if (win) {
        hideFindBar(win);
      }
    });

    ipcMain.handle('open-new-window', (event, filePath) => {
      createWindow(filePath || null);
    });

    ipcMain.handle('show-save-dialog', async (event, options) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      // chooseEntry() (js/nwjs_compat_shim.js) always passes a bare filename here, never a
      // directory — join it with the remembered folder so Save reopens where Open/Save last left off.
      const lastFolder = loadConfig().lastDialogFolder;
      const defaultPath = lastFolder && options.defaultPath
        ? path.join(lastFolder, options.defaultPath)
        : options.defaultPath;
      const result = await dialog.showSaveDialog(win, { ...options, defaultPath });
      if (result.canceled) {
        return null;
      }
      saveConfig({ lastDialogFolder: path.dirname(result.filePath) });
      return result.filePath;
    });

    // Same extensions the file-open buttons' <input accept> attribute used to enforce.
    const OPENABLE_FILE_FILTER = {
      name: 'Blackbox log, video or workspace files',
      extensions: ['bbl', 'txt', 'cfl', 'bfl', 'log', 'avi', 'mov', 'mp4', 'mpeg', 'json'],
    };

    ipcMain.handle('show-open-dialog', async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      // Single-select only: drag-and-drop (js/main.js onOpenFileAssociation()) only ever
      // takes dataTransfer.files[0] too, so multi-file open was never consistently supported.
      const result = await dialog.showOpenDialog(win, {
        defaultPath: loadConfig().lastDialogFolder || undefined,
        filters: [OPENABLE_FILE_FILTER],
        properties: ['openFile'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      saveConfig({ lastDialogFolder: path.dirname(result.filePaths[0]) });
      return result.filePaths[0];
    });

    const initialFilePath = pendingOpenFilePaths.length > 0
      ? pendingOpenFilePaths.shift()
      : getFilePathFromArgs(process.argv);
    createWindow(initialFilePath, { isFirstWindow: true });
    // Any further queued paths (multiple files opened at once, pre-ready) each get their own
    // window, matching the one-window-per-log behavior 'second-instance'/'open-file' use post-ready.
    pendingOpenFilePaths.forEach((filePath) => createWindow(filePath));
    pendingOpenFilePaths = [];
  });

  // macOS: file association / drag-onto-dock-icon open.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (app.isReady()) {
      createWindow(filePath);
    } else {
      // Don't create a window here — the whenReady() handler above drains pendingOpenFilePaths
      // for the app's initial window(s) once it fires.
      pendingOpenFilePaths.push(filePath);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('activate', () => {
    if (windows.size === 0) {
      createWindow(null, { isFirstWindow: true });
    }
  });
}
