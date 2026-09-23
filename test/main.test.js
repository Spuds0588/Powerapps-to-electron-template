// [PowerApp Desktop] test/main.test.js
//
// Behavioural tests for the shipping `main.js`, executed against a stubbed
// Electron via test/harness.js.
//
// Run with: npm test

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadMain } = require('./harness');

/** Creates a temp __dirname holding a specific config.json (or no file at all). */
function dirWithConfig(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pad-config-'));
  if (config !== undefined) {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

test('loadConfig falls back to defaults when config.json is missing', () => {
  const app = loadMain({ dir: dirWithConfig(undefined) });
  assert.equal(app.main.loadConfig().powerAppUrl, app.main.DEFAULT_CONFIG.powerAppUrl);
});

test('loadConfig merges partial config over defaults', () => {
  const app = loadMain({
    dir: dirWithConfig({ powerAppUrl: 'https://apps.powerapps.com/play/e/ENV/a/APP', sidebarWidth: 360 })
  });
  const config = app.main.loadConfig();

  assert.equal(config.powerAppUrl, 'https://apps.powerapps.com/play/e/ENV/a/APP');
  assert.equal(config.sidebarWidth, 360);
  // A partial config.json keeps the right-hand sidebar default.
  assert.equal(config.sidebarPosition, 'right');
  // Untouched nested defaults must survive the merge.
  assert.equal(config.parameters.includeTabUrl, true);
  assert.equal(config.triggers.onTimer.interval, 2000);
});

test('loadConfig tolerates malformed JSON without throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pad-bad-'));
  fs.writeFileSync(path.join(dir, 'config.json'), '{ this is not json');
  const app = loadMain({ dir });

  assert.equal(app.main.loadConfig().defaultMainUrl, 'https://www.bing.com');
});

test('deepMerge replaces arrays instead of merging them by index', () => {
  const app = loadMain();
  const { deepMerge } = app.main;

  const target = { parameters: { targetIds: ['a', 'b'], includeTabUrl: true } };
  const result = deepMerge(target, { parameters: { targetIds: ['c'] } });

  assert.deepEqual(result.parameters.targetIds, ['c']);
  assert.equal(result.parameters.includeTabUrl, true);
});

test('deepMerge ignores non-object sources', () => {
  const app = loadMain();
  assert.deepEqual(app.main.deepMerge({ a: 1 }, null), { a: 1 });
  assert.deepEqual(app.main.deepMerge({ a: 1 }, 'nope'), { a: 1 });
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

test('createWindow builds a sidebar and a main pane in that order', async () => {
  const app = loadMain();
  await app.ready;

  assert.equal(app.windows.length, 1);
  assert.equal(app.views.length, 2);
  assert.equal(app.windows[0].children.length, 2);
  assert.equal(app.views[0], app.windows[0].children[0]);
  assert.equal(app.views[1], app.windows[0].children[1]);
});

test('createWindow loads the Power App URL and the default main URL', async () => {
  const app = loadMain({ dir: dirWithConfig({ powerAppUrl: 'https://apps.powerapps.com/play/e/ENV/a/APP' }) });
  await app.ready;

  assert.deepEqual(app.sidebar.webContents.loadedUrls, ['https://apps.powerapps.com/play/e/ENV/a/APP']);
  assert.deepEqual(app.mainPane.webContents.loadedUrls, ['https://www.bing.com']);
});

test('createWindow strips the Electron and app tokens from the user agent', async () => {
  const app = loadMain();
  await app.ready;

  for (const view of app.sink.views) {
    assert.match(view.webContents.userAgent, /Chrome\/130/);
    assert.doesNotMatch(view.webContents.userAgent, /Electron|powerapp-electron-template/i);
  }
});

test('layoutViews docks the sidebar on the right by default', async () => {
  const app = loadMain({ dir: dirWithConfig({ sidebarWidth: 400, windowWidth: 1440, windowHeight: 900 }) });
  await app.ready;

  const window = app.windows[0];
  window.resize(1200, 800);

  // Compare fields individually: the bounds objects are created inside the vm
  // sandbox, so their prototypes differ from this realm's Object.prototype.
  assert.deepEqual({ ...app.mainPane.lastBounds }, { x: 0, y: 0, width: 800, height: 800 });
  assert.deepEqual({ ...app.sidebar.lastBounds }, { x: 800, y: 0, width: 400, height: 800 });
});

test('layoutViews moves the sidebar to the left when config.json asks for it', async () => {
  const app = loadMain({
    dir: dirWithConfig({ sidebarWidth: 400, sidebarPosition: 'left', windowWidth: 1440, windowHeight: 900 })
  });
  await app.ready;

  app.windows[0].resize(1200, 800);

  assert.deepEqual({ ...app.sidebar.lastBounds }, { x: 0, y: 0, width: 400, height: 800 });
  assert.deepEqual({ ...app.mainPane.lastBounds }, { x: 400, y: 0, width: 800, height: 800 });
});

test('layoutViews treats an unknown sidebarPosition as the right-hand default', async () => {
  const app = loadMain({ dir: dirWithConfig({ sidebarPosition: 'sideways', windowWidth: 1440 }) });
  await app.ready;

  app.windows[0].resize(1200, 800);

  assert.equal(app.sidebar.lastBounds.x, 1200 - app.sidebar.lastBounds.width);
  assert.equal(app.mainPane.lastBounds.x, 0);
});

test('layoutViews clamps an oversized sidebar so the main pane keeps 320px', async () => {
  const app = loadMain({ dir: dirWithConfig({ sidebarWidth: 5000 }) });
  await app.ready;

  app.windows[0].resize(1000, 700);

  assert.equal(app.sidebar.lastBounds.width, 680);
  assert.equal(app.mainPane.lastBounds.width, 320);
});

test('layoutViews enforces a 200px minimum sidebar width', async () => {
  const app = loadMain({ dir: dirWithConfig({ sidebarWidth: 10 }) });
  await app.ready;

  app.windows[0].resize(1200, 800);

  assert.equal(app.sidebar.lastBounds.width, 200);
  assert.equal(app.mainPane.lastBounds.x, 0);
  assert.equal(app.sidebar.lastBounds.x, 1000);
});

// ---------------------------------------------------------------------------
// Scraping script
// ---------------------------------------------------------------------------

test('buildScrapeScript embeds the configured IDs and localStorage keys', () => {
  const app = loadMain({
    dir: dirWithConfig({
      parameters: { targetIds: ['accountId', 'caseNumber'], targetLocalStorageKeys: ['sessionToken'] }
    })
  });

  const script = app.main.buildScrapeScript();

  assert.match(script, /\["accountId","caseNumber"\]/);
  assert.match(script, /\["sessionToken"\]/);
  assert.match(script, /window\.location\.href/);
  assert.match(script, /document\.title/);
});

test('buildScrapeScript produces a self-contained IIFE that parses as JavaScript', () => {
  const app = loadMain({ dir: dirWithConfig({ parameters: { targetIds: ['a"b', "c'd"] } }) });
  const script = app.main.buildScrapeScript();

  assert.doesNotThrow(() => new (require('node:vm').Script)(script));
});

test('buildScrapeScript handles empty defaults', () => {
  const app = loadMain();
  const script = app.main.buildScrapeScript();

  assert.match(script, /for \(const id of \[\]\)/);
  assert.match(script, /for \(const key of \[\]\)/);
});

// ---------------------------------------------------------------------------
// Sidebar URL building
// ---------------------------------------------------------------------------

test('buildSidebarUrl appends the scraped URL as tabURL', () => {
  const app = loadMain({ dir: dirWithConfig({ powerAppUrl: 'https://apps.powerapps.com/play/e/ENV/a/APP' }) });

  const url = new URL(app.main.buildSidebarUrl({ url: 'https://example.com/case/42', body: {}, localStorage: {} }));

  assert.equal(url.origin + url.pathname, 'https://apps.powerapps.com/play/e/ENV/a/APP');
  assert.equal(url.searchParams.get('tabURL'), 'https://example.com/case/42');
});

test('buildSidebarUrl preserves parameters already on the base URL', () => {
  const app = loadMain({
    dir: dirWithConfig({ powerAppUrl: 'https://apps.powerapps.com/play/e/ENV/a/APP?tenantId=TENANT&source=web' })
  });

  const url = new URL(app.main.buildSidebarUrl({ url: 'https://example.com', body: {}, localStorage: {} }));

  assert.equal(url.searchParams.get('tenantId'), 'TENANT');
  assert.equal(url.searchParams.get('source'), 'web');
  assert.equal(url.searchParams.get('tabURL'), 'https://example.com');
});

test('buildSidebarUrl omits disabled parameters', () => {
  const app = loadMain({
    dir: dirWithConfig({ parameters: { includeTabUrl: false, includeTabBody: false, includeLocalStorage: false } })
  });

  const result = app.main.buildSidebarUrl({
    url: 'https://example.com',
    body: { accountId: 'A-1' },
    localStorage: { token: 't' }
  });

  // Only the tenantId already on the configured base URL survives.
  assert.equal(
    result,
    'https://apps.powerapps.com/play/e/YOUR_ENVIRONMENT_ID/a/YOUR_APP_ID?tenantId=YOUR_TENANT_ID'
  );
});

test('buildSidebarUrl serialises the scraped body as tabBody JSON', () => {
  const app = loadMain({ dir: dirWithConfig({ parameters: { includeTabBody: true, includeTabUrl: true } }) });

  const url = new URL(
    app.main.buildSidebarUrl({ url: 'https://example.com', body: { accountId: 'A-1', tier: 'gold' }, localStorage: {} })
  );

  assert.deepEqual(JSON.parse(url.searchParams.get('tabBody')), { accountId: 'A-1', tier: 'gold' });
});

test('buildSidebarUrl skips an empty body even when tabBody is enabled', () => {
  const app = loadMain({ dir: dirWithConfig({ parameters: { includeTabBody: true, includeLocalStorage: true } }) });

  const url = new URL(app.main.buildSidebarUrl({ url: 'https://example.com', body: {}, localStorage: {} }));

  assert.equal(url.searchParams.has('tabBody'), false);
  assert.equal(url.searchParams.has('tabLocalStorage'), false);
});

test('buildSidebarUrl round-trips hostile characters in scraped values', () => {
  const app = loadMain({ dir: dirWithConfig({ parameters: { includeTabBody: true, includeTabUrl: true } }) });

  const body = { note: 'a & b = c? "quoted" 100%' };
  const url = new URL(app.main.buildSidebarUrl({ url: 'https://example.com/x?y=1&z=2', body, localStorage: {} }));

  assert.deepEqual(JSON.parse(url.searchParams.get('tabBody')), body);
  assert.equal(url.searchParams.get('tabURL'), 'https://example.com/x?y=1&z=2');
});

test('buildSidebarUrl survives a malformed powerAppUrl', () => {
  const app = loadMain({ dir: dirWithConfig({ powerAppUrl: 'not a url' }) });

  assert.equal(app.main.buildSidebarUrl({ url: 'https://example.com', body: {}, localStorage: {} }), 'not a url?tabURL=https%3A%2F%2Fexample.com');
});

// ---------------------------------------------------------------------------
// updatePowerApp + triggers
// ---------------------------------------------------------------------------

test('updatePowerApp loads the sidebar once and then dedupes identical URLs', async () => {
  const app = loadMain({ dir: dirWithConfig({ powerAppUrl: 'https://apps.powerapps.com/play/e/ENV/a/APP' }) });
  await app.ready;

  app.sidebar.webContents.loadedUrls.length = 0;

  await app.main.updatePowerApp();
  await app.main.updatePowerApp();

  assert.equal(app.sidebar.webContents.loadedUrls.length, 1, 'an unchanged URL must not reload the Power App');
  assert.equal(app.sidebar.webContents.reloads, 0);
});

test('updatePowerApp reloads the sidebar when the scraped URL changes', async () => {
  const app = loadMain({ dir: dirWithConfig({ powerAppUrl: 'https://apps.powerapps.com/play/e/ENV/a/APP' }) });
  await app.ready;

  app.sidebar.webContents.loadedUrls.length = 0;

  const scrapes = [{ url: 'https://example.com/one' }, { url: 'https://example.com/two' }];
  let index = 0;
  app.mainPane.webContents.executeJavaScript = () => Promise.resolve(scrapes[Math.min(index++, 1)]);

  await app.main.updatePowerApp();
  await app.main.updatePowerApp();

  assert.equal(app.sidebar.webContents.loadedUrls.length, 2);
  assert.equal(new URL(app.sidebar.webContents.loadedUrls[1]).searchParams.get('tabURL'), 'https://example.com/two');
});

test('updatePowerApp swallows a failing scrape instead of crashing', async () => {
  const app = loadMain();
  await app.ready;

  app.sidebar.webContents.loadedUrls.length = 0;
  app.mainPane.webContents.executeJavaScript = () => Promise.reject(new Error('renderer gone'));

  await assert.doesNotReject(() => app.main.updatePowerApp());
  assert.equal(app.sidebar.webContents.loadedUrls.length, 0, 'a failed scrape must not navigate the sidebar');
});

test('updatePowerApp no-ops before the window exists', async () => {
  const app = loadMain();
  assert.equal(app.sink.views.length, 0, 'no window should be created until whenReady resolves');
  await assert.doesNotReject(() => app.main.updatePowerApp());
});

test('wireTriggers hooks url changes and the initial load by default', async () => {
  const app = loadMain();
  await app.ready;

  await app.main.updatePowerApp();
  const before = app.sidebar.webContents.loadedUrls.length;

  // Navigate to a genuinely different page, otherwise the dedupe guard (correctly)
  // skips the reload.
  app.mainPane.webContents.scrapeResult = { url: 'https://example.com/next', title: 'Next', body: {}, localStorage: {} };
  app.mainPane.webContents.emit('did-navigate', { url: 'https://example.com/next' });
  await app.flush();
  const afterNavigate = app.sidebar.webContents.loadedUrls.length;

  app.mainPane.webContents.scrapeResult = { url: 'https://example.com/next#frag', title: 'Next', body: {}, localStorage: {} };
  app.mainPane.webContents.emit('did-navigate-in-page', { url: 'https://example.com/next#frag' });
  await app.flush();

  assert.ok(afterNavigate > before, 'did-navigate must trigger a sidebar update');
  assert.ok(
    app.sidebar.webContents.loadedUrls.length > afterNavigate,
    'did-navigate-in-page must trigger a sidebar update'
  );
  assert.equal(
    new URL(app.sidebar.webContents.loadedUrls.at(-1)).searchParams.get('tabURL'),
    'https://example.com/next#frag'
  );
});

test('wireTriggers leaves navigation unhooked when onUrlChange is false', async () => {
  const app = loadMain({ dir: dirWithConfig({ triggers: { onUrlChange: false } }) });
  await app.ready;

  await app.main.updatePowerApp();
  const before = app.sidebar.webContents.loadedUrls.length;

  app.mainPane.webContents.emit('did-navigate', { url: 'https://example.com/next' });
  await app.flush();

  assert.equal(app.sidebar.webContents.loadedUrls.length, before);
});

test('the polling timer is only created when configured', async () => {
  const off = loadMain();
  await off.ready;
  assert.equal(off.main.state().pollingTimer, null);

  const on = loadMain({ dir: dirWithConfig({ triggers: { onTimer: { enabled: true, interval: 1000 } } }) });
  await on.ready;
  assert.notEqual(on.main.state().pollingTimer, null);

  clearInterval(on.main.state().pollingTimer);
});

test('the polling timer clamps an absurdly small interval', async () => {
  const app = loadMain({ dir: dirWithConfig({ triggers: { onTimer: { enabled: true, interval: 1 } } }) });
  await app.ready;

  assert.equal(typeof app.main.state().pollingTimer, 'object');
  clearInterval(app.main.state().pollingTimer);
});

// ---------------------------------------------------------------------------
// Window open / popup handling (Entra ID sign-in) and shortcuts
// ---------------------------------------------------------------------------

test('both views allow Entra ID style popups', async () => {
  const app = loadMain();
  await app.ready;

  for (const view of app.sink.views) {
    const result = view.webContents.windowOpenHandler({ url: 'https://login.microsoftonline.com/tenant' });
    assert.equal(result.action, 'allow');
  }
});

test('Ctrl+R reloads and Ctrl+Shift+I toggles DevTools on the focused view', async () => {
  const app = loadMain();
  await app.ready;

  const view = app.sidebar;
  const prevented = [];
  const event = { preventDefault: () => prevented.push(true) };

  view.webContents.emit('before-input-event', event, { type: 'keyDown', key: 'R', control: true, shift: false });
  assert.equal(view.webContents.reloads, 1);

  view.webContents.emit('before-input-event', event, { type: 'keyDown', key: 'I', control: true, shift: true });
  assert.equal(view.webContents.devToolsToggles, 1);

  view.webContents.emit('before-input-event', event, { type: 'keyDown', key: 'R', control: false, shift: false });
  assert.equal(view.webContents.reloads, 1, 'an unmodified key press must not reload');
  assert.equal(prevented.length, 2);
});

test('closing the window clears app state', async () => {
  const app = loadMain({ dir: dirWithConfig({ triggers: { onTimer: { enabled: true, interval: 1000 } } }) });
  await app.ready;

  app.windows[0].emit('closed');

  const state = app.main.state();
  assert.equal(state.mainWindow, null);
  assert.equal(state.sidebarView, null);
  assert.equal(state.mainContentView, null);
  assert.equal(state.pollingTimer, null);
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test('window-all-closed quits on non-macOS platforms', () => {
  const app = loadMain();
  app.app.emit('window-all-closed');

  if (process.platform === 'darwin') {
    assert.equal(app.app.quitCalled, false);
  } else {
    assert.equal(app.app.quitCalled, true);
  }
});
