# TODO

Working checklist for the template. Mirrors the Developer Task List in
`PRD-Powerapp Electron Template.md`. Items are checked once they are implemented in this repository.

## Phase 1: Repository Setup
- [x] Initialize standard Node.js repository (`package.json`).
- [x] Install Electron and Electron Forge dependencies (declared in `package.json`).
- [x] Setup standard `.gitignore` (ignore `node_modules`, `out/`, `config.json`).
- [x] Create base `README.md` with link to the GitHub Pages wizard.

## Phase 2: Core Electron Shell (`main.js`)
- [x] Scaffold `main.js` with `app`, `BaseWindow`, and `WebContentsView` imports.
- [x] Implement `fs` logic to read `config.json` (with fallback defaults if missing).
- [x] Instantiate the main window and attach the two `WebContentsView` elements (Sidebar & Main).
- [x] Implement the window resize listener to maintain the defined `sidebarWidth`.
- [x] Dock the sidebar on the right by default, with `sidebarPosition: "left"` as the flip option.
- [x] Implement `setWindowOpenHandler` on both views to allow Microsoft Entra ID popups.

## Phase 3: Context Passing & Scraping Logic
- [x] Write the `updatePowerApp()` function to construct the URL based on `config.parameters`.
- [x] Implement `executeJavaScript` injection to conditionally scrape URL, DOM IDs, and localStorage.
- [x] Implement check so `sidebarView.webContents.loadURL()` is only called when the new URL differs.
- [x] Bind `updatePowerApp()` to `did-navigate` and `did-navigate-in-page` on the main view.
- [x] Bind `updatePowerApp()` to `setInterval` when the polling timer is enabled in config.

## Phase 4: Configuration Wizard (`wizard.html`)
- [x] Build the HTML UI (Sidebar, Parameter, and Trigger configuration inputs).
- [x] Style the wizard using standard CSS (matching the established blue developer aesthetic).
- [x] Implement `window.showDirectoryPicker()` logic on the Save button.
- [x] Format the form inputs into the expected JSON schema and write to disk via `createWritable()`.
- [x] Build the dynamic terminal output display (revealed post-save) with copy/paste NPM commands.
- [x] Rebuild the wizard as a multi-step flow (hero, Previous/Next, conditional steps, resumable
      state) matching the sister project's wizard experience and light theme.
- [x] Add the simulated Test & Preview output: sample inputs per captured value, the generated
      sidebar URL, the scraped JSON, the reload-dedupe result, and a simulated main-process log.
- [x] Add the review step, the platform-tabbed packaging guide, and `Import config.json`.

## Phase 5: Testing & Distribution
- [x] Add an automated test suite (`npm test`) driven by `node:test`: `main.js` is loaded into a
      `node:vm` sandbox with a stubbed Electron (`test/harness.js`) so config merging, layout maths,
      scrape-script generation, sidebar URL building, the dedupe guard, and the triggers are all
      covered without a display server.
- [x] Add static verification tests for JS syntax, inline `<script>` blocks in the HTML pages, JSON
      parsing, the config-example schema, and the Pages workflow.
- [x] Add wizard tests that drive the real `wizard.html`: the full step flow, the simulated preview,
      the written config, and parity between the wizard's URL builder and `main.js`.
- [x] Add a real-browser suite (`npm run test:browser`) on Puppeteer's Chromium. It clicks through
      the whole wizard, measures the mockup with `getBoundingClientRect` to prove the Power App pane
      docks on the side `sidebarPosition` names (hero and Test & Preview), checks the divider renders
      on the pane's inner edge, runs the simulator, and fails on uncaught or console errors from the
      wizard's own code.
- [x] Support headed runs too (`HEADED=1`, and `npm run test:browser:headed` on a virtual display),
      and skip the suite rather than fail when no Chromium is installed.
- [x] Cover what the site serves from the same suite — the root entry point, the scanners page and
      `config.example.json` over HTTP — plus `npm run verify:pages` against the live deployment.
- [ ] Eyeball the screenshots the browser suite writes to `test/screenshots/` after a UI change.
- [ ] Test the Microsoft Auth flow using a live Power App URL.
- [ ] Test DOM scraping against a dummy webpage.
- [ ] Test `npm run make` on Windows (Squirrel) and Mac (ZIP) to ensure clean executables.

## Backlog (YAGNI — explicitly out of scope for v1)
- [ ] Multi-tab browsing in the main window.
- [ ] Floating action buttons injected into external pages.
- [ ] IPC messaging via `preload.js`.
- [ ] Cross-origin iframe DOM scraping (blocked by standard CORS policies).
