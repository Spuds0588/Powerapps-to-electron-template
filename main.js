// [PowerApp Desktop] main.js - v1.0.0
//
// Dual-pane Electron shell that embeds a Microsoft Power App in a persistent sidebar
// and an external browser in the main pane. The main process scrapes the main pane and
// passes the captured context back into the Power App as URL query parameters.
// The sidebar sits on the right by default; set `sidebarPosition` to "left" to flip it.
//
// Architecture notes:
//  - Uses BaseWindow + WebContentsView (modern Electron). No BrowserView, no <webview>.
//  - Uses webContents.executeJavaScript for scraping. No preload.js, no IPC.

'use strict';

const { app, BaseWindow, WebContentsView, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG_PATH = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  powerAppUrl: 'https://apps.powerapps.com/play/e/YOUR_ENVIRONMENT_ID/a/YOUR_APP_ID?tenantId=YOUR_TENANT_ID',
  defaultMainUrl: 'https://www.bing.com',
  sidebarWidth: 420,
  sidebarPosition: 'right',
  windowWidth: 1440,
  windowHeight: 900,
  parameters: {
    includeTabUrl: true,
    includeTabBody: false,
    targetIds: [],
    includeLocalStorage: false,
    targetLocalStorageKeys: []
  },
  triggers: {
    onUrlChange: true,
    onTimer: {
      enabled: false,
      interval: 2000
    }
  }
};

/**
 * Recursively merges a user config over the defaults so a missing or partial
 * config.json can never crash the app.
 */
function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (Array.isArray(value)) {
      target[key] = value.slice();
    } else if (value && typeof value === 'object') {
      const base = target[key] && typeof target[key] === 'object' ? target[key] : {};
      target[key] = deepMerge(base, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function loadConfig() {
  const defaults = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      console.log('[PowerApp Desktop] Loaded configuration from config.json');
      return deepMerge(defaults, parsed);
    }
    console.warn('[PowerApp Desktop] config.json not found - using default configuration.');
  } catch (error) {
    console.error(`[PowerApp Desktop] Failed to read config.json (${error.message}). Using defaults.`);
  }
  return defaults;
}

const config = loadConfig();

// ---------------------------------------------------------------------------
// Window state
// ---------------------------------------------------------------------------

let mainWindow = null;
let sidebarView = null;
let mainContentView = null;

/** The full URL currently loaded in the Power App sidebar (used for change detection). */
let sidebarCurrentUrl = null;

/** Handle for the optional polling timer. */
let pollingTimer = null;

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

function baseWebPreferences() {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  };
}

/**
 * Removes the "Electron/x" and app-name tokens from the user agent. Many enterprise
 * sites (including Power Apps) gate features on a recognized browser UA.
 */
function applyCleanUserAgent(view) {
  try {
    const ua = view.webContents
      .getUserAgent()
      .replace(/\sElectron\/[\d.]+/g, '')
      .replace(/\s(powerapp-electron-template|Power App Desktop Extension)\/[\d.]+/gi, '');
    view.webContents.setUserAgent(ua);
  } catch (error) {
    console.warn(`[PowerApp Desktop] Could not set user agent: ${error.message}`);
  }
}

/**
 * Keeps the sidebar a fixed width and gives the remainder of the window to the
 * main content pane. `sidebarPosition` docks the Power App on the right (default)
 * or on the left.
 */
function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed() || !sidebarView || !mainContentView) return;

  const { width, height } = mainWindow.getContentBounds();
  const maxSidebar = Math.max(200, width - 320);
  const sidebarWidth = Math.max(200, Math.min(Number(config.sidebarWidth) || 420, maxSidebar));
  const onLeft = String(config.sidebarPosition).toLowerCase() === 'left';
  const mainWidth = width - sidebarWidth;

  sidebarView.setBounds({ x: onLeft ? 0 : mainWidth, y: 0, width: sidebarWidth, height });
  mainContentView.setBounds({ x: onLeft ? sidebarWidth : 0, y: 0, width: mainWidth, height });
}

/**
 * Microsoft Entra ID (Azure AD) sign-in spawns popups. Always allow them so the
 * native Electron modal can handle the login flow without breaking the dual pane.
 */
function popupHandler({ url }) {
  console.log(`[PowerApp Desktop] Popup allowed: ${url}`);
  return { action: 'allow' };
}

/**
 * Convenience keyboard handling: Ctrl/Cmd+R reloads the focused view,
 * Ctrl/Cmd+Shift+I toggles DevTools for the focused view.
 */
function wireShortcuts(view) {
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;

    if (mod && !input.shift && input.key.toLowerCase() === 'r') {
      view.webContents.reload();
      event.preventDefault();
    }

    if (mod && input.shift && input.key.toLowerCase() === 'i') {
      view.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

// ---------------------------------------------------------------------------
// Context scraping & URL building
// ---------------------------------------------------------------------------

/**
 * Builds the self-contained script injected into the main pane. It is intentionally
 * assembled from the current config so no values are hard-coded in the renderer.
 */
function buildScrapeScript() {
  const parameters = config.parameters || {};
  const targets = JSON.stringify(Array.isArray(parameters.targetIds) ? parameters.targetIds : []);
  const localStorageKeys = JSON.stringify(
    Array.isArray(parameters.targetLocalStorageKeys) ? parameters.targetLocalStorageKeys : []
  );

  return `(() => {
    const readValue = (el) => {
      const tag = el.tagName.toLowerCase();
      const type = el.type ? String(el.type).toLowerCase() : '';
      if (tag === 'input') {
        if (type === 'checkbox' || type === 'radio') return el.checked ? 'checked' : 'unchecked';
        if (type === 'file') return el.files && el.files.length ? el.files[0].name : '';
        return el.value || '';
      }
      if (tag === 'select' || tag === 'textarea') return el.value || '';
      if (tag === 'button') return (el.textContent || '').trim() || el.value || '';
      if (el.value !== undefined && el.value !== null && el.value !== '') return el.value;
      return (el.textContent || '').trim();
    };

    const result = {
      url: window.location.href,
      title: document.title,
      body: {},
      localStorage: {}
    };

    for (const id of ${targets}) {
      const el = document.getElementById(id);
      if (!el) continue;
      try { result.body[id] = readValue(el); } catch (error) { /* ignore unreadable nodes */ }
    }

    for (const key of ${localStorageKeys}) {
      try { result.localStorage[key] = window.localStorage.getItem(key); } catch (error) { /* ignore */ }
    }

    return result;
  })()`;
}

/**
 * Builds the Power App URL with the scraped context appended as query parameters,
 * preserving any parameters already present on the configured base URL.
 */
function buildSidebarUrl(data) {
  const parameters = config.parameters || {};
  const base = String(config.powerAppUrl).split('?')[0];

  let search;
  try {
    search = new URL(config.powerAppUrl).searchParams;
  } catch (error) {
    search = new URLSearchParams();
  }

  if (parameters.includeTabUrl) {
    search.set('tabURL', data.url || '');
  }

  if (parameters.includeTabBody && data.body && Object.keys(data.body).length > 0) {
    search.set('tabBody', JSON.stringify(data.body));
  }

  if (parameters.includeLocalStorage && data.localStorage && Object.keys(data.localStorage).length > 0) {
    search.set('tabLocalStorage', JSON.stringify(data.localStorage));
  }

  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * Scrapes the main pane and loads the resulting URL into the sidebar, but only
 * when that URL has actually changed. Reloading the Power App unnecessarily would
 * wipe its in-memory canvas state.
 */
async function updatePowerApp() {
  if (!sidebarView || !mainContentView) return;
  if (mainContentView.webContents.isDestroyed() || sidebarView.webContents.isDestroyed()) return;

  try {
    const data = await mainContentView.webContents.executeJavaScript(buildScrapeScript(), true);
    const nextUrl = buildSidebarUrl(data);

    if (nextUrl === sidebarCurrentUrl) {
      return;
    }

    sidebarCurrentUrl = nextUrl;
    console.log(`[PowerApp Desktop] Updating Power App with ${new URL(nextUrl).searchParams.toString().split('&').length} parameter(s).`);
    await sidebarView.webContents.loadURL(nextUrl);
  } catch (error) {
    // A URL that is too long or a navigation that happened mid-scrape can throw.
    // Log and let the next trigger retry rather than crashing the app.
    console.error(`[PowerApp Desktop] updatePowerApp failed: ${error.message}`);
  }
}

/**
 * Wires the URL-change and timer triggers defined in config.json.
 */
function wireTriggers() {
  const triggers = config.triggers || {};

  if (triggers.onUrlChange !== false) {
    mainContentView.webContents.on('did-navigate', () => updatePowerApp());
    mainContentView.webContents.on('did-navigate-in-page', () => updatePowerApp());
  }

  const onTimer = triggers.onTimer || {};
  if (onTimer.enabled) {
    const interval = Math.max(500, Number(onTimer.interval) || 2000);
    console.log(`[PowerApp Desktop] Polling timer enabled (${interval}ms).`);
    pollingTimer = setInterval(updatePowerApp, interval);
  }

  // Always perform one initial sync once the main pane has settled.
  mainContentView.webContents.on('did-finish-load', () => updatePowerApp());
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

function createWindow() {
  const { width: screenWidth, height: screenHeight } = require('electron').screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BaseWindow({
    width: Math.min(Number(config.windowWidth) || 1440, screenWidth),
    height: Math.min(Number(config.windowHeight) || 900, screenHeight),
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0C1B49',
    title: 'Power App Desktop Extension'
  });

  sidebarView = new WebContentsView({ webPreferences: baseWebPreferences() });
  mainContentView = new WebContentsView({ webPreferences: baseWebPreferences() });

  mainWindow.contentView.addChildView(sidebarView);
  mainWindow.contentView.addChildView(mainContentView);

  applyCleanUserAgent(sidebarView);
  applyCleanUserAgent(mainContentView);

  sidebarView.webContents.setWindowOpenHandler(popupHandler);
  mainContentView.webContents.setWindowOpenHandler(popupHandler);

  wireShortcuts(sidebarView);
  wireShortcuts(mainContentView);

  layoutViews();
  mainWindow.on('resize', layoutViews);

  mainWindow.on('closed', () => {
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = null;
    sidebarView = null;
    mainContentView = null;
    mainWindow = null;
  });

  wireTriggers();

  console.log(`[PowerApp Desktop] Loading Power App: ${config.powerAppUrl}`);
  sidebarView.webContents.loadURL(config.powerAppUrl);

  console.log(`[PowerApp Desktop] Loading main pane: ${config.defaultMainUrl}`);
  mainContentView.webContents.loadURL(config.defaultMainUrl);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BaseWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Open target=_blank style links that we do not handle ourselves in the OS browser.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      // Let auth popups open natively; send everything else to the default browser
      // only when it is an unknown external protocol handler.
      return { action: 'allow' };
    }
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
});
