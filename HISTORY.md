# History

All notable changes to the Power App Electron Extension template are recorded here.

## v1.1.0 — Wizard Parity with the Sister Project

The configuration wizard now follows the same step-by-step experience as the Chrome-extension
project's wizard, including a simulated preview of the desktop app's output.

### Added
- **Guided step flow (`wizard.html`)** — The wizard is now a multi-step application with a hero screen,
  Previous/Next navigation, and a progress-aware step list, matching the sister project. Steps that
  only matter for an enabled data source (element IDs, local storage keys) appear conditionally, and
  the flow is persisted to `localStorage` so a session can be resumed.
- **Simulated Test & Preview** — A wide two-column step that renders the real dual-pane layout (Power
  App sidebar left, embedded browser right), lets you type sample values for every configured element
  ID and storage key, and shows the exact result of a scrape: the generated sidebar URL, the captured
  JSON, the parameter count, the URL length, whether the reload would be skipped because nothing
  changed, and a simulated `[PowerApp Desktop]` main-process log. The Power Fx `Param()`/`ParseJSON()`
  snippet is included with a copy button.
- **Review and save steps** — A configuration summary (`config.json` preview, sizing, data sources,
  triggers) and a save step that writes to your project folder with the download fallback, plus a
  post-save guide with Windows/macOS/Linux packaging tabs.
- **Import config.json** — The hero screen can load an existing configuration back into the wizard.
- **`window.PowerAppWizard` helpers** — `toConfig`, `buildScrapeResult` and `buildSidebarUrl` mirror
  `main.js` so the simulator cannot drift from the shipping app.

### Changed
- **Wizard styling** — Replaced the dark theme with the sister project's light theme (Platinum page,
  white card, Penn Blue text, International Klein Blue primary, Savoy Blue accents) and its
  container/header/navigation layout, CSS-only window mockup, and `fadeIn` step transitions. The file
  remains a single, zero-dependency HTML document (no CDN, GitHub-Pages ready).

### Added (tests)
- `test/wizard.test.js` drives the shipping wizard through a minimal DOM stub: the whole configuration
  flow, the conditional steps, the simulator output, the identical-scrape dedupe, the written
  `config.json`, a cancelled save, Previous from the distribution guide, Start Over, and session
  restore. `test/static.test.js` adds step-rendering, HTML-escaping and `main.js`-parity checks.
  The suite is now 51 `node:test` cases.

## v1.0.0 — Initial Template Build

The first end-to-end version of the template, derived from the Master Development Document
(`PRD-Powerapp Electron Template.md`) and patterned after its sister Chrome-extension project.

### Added
- **Electron shell (`main.js`)** — Dual-pane desktop window built on `BaseWindow` +
  `WebContentsView`. The Power App renders in a persistent sidebar; the main pane is a freely
  navigable embedded browser.
- **Context passing** — Main-process `executeJavaScript` scraping of the main pane's URL, targeted
  DOM element IDs, and targeted `localStorage` keys. Results are appended to the Power App URL as
  `tabURL`, `tabBody`, and `tabLocalStorage` query parameters.
- **Triggers** — Updates bound to `did-navigate` / `did-navigate-in-page` (URL change) and an
  optional polling timer, both gated by `config.json`.
- **State preservation** — Sidebar is only reloaded when the generated URL actually changes,
  preventing the Power App from losing its state.
- **Microsoft Entra ID support** — `setWindowOpenHandler` allows SSO popups on both views.
- **Configuration loader** — Deep-merges a local `config.json` over safe defaults, with graceful
  fallback when the file is missing or malformed.
- **Visual configuration wizard (`wizard.html`)** — Zero-dependency, single-file wizard that writes
  `config.json` directly into the user's project folder via the File System Access API, with a
  download fallback and copy-ready terminal commands.
- **Research tools** — Bookmarklets to enumerate DOM element IDs and local storage keys, plus a
  drag-and-drop scanner page.
- **Docs** — Rewritten `README.md`, plus `Agents.md`, `TODO.md`, and this history file.
- **Packaging** — Electron Forge with Squirrel (Windows) and ZIP (macOS/Linux) makers.
- **Test suite (`npm test`)** — 42 `node:test` cases. `test/harness.js` loads the real `main.js`
  into a `node:vm` sandbox backed by a stubbed Electron, so config merging, sidebar layout and
  clamping, scrape-script generation, sidebar URL construction (including hostile characters),
  the URL-dedupe guard, trigger wiring, popup handling and shortcuts are asserted against the
  shipping code. `test/static.test.js` re-checks JS syntax, inline HTML scripts, JSON parsing, the
  `config.example.json` schema, `.gitignore` safety and the Pages workflow.

### Notes
- Testing against a live Power App and `npm run make` on each target OS remain manual steps; see
  `TODO.md`.
