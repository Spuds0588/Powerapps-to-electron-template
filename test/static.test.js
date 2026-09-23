// [PowerApp Desktop] test/static.test.js
//
// Static verification of the files shipped in this repo: JavaScript parses,
// JSON parses, inline <script> blocks in the HTML pages parse, and the config
// example stays in sync with the defaults baked into main.js.
//
// Run with: npm test

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { ROOT, loadMain, loadWizard } = require('./harness');

// The defaults as the shipping app sees them (main.js loaded with a stub Electron).
const DEFAULT_CONFIG = loadMain().main.DEFAULT_CONFIG;

/** Every JavaScript file in the repo that is not itself a test case. */
const jsFiles = [
  'main.js',
  'forge.config.js',
  'Research_Tools/id-scanner-bookmarklet.js',
  'Research_Tools/local-storage-scanner-bookmarklet.js',
  // Run by `npm run test:browser`, which skips itself when no browser is installed.
  'test/browser/server.js',
  'test/browser/verify-pages.js'
];

const htmlFiles = ['wizard.html', 'Research_Tools/Browser_Data_Scanners.html'];

const jsonFiles = ['package.json', 'config.example.json'];

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

/** Creates a temp __dirname holding a specific config.json. */
function dirWithConfig(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pad-wizard-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  return dir;
}

/**
 * The pure helpers the wizard hangs off `window.PowerAppWizard` - the simulated
 * Test & Preview step and the step renderers both use them.
 */
function loadWizardHelpers() {
  const helpers = loadWizard({ boot: false }).helpers;
  assert.ok(helpers, 'the wizard should expose window.PowerAppWizard');
  return helpers;
}

test('all javascript files parse', () => {
  for (const file of jsFiles) {
    assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), `${file} should parse`);
  }
});

test('all json files parse', () => {
  for (const file of jsonFiles) {
    assert.doesNotThrow(() => JSON.parse(read(file)), `${file} should parse`);
  }
});

test('inline script blocks in the html pages parse', () => {
  for (const file of htmlFiles) {
    const html = read(file);
    const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];

    assert.ok(blocks.length > 0, `${file} should contain at least one inline script`);

    blocks.forEach((match, index) => {
      const source = match[1];
      const isModule = /type\s*=\s*["']module["']/i.test(match[0]);
      assert.doesNotThrow(
        () => new vm.Script(source, { filename: `${file} (inline script #${index + 1})` }),
        `${file} inline script #${index + 1} should parse${isModule ? ' (module)' : ''}`
      );
    });
  }
});

test('wizard.html has no runtime dependencies beyond the shared reference dev card', () => {
  const html = read('wizard.html');

  const remoteScripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1]);
  const allowed = /^https:\/\/spuds0588\.github\.io\/ReferenceMaterials\//;

  for (const src of remoteScripts) {
    assert.match(src, allowed, `unexpected external script in wizard.html: ${src}`);
  }
  assert.doesNotMatch(html, /<link[^>]+rel=["']stylesheet["']/i, 'the wizard must not load external stylesheets');
  // All wizard logic must stay inline so the file works from disk with no server.
  assert.ok(html.includes('<script>'), 'the wizard must keep its logic inline');
});

test('config.example.json only uses keys the app understands', () => {
  const example = JSON.parse(read('config.example.json'));

  for (const key of Object.keys(example)) {
    assert.ok(key in DEFAULT_CONFIG, `config.example.json has an unknown top-level key: ${key}`);
  }
  for (const key of Object.keys(example.parameters || {})) {
    assert.ok(key in DEFAULT_CONFIG.parameters, `config.example.json has an unknown parameters key: ${key}`);
  }
  for (const key of Object.keys(example.triggers || {})) {
    assert.ok(key in DEFAULT_CONFIG.triggers, `config.example.json has an unknown triggers key: ${key}`);
  }
});

test('package.json wires the entrypoint, the tests and the forge config', () => {
  const pkg = JSON.parse(read('package.json'));

  assert.equal(pkg.main, 'main.js');
  assert.match(pkg.scripts.test, /node --test/);
  assert.doesNotMatch(pkg.scripts.test, /test\/browser/, 'npm test must stay browser-free and fast');
  assert.match(pkg.scripts['test:browser'], /test\/browser\/\*\.test\.js/, 'the Chromium suite needs its own script');
  assert.match(pkg.scripts['test:all'], /test:browser/, 'test:all has to include the Chromium suite');
  assert.match(pkg.scripts['verify:pages'], /verify-pages\.js/, 'verify:pages runs the suite against the live site');
  assert.ok(pkg.devDependencies.puppeteer, 'puppeteer provides the Chromium that test:browser drives');
  assert.match(pkg.scripts.start, /electron-forge start/);
  assert.match(pkg.devDependencies.electron, /^[\^~]?\d/, 'electron must be a real pinned dependency');
  assert.ok(pkg.devDependencies['@electron-forge/cli'], 'electron-forge CLI must be installed for npm start / npm run make');

  const forgeConfig = fs.readFileSync(path.join(ROOT, 'forge.config.js'), 'utf8');
  assert.match(forgeConfig, /makers:/, 'forge.config.js should declare makers');
  assert.match(forgeConfig, /squirrel/i);
  assert.match(forgeConfig, /zip/i);
});

test('the packaged app ships main.js but never a real config.json', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /config\.json/, 'config.json must be gitignored so credentials never get committed');
  assert.match(ignore, /node_modules/);
  assert.match(ignore, /^out\/?$/m, 'forge build output should be ignored');
  assert.match(ignore, /test\/screenshots/, 'screenshots from the Chromium run are build artefacts, not sources');
});

test('the wizard and main.js build identical sidebar URLs', () => {
  const wizard = loadWizardHelpers();

  // The wizard's `toConfig()` shape, including a base URL that already carries parameters.
  const config = {
    powerAppUrl: 'https://apps.powerapps.com/play/e/ENV/a/APP?tenantId=TENANT&source=wizard',
    defaultMainUrl: 'https://www.bing.com',
    sidebarWidth: 420,
    windowWidth: 1440,
    windowHeight: 900,
    parameters: {
      includeTabUrl: true,
      includeTabBody: true,
      targetIds: ['customerName', 'case&status'],
      includeLocalStorage: true,
      targetLocalStorageKeys: ['sessionToken']
    },
    triggers: { onUrlChange: true, onTimer: { enabled: false, interval: 2000 } }
  };

  const app = loadMain({ dir: dirWithConfig(config) });

  // `data` is the shape of the scrape result produced by buildScrapeScript().
  const cases = [
    {
      url: 'https://example.com/page?a=1&b=2',
      title: 'Example',
      body: { customerName: 'Ada Lovelace', 'case&status': 'open & pending' },
      localStorage: { sessionToken: 'x=1&y=2' }
    },
    { url: 'https://example.com/empty', title: 'Example', body: {}, localStorage: {} },
    { url: '', title: '', body: { customerName: '' }, localStorage: {} },
    { url: 'https://example.com/spaces and + signs', title: 'Example', body: {}, localStorage: {} }
  ];

  for (const data of cases) {
    assert.equal(
      wizard.buildSidebarUrl(config, data),
      app.main.buildSidebarUrl(data),
      `the wizard must not diverge from main.js for ${JSON.stringify(data.url)}`
    );
  }

  // Same for the scrape result the simulator shows.
  const sample = { url: 'https://example.com', title: 'T', body: { customerName: 'Ada', nope: 'x' }, localStorage: { sessionToken: 'tok', other: 'y' } };
  // (compared as JSON: values created inside the vm have a different Object.prototype)
  assert.equal(
    JSON.stringify(wizard.buildScrapeResult(config, sample)),
    JSON.stringify({
      url: 'https://example.com',
      title: 'T',
      body: { customerName: 'Ada' },
      localStorage: { sessionToken: 'tok' }
    })
  );

  // Disabled data sources must never leak into the URL.
  const trimmed = JSON.parse(JSON.stringify(config));
  trimmed.parameters.includeTabBody = false;
  trimmed.parameters.includeLocalStorage = false;
  trimmed.parameters.targetIds = [];
  trimmed.parameters.targetLocalStorageKeys = [];
  const trimmedApp = loadMain({ dir: dirWithConfig(trimmed) });
  const leftoverData = { url: 'https://example.com/x', body: { a: '1' }, localStorage: { b: '2' } };

  assert.equal(
    wizard.buildSidebarUrl(trimmed, leftoverData),
    trimmedApp.main.buildSidebarUrl(leftoverData)
  );
  assert.doesNotMatch(wizard.buildSidebarUrl(trimmed, leftoverData), /tabBody|tabLocalStorage/);
});

test('every wizard step renders the fields it wires up', () => {
  const wizard = loadWizardHelpers();
  // The wizard seeds its defaults from localStorage on DOMContentLoaded, which the stub never fires,
  // so every key a step reads has to be set explicitly here.
  wizard.setConfig({
    powerAppUrl: 'https://apps.powerapps.com/play/e/ENV/a/APP?tenantId=TENANT',
    defaultMainUrl: 'https://www.bing.com',
    sidebarWidth: 420,
    windowWidth: 1440,
    windowHeight: 900,
    includeTabUrl: true,
    includeTabBody: true,
    targetIds: ['customerName'],
    includeLocalStorage: true,
    targetLocalStorageKeys: ['sessionToken'],
    onUrlChange: true,
    onTimerEnabled: true,
    onTimerInterval: 2000
  });

  /** [step name, ids the step must render, values it must interpolate] */
  const expectations = [
    ['renderIntroStep', ['hero-get-started-btn', 'import-config-file'], ['class="browser-mockup"', 'class="animated-gradient"']],
    ['renderStep1', ['powerAppUrl', 'defaultMainUrl'], ['apps.powerapps.com/play/e/ENV/a/APP?tenantId=TENANT']],
    ['renderStep2', ['windowWidth', 'windowHeight', 'sidebarWidth', 'sidebarPosition'], ['1440', '>Right (default)<', '>Left<']],
    ['renderStep3_DataSource', ['includeTabUrl', 'includeTabBody', 'includeLocalStorage'], []],
    ['renderStep4_FindPageData', ['targetIds'], ['customerName', 'Browser_Data_Scanners.html']],
    ['renderStep5_FindStorageData', ['targetLocalStorageKeys'], ['sessionToken']],
    ['renderStep6_Triggers', ['onUrlChange', 'onTimerEnabled', 'onTimerInterval'], ['2000']],
    ['renderStep7_TestAndPreview', ['simulateBtn', 'simUrl', 'simScrape', 'simConsole', 'simTabUrl', 'sim_customerName', 'simloc_sessionToken', 'simPowerFx', 'mockMainUrl'], ['Update Preview', 'class="browser-mockup"', 'class="console"']],
    ['renderStep8_Review', ['review-json'], ['Sidebar: 420 px (right)']],
    ['renderStep9_Save', ['save-btn', 'download-btn', 'status', 'result', 'json-preview'], ['npm start']],
    ['renderStep10_NextSteps', [], ['class="distro-tab-btn"', 'data-tab="win"', 'data-tab="mac"', 'data-tab="linux"', 'squirrel.windows', 'darwin', 'linux']]
  ];

  for (const [name, ids, values] of expectations) {
    assert.equal(typeof wizard.steps[name], 'function', `${name} should be exposed`);

    const html = wizard.steps[name]();
    assert.ok(html.includes('class="wizard-step active"'), `${name} should render an active step`);

    for (const id of ids) {
      assert.ok(html.includes(`id="${id}"`) || html.includes(`data-tab="${id}"`), `${name} should render #${id}`);
    }
    for (const value of values) {
      assert.ok(html.includes(value), `${name} should interpolate ${value}`);
    }

    // Every rendered element id must be unique or the step's wiring would bind the wrong node.
    const renderedIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(renderedIds).size, renderedIds.length, `${name} should not repeat an id`);
  }
});

test('the wizard escapes user supplied values before rendering them', () => {
  const wizard = loadWizardHelpers();
  wizard.setConfig({
    powerAppUrl: 'https://apps.powerapps.com/play/e/ENV/a/APP',
    includeTabBody: true,
    targetIds: ['<img src=x onerror=alert(1)>'],
    includeLocalStorage: true,
    targetLocalStorageKeys: ['key"><script>']
  });

  for (const name of ['renderStep4_FindPageData', 'renderStep5_FindStorageData', 'renderStep7_TestAndPreview', 'renderStep8_Review']) {
    const html = wizard.steps[name]();
    assert.doesNotMatch(html, /<img src=x/, `${name} must escape element ids`);
    assert.doesNotMatch(html, /<script>/, `${name} must escape storage keys`);
    assert.match(html, /&lt;/, `${name} should show the escaped value`);
  }
});

test('the wizard ships the step flow and the simulated preview', () => {
  const html = read('wizard.html');

  // Everything must work from a local file or GitHub Pages - no CDN pulls.
  assert.doesNotMatch(html, /cdnjs\.cloudflare\.com|unpkg\.com|jsdelivr\.net/i);

  for (const token of [
    'wizard-navigation',
    'prev-btn',
    'next-btn',
    'restart-wizard-header-btn',
    'renderStep7_TestAndPreview',
    'simulateBtn',
    'simUrl',
    'simScrape',
    'simConsole',
    'tabURL',
    'tabBody',
    'tabLocalStorage',
    'Power Fx',
    'distro-tab-btn',
    'showDirectoryPicker'
  ]) {
    assert.ok(html.includes(token), `wizard.html should include ${token}`);
  }

  // The simulator has to reuse the app's parameter names verbatim.
  assert.match(html, /search\.set\('tabURL'/);
  assert.match(html, /search\.set\('tabLocalStorage'/);
});

test('the mockup CSS docks the Power App pane wherever sidebarPosition says', () => {
  const html = read('wizard.html');
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join('\n');
  assert.ok(css.length > 0, 'wizard.html should ship its styles inline');

  // The panes are plain flex children, so DOM order is the visual order. Nothing may
  // re-order them behind the renderer's back, or the flipped markup would look identical.
  assert.doesNotMatch(css, /\border\s*:/, 'the mockup must not use flex `order`');
  assert.doesNotMatch(css, /flex-direction\s*:\s*row-reverse/, 'the mockup must not reverse the flex row');

  // Left dock (the classic layout) keeps the divider on the sidebar's right edge...
  const base = css.match(/\.browser-sidebar\s*\{([^}]*)\}/)[1];
  assert.match(base, /border-right:\s*1px solid #dfe1e8;/, 'the left-docked pane needs a right divider');
  assert.doesNotMatch(base, /border-left/, 'the left-docked pane must not draw a left divider');

  // ...and the right dock, which is the default, mirrors it onto the left edge.
  const flipped = css.match(/\.browser-content\.sidebar-right \.browser-sidebar\s*\{([^}]*)\}/)[1];
  assert.match(flipped, /border-right:\s*none;/, 'the right-docked pane must drop the right divider');
  assert.match(flipped, /border-left:\s*1px solid #dfe1e8;/, 'the right-docked pane needs a left divider');
});

test('the simulated preview only records a sidebar load on an explicit run', () => {
  const html = read('wizard.html');

  // main.js records the URL it actually loaded (`sidebarCurrentUrl`) and skips an identical
  // scrape. The simulator has to mirror that: recalculating live while the sample values are
  // typed must not count as a load, or the first "Update Preview" press would report a skip
  // even though the Power App has never been given a URL.
  assert.match(
    html,
    /const reloads = sidebarUrl !== lastSimulatedUrl;/,
    'the simulator should compare against the last loaded URL'
  );
  assert.match(html, /if \(announce\) lastSimulatedUrl = sidebarUrl;/, 'only an explicit run may record a load');
  assert.doesNotMatch(
    html,
    /^\s+lastSimulatedUrl = sidebarUrl;$/m,
    'a live recalculation must not record a load'
  );
  assert.match(
    html,
    /addEventListener\('input', \(\) => runSimulation\(false\)\)/,
    'typing in a sample field should refresh the preview without announcing a run'
  );
});

test('the pages workflow publishes the wizard', () => {
  const workflow = read('.github/workflows/deploy-wizard.yml');
  assert.match(workflow, /wizard\.html/);
  assert.match(workflow, /pages/i);
  assert.match(workflow, /cp wizard\.html _site\/index\.html/, 'the workflow must rename wizard.html to index.html');
  assert.match(
    workflow,
    /cp wizard\.html _site\/wizard\.html/,
    'the wizard must keep its own name too, for the Research_Tools back-link'
  );
});

test('the published site root forwards to the wizard', () => {
  // The repo's Pages source is "deploy from a branch", so GitHub renders README.md at the root.
  // This entry point is what makes the advertised wizard URL actually open the wizard.
  const html = read('index.html');

  assert.match(html, /<meta http-equiv="refresh" content="0; url=\.\/wizard\.html">/);
  assert.match(html, /<a href="\.\/wizard\.html"/, 'the fallback link must point at the wizard');
  assert.doesNotMatch(html, /<script/i, 'the entry point should stay script-free');
});

test('the wizard keeps its in-site links working from the pages root', () => {
  const html = read('wizard.html');

  // The bookmarklet guides point at a sibling file, which has to sit next to the wizard in both
  // layouts (the repo root and the workflow's _site/ directory).
  const scanners = html.match(/const SCANNERS_URL = '([^']+)'/)[1];
  assert.doesNotMatch(scanners, /^https?:/, 'the scanners page ships alongside the wizard');
  assert.ok(fs.existsSync(path.join(ROOT, scanners)), `${scanners} should exist at the repo root`);

  // And that page has to be able to get back to the wizard.
  assert.match(read('Research_Tools/Browser_Data_Scanners.html'), /href="\.\.\/wizard\.html"/);
});

test('the README documents the whole quick-start path', () => {
  const readme = read('README.md');

  for (const file of ['main.js', 'wizard.html', 'config.example.json', 'Agents.md', 'Research_Tools', 'test/browser']) {
    assert.ok(readme.includes(file), `README should mention ${file}`);
  }
  assert.match(readme, /npm start/);
  assert.match(readme, /config\.json/);
  assert.match(readme, /npm run test:browser/, 'the README should document the Chromium suite');
});
