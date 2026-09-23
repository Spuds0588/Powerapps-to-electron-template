// [PowerApp Desktop] test/browser/wizard.browser.test.js
//
// Drives the shipping `wizard.html` in a real Chromium - the one thing
// test/harness.js cannot do with a DOM stub: lay the page out and prove the
// simulated desktop window actually renders the Power App pane on the side
// `sidebarPosition` names.
//
// The same suite runs against two targets:
//   * `npm run test:browser`  - the local files, served on a loopback origin.
//   * `npm run verify:pages`  - the live GitHub Pages site (PAGES_URL).
//
// Skipped - not failed - when no usable Chromium is installed, so a checkout
// without a browser still keeps this suite green. Set REQUIRE_BROWSER=1 to turn
// that skip into a failure. Set HEADED=1 to watch it run (needs a display; use
// `xvfb-run -a` in a container).
//
// @see test/browser/server.js

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer');

const { ROOT, startStaticServer } = require('./server');

const PAGES_URL = (process.env.PAGES_URL || '').replace(/\/+$/, '');
const HEADED = process.env.HEADED === '1';
const REQUIRE_BROWSER = process.env.REQUIRE_BROWSER === '1';

/** Where the run writes its screenshots (git-ignored; proof for a human eye). */
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');
const MODE = PAGES_URL ? 'pages' : 'local';

/**
 * The wizard pulls one shared dev card from GitHub Pages. A problem loading it
 * is not the wizard's problem, so those console errors are reported separately
 * instead of failing the run.
 */
const EXTERNAL_DEV_CARD = /ReferenceMaterials\/burns-dev-card\.js/;

const MISSING_CHROME_HINT =
  'run "npx puppeteer browsers install chrome", or reinstall without PUPPETEER_SKIP_DOWNLOAD';

let browser = null;
let server = null;
let baseUrl = PAGES_URL || null;

/**
 * Why Chrome could not be started, if it could not be started. The probe is the
 * launch itself - a binary that exists but cannot run (a bare container missing
 * shared libraries) has to count as unavailable too.
 */
let browserError = null;

/**
 * Skips the calling test when there is no usable browser. `REQUIRE_BROWSER=1`
 * turns that skip into a failure so a "green" run cannot mean "ran nothing".
 */
function requireBrowser(t) {
  if (!browserError) return true;

  const hint = /could not find chrome/i.test(browserError) ? ` - ${MISSING_CHROME_HINT}` : '';
  const reason = `no usable Chromium: ${browserError}${hint}`;

  if (REQUIRE_BROWSER) assert.fail(reason);
  t.skip(reason);
  return false;
}

/** Chrome refuses to sandbox itself when it runs as root (containers, CI). */
function launchArgs() {
  const args = ['--disable-dev-shm-usage'];
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  return args;
}

/**
 * Opens the wizard in a fresh browser context, so one test's `localStorage`
 * cannot leak into the next.
 */
async function session(options = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(options.viewport || { width: 1440, height: 900 });

  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const urls = [message.location().url, ...(message.stackTrace() || []).map((frame) => frame.url)].filter(Boolean);
    consoleErrors.push({ text: message.text(), urls });
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(baseUrl + (options.path || '/wizard.html'), { waitUntil: 'domcontentloaded', timeout: 30000 });
  // The wizard pulls a shared dev card from GitHub Pages. Let it land so the page
  // has stopped reflowing before the test starts clicking things.
  await page.waitForNetworkIdle({ idleTime: 300, timeout: 15000 }).catch(() => {});

  return {
    context,
    page,
    consoleErrors,
    pageErrors,
    /** Console noise that came from the wizard's own code. */
    ownConsoleErrors: () => consoleErrors.filter((entry) => !EXTERNAL_DEV_CARD.test(entry.urls.join(' ') + entry.text)),
    close: () => context.close()
  };
}

/** Runs inside the page: the geometry of the simulated desktop window's panes. */
function measurePanes() {
  const rect = (element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
  };
  const content = document.querySelector('.browser-content');
  const sidebar = document.querySelector('.browser-sidebar');
  const main = document.querySelector('.browser-main-area');
  if (!content || !sidebar || !main) return null;

  // The divider is drawn on the side the Power App pane faces, so its rendered
  // side is the giveaway for which edge the pane is docked against.
  const sidebarStyle = getComputedStyle(sidebar);
  return {
    sidebarRight: content.classList.contains('sidebar-right'),
    divider: {
      left: parseFloat(sidebarStyle.borderLeftWidth) || 0,
      right: parseFloat(sidebarStyle.borderRightWidth) || 0
    },
    content: rect(content),
    sidebar: rect(sidebar),
    main: rect(main),
    captions: Array.from(document.querySelectorAll('.mock-pane-caption')).map((node) =>
      // The sidebar caption carries a ● status indicator in front of its label.
      node.textContent.replace(/●/g, '').replace(/\s+/g, ' ').trim()
    )
  };
}

/** Both margins and edges are fractional in CSS pixels. */
function near(actual, expected, tolerance = 1.5) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance}px of ${expected}`
  );
}

/**
 * Clicks a real control, after waiting for the layout to hold still.
 *
 * Centring the target first keeps the click off the viewport edges on the tall
 * steps, and waiting for two animation frames to report the same box stops the
 * click from being measured before the page has finished reflowing - the remote
 * dev card changes the page height as it loads, which moves the target out from
 * under the click.
 */
async function click(page, selector) {
  await page.waitForSelector(selector, { visible: true });
  await page.waitForFunction(
    (target) => {
      const node = document.querySelector(target);
      if (!node) return false;
      node.scrollIntoView({ block: 'center' });
      const box = node.getBoundingClientRect();
      const previous = node.__settledBox;
      node.__settledBox = [box.x, box.y];
      return !!previous && Math.abs(previous[0] - box.x) < 0.5 && Math.abs(previous[1] - box.y) < 0.5;
    },
    { polling: 'raf', timeout: 5000 },
    selector
  );
  await page.click(selector);
}

async function nextStep(page, expectedSelector) {
  await click(page, '#next-btn');
  await page.waitForSelector(expectedSelector, { visible: true });
}

/**
 * Sets a form field and fires the `input` event the wizard listens for. Typing
 * key-by-key is slower and makes the result depend on selection behaviour, which
 * is not what these tests are about.
 */
async function setValue(page, selector, value) {
  await page.waitForSelector(selector, { visible: true });
  await page.$eval(
    selector,
    (node, next) => {
      node.focus();
      node.value = next;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    },
    value
  );
}

async function screenshot(page, name) {
  const file = path.join(SCREENSHOT_DIR, `${MODE}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.before(async () => {
  if (!baseUrl) {
    server = await startStaticServer(ROOT);
    baseUrl = server.url;
  }
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  try {
    browser = await puppeteer.launch({ headless: !HEADED, args: launchArgs() });
  } catch (error) {
    // Not an app failure: this checkout simply has no browser to drive.
    browserError = error.message;
    return;
  }

  console.log(`[PowerApps Browser] ${MODE} target: ${baseUrl} (headed: ${HEADED})`);
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

test('the published site root reaches the wizard', async (t) => {
  if (!requireBrowser(t)) return;

  const app = await session({ path: '/' });
  try {
    await app.page.waitForSelector('#hero-get-started-btn', { visible: true, timeout: 15000 });

    assert.equal(await app.page.title(), 'Power App Desktop Builder');
    // Either `index.html` forwarded to `wizard.html`, or Pages served the copy at the root.
    assert.match(app.page.url(), /\/(wizard\.html)?$/);
    assert.equal(
      await app.page.$eval('.hero-title', (node) => node.textContent.trim()),
      'Power App Desktop Builder'
    );
  } finally {
    await app.close();
  }
});

test('the hero docks the Power App on the right by default', async (t) => {
  if (!requireBrowser(t)) return;

  const app = await session();
  try {
    await app.page.waitForSelector('.browser-content', { visible: true });
    const panes = await app.page.evaluate(measurePanes);

    assert.ok(panes, 'the dual-pane mockup should render on the hero');
    assert.equal(panes.sidebarRight, true, 'the default config docks the Power App on the right');
    assert.deepEqual(panes.captions, ['Browser (main pane)', 'Power App (sidebar)']);

    assert.ok(panes.sidebar.x > panes.main.x, 'the Power App pane should sit to the right of the browser pane');
    assert.ok(panes.sidebar.width > 0 && panes.main.width > 0, 'both panes should have a real width');
    assert.ok(panes.divider.left > 0, 'the divider should be drawn on the left edge of a right-docked pane');
    assert.equal(panes.divider.right, 0);

    // The panes tile the content row: flush to each edge, sharing the divider.
    near(panes.main.x, panes.content.x);
    near(panes.sidebar.right, panes.content.right);
    near(panes.sidebar.x, panes.main.right);
    near(panes.sidebar.width + panes.main.width, panes.content.width, 2);
    near(panes.sidebar.height, panes.content.height);
    near(panes.sidebar.height, 270, 2); // .browser-content is a fixed 270px tall mockup

    await screenshot(app.page, 'hero-sidebar-right');
  } finally {
    await app.close();
  }
});

test('the full walkthrough reaches the save step with no errors from the wizard', async (t) => {
  if (!requireBrowser(t)) return;

  const app = await session();
  const { page } = app;

  try {
    // Hero -> step 1.
    await click(page, '#hero-get-started-btn');
    await page.waitForSelector('#powerAppUrl', { visible: true });
    await setValue(page, '#powerAppUrl', 'https://apps.powerapps.com/play/e/ENV/a/APP?tenantId=TT');

    // Step 2: sizing, and flip the sidebar to the left.
    await nextStep(page, '#sidebarWidth');
    await page.select('#sidebarPosition', 'left');
    await setValue(page, '#windowWidth', '1280');
    await setValue(page, '#windowHeight', '800');
    await setValue(page, '#sidebarWidth', '380');

    // Step 3: enable both optional data sources.
    await nextStep(page, '#includeTabBody');
    await click(page, '#includeTabBody');
    await click(page, '#includeLocalStorage');

    // Step 4: element IDs.
    await nextStep(page, '#targetIds');
    await setValue(page, '#targetIds', 'customerName, caseStatus');

    // Step 5: local storage keys.
    await nextStep(page, '#targetLocalStorageKeys');
    await setValue(page, '#targetLocalStorageKeys', 'sessionToken');

    // Step 6: triggers.
    await nextStep(page, '#onTimerEnabled');
    await click(page, '#onTimerEnabled');
    await setValue(page, '#onTimerInterval', '3000');

    // Step 7: the simulated preview.
    await nextStep(page, '#simulateBtn');

    const flipped = await page.evaluate(measurePanes);
    assert.ok(flipped, 'the preview step should render the mockup');
    assert.equal(flipped.sidebarRight, false, 'the left-handed layout drops the right modifier class');
    assert.deepEqual(flipped.captions, ['Power App (sidebar)', 'Browser (main pane)']);

    assert.ok(flipped.sidebar.x < flipped.main.x, 'the Power App pane should sit left of the browser pane');
    assert.ok(flipped.divider.right > 0, 'the divider should be drawn on the right edge of a left-docked pane');
    assert.equal(flipped.divider.left, 0);
    near(flipped.sidebar.x, flipped.content.x, 2);
    near(flipped.main.right, flipped.content.right, 2);
    near(flipped.sidebar.right, flipped.main.x);
    near(flipped.sidebar.width + flipped.main.width, flipped.content.width, 2);

    await screenshot(page, 'preview-sidebar-left');

    // The simulator builds the sidebar URL the real main process would load.
    assert.ok(await page.$('#sim_customerName'), 'the simulator should ask for a value per element ID');
    assert.ok(await page.$('#simloc_sessionToken'), 'the simulator should ask for a value per storage key');

    await setValue(page, '#simTabUrl', 'https://example.com/claims/1042');
    await setValue(page, '#sim_customerName', 'Ada Lovelace');
    await setValue(page, '#sim_caseStatus', 'Open');
    await setValue(page, '#simloc_sessionToken', 'tok-123');
    await click(page, '#simulateBtn');

    await page.waitForFunction(() => document.getElementById('simUrl').textContent.includes('tabURL='));
    const sidebarUrl = await page.$eval('#simUrl', (node) => node.textContent);

    assert.ok(sidebarUrl.startsWith('https://apps.powerapps.com/play/e/ENV/a/APP?tenantId=TT&tabURL='));
    assert.ok(sidebarUrl.includes('tabBody='), 'the simulator should append tabBody');
    assert.ok(sidebarUrl.includes('tabLocalStorage='), 'the simulator should append tabLocalStorage');
    assert.ok(
      sidebarUrl.includes('Ada%20Lovelace') || sidebarUrl.includes('Ada+Lovelace'),
      'the scraped value should be encoded'
    );
    assert.equal(await page.$eval('#simParamCount', (node) => node.textContent.trim()), '3');
    assert.equal(await page.$eval('#mockMainUrl', (node) => node.textContent.trim()), 'https://example.com/claims/1042');
    assert.ok(
      (await page.$eval('#simConsole', (node) => node.textContent)).includes('Updating Power App with 3 parameter(s)'),
      'the simulated main-process log should report the update'
    );

    // Nothing has been loaded into the sidebar yet, so the first run reloads.
    const firstRun = await page.$eval('#simReload', (node) => node.textContent.trim());
    assert.equal(firstRun, 'Reload');

    // Running the same scrape again must be reported as deduped - the app skips the
    // reload so the Power App keeps its state.
    await click(page, '#simulateBtn');
    assert.equal(await page.$eval('#simReload', (node) => node.textContent.trim()), 'Skipped');
    assert.ok((await page.$eval('#simConsole', (node) => node.textContent)).includes('skipping reload'));

    // Step 8: review reflects the sizing and the flipped side.
    await nextStep(page, '#review-json');
    const review = await page.$eval('#wizard-container', (node) => node.textContent);
    assert.ok(review.includes('Sidebar: 380 px (left)'), 'the review should show the flipped position');
    assert.ok(review.includes('customerName'), 'the review should list the captured IDs');
    await screenshot(page, 'review-sidebar-left');

    // Step 9: the save step (its picker needs a real user gesture, so stop here).
    await nextStep(page, '#save-btn');
    assert.equal(await page.$eval('#next-btn', (node) => node.textContent.trim()), '💾 Save config.json');

    assert.deepEqual(app.pageErrors, [], 'the wizard should throw no uncaught errors');
    assert.deepEqual(app.ownConsoleErrors(), [], 'the wizard should log no console errors of its own');
  } finally {
    await app.close();
  }
});

test('the wizard fits a 390px viewport without horizontal overflow', async (t) => {
  if (!requireBrowser(t)) return;

  const app = await session({ viewport: { width: 390, height: 844 } });
  try {
    await app.page.waitForSelector('.browser-content', { visible: true });

    const layout = await app.page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      panes: document.querySelectorAll('.browser-sidebar, .browser-main-area').length
    }));

    assert.equal(layout.panes, 2, 'both panes should survive the narrow viewport');
    assert.ok(
      layout.scrollWidth <= layout.clientWidth + 1,
      `the page should not scroll sideways (scrollWidth ${layout.scrollWidth} > clientWidth ${layout.clientWidth})`
    );

    const panes = await app.page.evaluate(measurePanes);
    assert.ok(panes.sidebar.x > panes.main.x, 'the panes should still sit side by side');
    await screenshot(app.page, 'hero-mobile');
  } finally {
    await app.close();
  }
});

test('the scanners page and the reference config are reachable', async (t) => {
  if (!requireBrowser(t)) return;

  const app = await session();
  const { page } = app;

  try {
    const scanners = await page.goto(`${baseUrl}/Research_Tools/Browser_Data_Scanners.html`, { waitUntil: 'domcontentloaded' });
    assert.equal(scanners.status(), 200);
    const bookmarklets = await page.$$eval('a[href^="javascript:"]', (links) => links.length);
    assert.ok(bookmarklets >= 2, 'both scanner bookmarklets should be installable from the page');

    const example = await page.goto(`${baseUrl}/config.example.json`, { waitUntil: 'domcontentloaded' });
    assert.equal(example.status(), 200);
    const config = JSON.parse(await page.evaluate(() => document.body.textContent));
    assert.equal(config.sidebarPosition, 'right', 'the published reference config should document the right-side default');
  } finally {
    await app.close();
  }
});
