// [PowerApp Desktop] Electron Forge configuration - v1.0.0
// Docs: https://www.electronforge.io/configuration
module.exports = {
  packagerConfig: {
    asar: true,
    // `config.json` is intentionally NOT bundled. It lives next to the app so the
    // wizard can write it into the project folder and users can edit it by hand.
    // When packaging, copy `config.example.json` to `config.json` alongside the output.
    ignore: [/^\/\.github($|\/)/, /^\/Research_Tools($|\/)/, /^\/wizard\.html$/]
  },
  rebuildConfig: {},
  makers: [
    {
      // Windows installer
      name: '@electron-forge/maker-squirrel',
      config: {}
    },
    {
      // macOS / Linux ZIP archive
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux']
    }
  ]
};
