const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

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

  win.loadFile('index.html');

  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }

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

    ipcMain.handle('open-new-window', (event, filePath) => {
      createWindow(filePath || null);
    });

    ipcMain.handle('show-save-dialog', async (event, options) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(win, options);
      return result.canceled ? null : result.filePath;
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

  app.on('activate', () => {
    if (windows.size === 0) {
      createWindow(null, { isFirstWindow: true });
    }
  });
}
