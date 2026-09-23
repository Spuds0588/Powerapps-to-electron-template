// [PowerApp Desktop] test/browser/verify-pages.js
//
// Runs the browser suite against the *live* GitHub Pages deployment instead of
// the working tree, so a push can be confirmed to have actually published the
// wizard. Kept as a script rather than a `PAGES_URL=... node --test` npm script
// so it behaves the same in cmd.exe as it does in bash.
//
// Run with: npm run verify:pages
// Override the target with PAGES_URL=... when you fork the template.

'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_PAGES_URL = 'https://spuds0588.github.io/Powerapps-to-electron-template';
const pagesUrl = process.env.PAGES_URL || DEFAULT_PAGES_URL;

console.log(`[PowerApps Browser] verifying the live deployment at ${pagesUrl}`);

const result = spawnSync(process.execPath, ['--test', 'test/browser/*.test.js'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: Object.assign({}, process.env, { PAGES_URL: pagesUrl })
});

process.exit(result.status === null ? 1 : result.status);
