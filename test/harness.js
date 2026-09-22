// [PowerApp Desktop] test/harness.js
//
// Loads the real `main.js` inside a `node:vm` context with a stubbed `electron`
// module, and the really shipped `wizard.html` inside one with a minimal DOM
// stub. That lets the unit tests exercise the shipping code - config merge,
// layout maths, scrape script generation, URL building, the trigger wiring and
// the wizard's step flow - without a display server or an installed Electron
// binary.
//
// Nothing in here is imported by the app itself.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

/** Resolves after the pending microtask queue (and one macrotask) has drained. */
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createWebContents(label, sink) {
  const handlers = new Map();

  const contents = {
    label,
    loadedUrls: [],
    reloads: 0,
    devToolsToggles: 0,
    windowOpenHandler: null,
    // A realistic Electron UA so `applyCleanUserAgent` has something to strip.
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/130.0.0.0 Safari/537.36 Electron/33.0.0 powerapp-electron-template/1.0.0',
    scrapeResult: { url: 'https://example.com/page', title: 'Example', body: {}, localStorage: {} },
    handlers,

    getUserAgent() {
      return this.userAgent;
    },
    setUserAgent(ua) {
      this.userAgent = ua;
      sink.userAgents.push(ua);
    },
    loadURL(url) {
      this.loadedUrls.push(url);
      sink.loadedUrls.push({ label, url });
      return Promise.resolve();
    },
    reload() {
      this.reloads += 1;
    },
    toggleDevTools() {
      this.devToolsToggles += 1;
    },
    isDestroyed() {
      return false;
    },
    setWindowOpenHandler(fn) {
      this.windowOpenHandler = fn;
    },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
      return this;
    },
    emit(event, ...args) {
      for (const handler of handlers.get(event) || []) handler(...args);
    },
    executeJavaScript(script) {
      sink.scrapeScripts.push(script);
      return Promise.resolve(contents.scrapeResult);
    }
  };

  return contents;
}

function createView(label, sink) {
  const view = {
    label,
    bounds: [],
    lastBounds: null,
    webContents: createWebContents(label, sink),
    setBounds(next) {
      this.lastBounds = next;
      this.bounds.push(next);
    }
  };
  return view;
}

/** Swallows the app's own logging so test output stays readable. */
function createSilentConsole(verbose) {
  if (verbose) return console;
  return { log() {}, warn() {}, error() {}, info() {}, debug() {} };
}

function createElectronStub(sink) {
  const windows = [];
  const appHandlers = new Map();

  class BaseWindow {
    constructor(options) {
      this.options = options;
      this.children = [];
      this.handlers = new Map();
      this.destroyed = false;
      this._bounds = { x: 0, y: 0, width: options.width, height: options.height };
      this.contentView = {
        addChildView: (view) => {
          this.children.push(view);
          return this;
        }
      };
      windows.push(this);
    }

    getContentBounds() {
      return { ...this._bounds };
    }

    isDestroyed() {
      return this.destroyed;
    }

    on(event, handler) {
      if (!this.handlers.has(event)) this.handlers.set(event, []);
      this.handlers.get(event).push(handler);
      return this;
    }

    emit(event, ...args) {
      for (const handler of this.handlers.get(event) || []) handler(...args);
    }

    /** Test helper: simulate a window resize and fire the `resize` event. */
    resize(width, height) {
      this._bounds.width = width;
      this._bounds.height = height;
      this.emit('resize');
    }

    static getAllWindows() {
      return windows.filter((window) => !window.destroyed);
    }
  }

  class WebContentsView {
    constructor(options = {}) {
      sink.viewOptions.push(options);
      this.options = options;
      this.view = createView(`view#${sink.views.length + 1}`, sink);
      sink.views.push(this.view);
      return this.view;
    }
  }

  const app = {
    handlers: appHandlers,
    quitCalled: false,
    whenReady() {
      return Promise.resolve();
    },
    on(event, handler) {
      if (!appHandlers.has(event)) appHandlers.set(event, []);
      appHandlers.get(event).push(handler);
      return app;
    },
    emit(event, ...args) {
      for (const handler of appHandlers.get(event) || []) handler(...args);
    },
    quit() {
      app.quitCalled = true;
    }
  };

  const electron = {
    app,
    BaseWindow,
    WebContentsView,
    screen: {
      getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } })
    },
    shell: {
      openExternal: (url) => {
        sink.externalUrls.push(url);
        return Promise.resolve();
      }
    }
  };

  return { electron, windows, app };
}

/**
 * Loads `main.js` with a stubbed Electron.
 *
 * @param {object} [options]
 * @param {string} [options.dir] Directory used as `__dirname` (point it at a temp
 *   folder containing a `config.json` to test a specific configuration).
 * @param {object} [options.scrapeResult] Value returned by `executeJavaScript`.
 */
function loadMain(options = {}) {
  const dir = options.dir || ROOT;
  const sink = {
    loadedUrls: [],
    scrapeScripts: [],
    userAgents: [],
    externalUrls: [],
    views: [],
    viewOptions: []
  };

  const { electron, windows, app } = createElectronStub(sink);

  const requireStub = (request) => {
    if (request === 'electron') return electron;
    if (request === 'node:fs') return fs;
    if (request === 'node:path') return path;
    throw new Error(`Unexpected require("${request}") in main.js`);
  };

  const source = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const exportHook = `
module.exports = {
  DEFAULT_CONFIG,
  deepMerge,
  loadConfig,
  buildScrapeScript,
  buildSidebarUrl,
  updatePowerApp,
  createWindow,
  layoutViews,
  wireTriggers,
  state: () => ({ config, sidebarCurrentUrl, mainWindow, sidebarView, mainContentView, pollingTimer })
};
`;

  const sandbox = {
    require: requireStub,
    module: { exports: {} },
    exports: {},
    __dirname: dir,
    __filename: path.join(dir, 'main.js'),
    console: createSilentConsole(options.verbose),
    process,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Buffer
  };
  sandbox.exports = sandbox.module.exports;
  sandbox.global = sandbox;

  const context = vm.createContext(sandbox);
  new vm.Script(source + exportHook, { filename: 'main.js' }).runInContext(context);

  const main = sandbox.module.exports;

  return {
    main,
    sink,
    windows,
    app,
    electron,
    /** Resolves once `app.whenReady().then(createWindow)` has run. */
    ready: flush(),
    flush,
    /** The sidebar / main-pane views created by `createWindow`. */
    get views() {
      return sink.views;
    },
    get sidebar() {
      return sink.views[0];
    },
    get mainPane() {
      return sink.views[1];
    }
  };
}

// ---------------------------------------------------------------------------
// Wizard harness
// ---------------------------------------------------------------------------

/** A dynamically created element stub that records its listeners. */
function createElementStub(id) {
  return {
    id,
    value: '',
    checked: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    files: [],
    style: {},
    dataset: {},
    attributes: {},
    listeners: {},
    classList: {
      classes: new Set(),
      add(name) { this.classes.add(name); },
      remove(name) { this.classes.delete(name); },
      toggle(name, on) { if (on) this.classes.add(name); else this.classes.delete(name); },
      contains(name) { return this.classes.has(name); }
    },
    addEventListener(type, handler) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(handler);
      return this;
    },
    /** Fires every click handler and resolves once the async ones settle. */
    click() {
      const results = (this.listeners.click || []).map((handler) => {
        try {
          return handler({ target: this, preventDefault() {} });
        } catch (error) {
          return Promise.reject(error);
        }
      });
      return Promise.all(results);
    },
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild() {},
    removeChild() {},
    querySelector: () => null,
    querySelectorAll: () => []
  };
}

/**
 * The smallest DOM the wizard needs: elements appear on demand by id, and the
 * handful of selectors it looks up resolve to stand-ins.
 */
function createDomStub() {
  const elements = new Map();
  const documentListeners = {};

  const document = {
    listeners: documentListeners,
    body: createElementStub('body'),
    addEventListener(type, handler) {
      if (!documentListeners[type]) documentListeners[type] = [];
      documentListeners[type].push(handler);
    },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElementStub(id));
      return elements.get(id);
    },
    querySelector(selector) {
      const known = ['#wizard-container', '.container', 'header', '.wizard-navigation'];
      return known.includes(selector) ? document.getElementById(selector) : null;
    },
    // The wizard only binds collections it re-renders itself, so an empty list is faithful here.
    querySelectorAll: () => [],
    createElement: (tag) => createElementStub(tag)
  };

  return { document, elements };
}

function createStorageStub() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); }
  };
}

/**
 * Loads the real wizard from `wizard.html` with a stubbed DOM and browser APIs.
 *
 * @param {object} [options]
 * @param {boolean} [options.verbose] Keep the wizard's own console output.
 * @param {boolean} [options.boot] Fire DOMContentLoaded immediately (default true).
 */
function loadWizard(options = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'wizard.html'), 'utf8');
  const source = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .join('\n');

  const { document, elements } = createDomStub();

  const sandbox = {
    window: {},
    document,
    localStorage: createStorageStub(),
    console: createSilentConsole(options.verbose),
    URL,
    URLSearchParams,
    Blob,
    setTimeout,
    clearTimeout,
    confirm: () => true
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  new vm.Script(source, { filename: 'wizard.html (inline script)' }).runInContext(vm.createContext(sandbox));

  const boot = () => {
    for (const handler of document.listeners.DOMContentLoaded || []) handler();
  };

  if (options.boot !== false) boot();

  const el = (id) => document.getElementById(id);

  return {
    sandbox,
    document,
    elements,
    /** `window.PowerAppWizard` - the pure helpers and step renderers the wizard exposes. */
    helpers: sandbox.window.PowerAppWizard,
    el,
    boot,
    /** The currently rendered step markup. */
    html: () => el('#wizard-container').innerHTML,
    click: (id) => el(id).click()
  };
}

module.exports = { ROOT, flush, loadMain, loadWizard };
