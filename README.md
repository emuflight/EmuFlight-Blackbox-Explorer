# Emuflight Blackbox Explorer

[![Latest version](https://img.shields.io/github/v/release/Emuflight/EmuFlight-Blackbox-Explorer)](https://github.com/Emuflight/EmuFlight-Blackbox-Explorer/releases) [![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

![Main explorer interface](screenshots/main-interface.jpg)

This tool allows you to open logs recorded by Emuflight's Blackbox feature in your web browser. You can seek through
the log to examine graphed values at each timestep. If you have a flight video, you can load that in as well and it'll
be played behind the log. You can export the graphs as a WebM video to share with others.

## Installation

### Standalone

Download the installer from [Releases](https://github.com/Emuflight/EmuFlight-Blackbox-Explorer/releases).

### Notes

#### Windows users

The minimum required version of Windows is Windows 8.

#### MacOS X users

Changes to the security model used in the latest versions of MacOS X 10.14 (Mojave) and 10.15 (Catalina) mean that the operating system will show an error message ('"Emuflight\ Blackbox\ Explorer.app" is damaged and can’t be opened. You should move it to the Trash.') when trying to install the application. To work around this, run the following command in a terminal before installing: `sudo xattr -rd com.apple.quarantine /Applications/Emuflight\ Blackbox\ Explorer.app`.

### Unstable Testing Versions

Unstable testing versions of the lates builds of the Emuflight Blackbox Explorer for most platforms can be downloaded from [here](https://github.com/Emuflight/blackbox-log-viewer-nightlies/releases).

**Be aware that these versions are intended for testing / feedback only, and may be buggy or broken.**

## Usage
Click the "Open log file/video" button at the top right and select your log file and your flight video (if you recorded one).

You can scroll through the log by clicking or dragging on the seek bar that appears underneath the main graph. The 
current time is represented by the vertical red bar in the center of the graph. You can also click and drag left and
right on the graph area to scrub backwards and forwards.

### Syncing your log to your flight video

The blackbox plays a short beep on the buzzer when arming, and this corresponds with the start of the logged data.
You can sync your log against your flight video by pressing the "start log here" button when you hear the beep in the
video. You can tune the alignment of the log manually by pressing the nudge left and nudge right buttons in the log
sync section, or by editing the value in the "log sync" box. Positive values move the log toward the end of the video, 
negative values move it towards the beginning.

### Customizing the graph display

Click the "Graph Setup" button on the right side of the display in order to choose which fields should be plotted on
the graph. You may, for example, want to remove the default gyro plot and add separate gyro plots for each rotation axis.
Or you may want to plot vbat against throttle to examine your battery's performance.

## Native app build via Electron/Forge

### Requirements

1. [Node.js](https://nodejs.org/en/) (LTS recommended; see `.nvmrc`)
2. [nvm](https://github.com/nvm-sh/nvm) (Node version manager; optional but recommended for reproducible local Node versions)
3. [Yarn](https://yarnpkg.com/) (`npm install -g yarn`)

### Commands

| Command | Description |
|---------|-------------|
| `yarn start` | Run from source, no devtools auto-open, no build/package step |
| `yarn dev` | Same as `yarn start`, plus devtools auto-open (`NODE_ENV=development`) |
| `yarn debug` | Alias for `yarn dev` |
| `yarn make` | Create release packages for the current host platform (see CI's per-OS matrix in `.github/workflows/build.yml` for all-platform builds) |
| `yarn package` | Build an unpacked application package |

### Build Output

- `out/make/` — packaged applications and installers

**Platform packages:**

- **macOS**: ZIP always, DMG local only (requires `macos-alias`)
- **Windows**: MSI installer + ZIP
- **Linux**: DEB + RPM + ZIP

### macOS DMG Building

**CI (GitHub Actions):** Builds ZIP only (portable, suitable for distribution)

**Local Dev:** To build DMG locally (macOS only):

```bash
yarn make   # Builds both .zip and .dmg — host platform only, see below
```

`@electron-forge/maker-dmg`'s `electron-installer-dmg` dependency (and its own `macos-alias`
native module) is an `optionalDependency`, so it only installs on macOS — no separate manual
install step needed there; `yarn install` already pulled it in. DMG is skipped in CI because
that native module doesn't cross-compile reliably on Linux/Windows runners. ZIP is portable and
sufficient for most use cases.

The DMG background image source (`dmg-background.psd`, in the repo root) exports to
`images/dmg-background.png`, referenced by `forge.config.js`.

## Flight video won't load, or jumpy flight video upon export

Some flight video formats aren't supported by Chrome, so the viewer can't open them. You can fix this by re-encoding
your video using the free tool [Handbrake][]. Open your original video using Handbrake. In the output settings, choose
MP4 as the format, and H.264 as the video codec.

Because of [Google Bug #66631][], Chrome is unable to accurately seek within H.264 videos that use B-frames. This is
mostly fine when viewing the flight video inside Blackbox Explorer. However, if you use the "export video" feature, this
bug will cause the flight video in the background of the exported video to occasionally jump backwards in time for a
couple of frames, causing a very glitchy appearance.

To fix that issue, you need to tell Handbrake to render every frame as an intraframe, which will avoid any problematic
B-frames. Do that by adding "keyint=1" into the Additional Options box:

![Handbrake settings](screenshots/handbrake.png)

Hit start to begin re-encoding your video. Once it finishes, you should be able to load the new video into the Blackbox
Explorer.

[Handbrake]: https://handbrake.fr/
[Google Bug #66631]: http://code.google.com/p/chromium/issues/detail?id=66631

## License

This project is licensed under GPLv3.
