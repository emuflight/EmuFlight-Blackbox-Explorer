const { app, BrowserWindow, Menu, ipcMain, dialog, shell, globalShortcut } = require('electron');
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
}

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
