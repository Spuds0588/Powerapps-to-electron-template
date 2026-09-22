# History

All notable changes to the Power App Electron Extension template are recorded here.

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

### Notes
- Testing against a live Power App and `npm run make` on each target OS remain manual steps; see
  `TODO.md`.
