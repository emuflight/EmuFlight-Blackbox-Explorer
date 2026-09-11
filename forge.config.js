const path = require('path');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

// Linux icon path constant for makers (deb, rpm)
const LINUX_ICON = path.resolve(__dirname, 'images/emuf_icon_128.png');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: (() => {
      switch (process.platform) {
        case 'win32':
          return path.resolve(__dirname, 'images/emu_icon.ico');
        case 'darwin':
          return path.resolve(__dirname, 'images/emu_icon.icns');
        case 'linux':
          return path.resolve(__dirname, 'images/emuf_icon_128.png');
        default:
          return path.resolve(__dirname, 'images/emu_icon.icns');
      }
    })(),
    arch: process.env.EBBE_ARCH || undefined,
    executableName: 'emuflight-blackbox-explorer',
  },
  makers: [
    {
      name: '@electron-forge/maker-wix',
      platforms: ['win32'],
      config: {
        exe: 'emuflight-blackbox-explorer',
        icon: './images/emu_icon.ico',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux', 'win32'],
      // Portable ZIP for all platforms: extract and run, no installer needed.
    },
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      config: {
        options: {
          maintainer: 'EmuFlight',
          homepage: 'https://github.com/EmuFlight/EmuFlight-Blackbox-Explorer',
          icon: LINUX_ICON,
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      platforms: ['linux'],
      config: {
        options: {
          homepage: 'https://github.com/EmuFlight/EmuFlight-Blackbox-Explorer',
          icon: LINUX_ICON,
        },
      },
    },
    // DMG maker: skip in CI (macos-alias native module doesn't build reliably in CI).
    // Users can build a DMG locally with: yarn make (macOS only). ZIP is sufficient for
    // distribution on macOS otherwise.
    ...(!process.env.CI && process.platform === 'darwin' ? [{
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        format: 'UDZO',
        background: path.resolve(__dirname, 'images/dmg-background.png'),
      },
    }] : []),
  ],
  plugins: [
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
