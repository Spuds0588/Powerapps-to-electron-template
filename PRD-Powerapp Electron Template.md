# Master Development Document: Power App Electron Extension

## 1. Product Requirements Document (PRD)

### 1.1 Objective
To provide low-code and no-code developers with a template to easily package and extend their Microsoft Power Apps into a standalone desktop application. The application will run in a dual-pane layout, where the Power App lives in a persistent sidebar, and the main window functions as an embedded browser for external tools. The application must extract context (URL, DOM data, Local Storage) from the main window and pass it back to the Power App seamlessly.

### 1.2 Target Audience
*   **Primary:** Low-code/No-code Power App builders and Citizen Developers.
*   **Secondary:** IT Administrators deploying customized internal desktop tools.
*   **Skill Level:** Users have minimal traditional coding experience; they rely on visual interfaces and simple terminal commands (NPM).

### 1.3 Core Features
*   **Dual-Pane Desktop Shell:** A native desktop window featuring two side-by-side views (Sidebar and Main Content).
*   **Visual Configuration Wizard:** A web-based UI hosted on GitHub Pages that utilizes the File System Access API. Users can visually configure their app and save the `config.json` directly into their local project directory without manually editing code or unzipping files.
*   **Context Passing:** Ability to scrape data from the main window (URL, HTML Elements by ID, Local Storage keys) and inject it into the Power App via URL query parameters.
*   **Dynamic Triggers:** Scraping and context passing can be triggered by Main Window navigation events or a continuous polling timer.
*   **Microsoft Entra ID (Azure AD) Support:** Native handling of authentication pop-ups ensuring Power Apps can securely log in users without breaking the dual-pane layout.

### 1.4 User Flow
1.  **Download:** User downloads or clones the open-source GitHub repository to their local machine.
2.  **Configure:** User navigates to the public GitHub Pages Wizard URL. They fill out their Power App URL, sizing, and data triggers. They click "Save", select their downloaded repository folder, and grant file system permissions.
3.  **Build/Test:** User copies the generated terminal commands (`npm install`, `npm start`) from the wizard to test their app locally.
4.  **Distribute:** User runs `npm run make` to generate a standalone `.exe` or `.zip` for their end users.

### 1.5 Out of Scope (YAGNI Decisions)
*   Multi-tab browsing in the main window.
*   Floating action buttons injected into external pages.
*   Complex IPC (Inter-Process Communication) messaging flows via `preload.js`.
*   Cross-origin iframe DOM scraping (Standard CORS policies apply).

---

## 2. Implementation Guide

### 2.1 Architecture Overview
The application relies on Electron to create a desktop shell. Instead of legacy `BrowserView` or heavily restricted `iframe` tags, it uses Electron's modern `WebContentsView`. 
*   **Main Process (`main.js`):** Reads the configuration, orchestrates the two `WebContentsView` instances, intercepts navigation, executes DOM scraping, and handles popup logic.
*   **Wizard (`wizard.html`):** A strictly client-side vanilla HTML/JS application relying on the browser's native `window.showDirectoryPicker()` API to generate the configuration file.

### 2.2 Tech Stack
*   **Runtime:** Node.js + Electron
*   **Builder:** Electron Forge (`@electron-forge/cli`, `maker-squirrel`, `maker-zip`)
*   **Wizard:** HTML5, CSS3, Vanilla JavaScript (File System Access API)

### 2.3 Key Implementation Details

#### Handling Authentication
Power Apps heavily rely on Microsoft SSO, which spawns new windows. These must be intercepted to prevent Electron from blocking them or rendering them inside the sidebar itself.
```javascript
const popupHandler = ({ url }) => {
  console.log(`[Popup Allowed] Request to open: ${url}`);
  return { action: 'allow' }; // Spawns a native Electron modal for the login flow
};
sidebarView.webContents.setWindowOpenHandler(popupHandler);
mainContentView.webContents.setWindowOpenHandler(popupHandler);
```

#### Context Scraping (Zero IPC Overhead)
Instead of injecting a `preload.js` script and setting up asynchronous IPC channels, the main process will inject JavaScript directly into the main view upon navigation/timer triggers.
```javascript
const data = await mainContentView.webContents.executeJavaScript(`
  ({
    url: window.location.href,
    body: { /* scraped DOM IDs */ },
    localStorage: { /* scraped keys */ }
  })
`);
```
This data is then parsed, appended as URL parameters to the base Power App URL, and loaded into the sidebar *only if* the resulting URL differs from the currently loaded URL (preventing infinite reload loops and state loss).

### 2.4 Configuration Schema (`config.json`)
```json
{
  "powerAppUrl": "https://apps.powerapps.com/play/...",
  "sidebarWidth": 400,
  "defaultMainUrl": "https://bing.com",
  "parameters": {
    "includeTabUrl": true,
    "includeTabBody": false,
    "targetIds": ["usernameField"],
    "includeLocalStorage": false,
    "targetLocalStorageKeys": ["sessionToken"]
  },
  "triggers": {
    "onUrlChange": true,
    "onTimer": {
      "enabled": false,
      "interval": 2000
    }
  }
}
```

---

## 3. Developer Task List

### Phase 1: Repository Setup
- [ ] Initialize standard Node.js repository (`package.json`).
- [ ] Install Electron and Electron Forge dependencies.
- [ ] Setup standard `.gitignore` (ignore `node_modules`, `out/`, `config.json`).
- [ ] Create base README.md with link to the GitHub Pages wizard.

### Phase 2: Core Electron Shell (`main.js`)
- [ ] Scaffold `main.js` with `app`, `BrowserWindow`, and `WebContentsView` imports.
- [ ] Implement `fs` logic to read `config.json` (with fallback defaults if missing).
- [ ] Instantiate the main window and attach the two `WebContentsView` elements (Sidebar & Main).
- [ ] Implement the window resize listener to maintain the defined `sidebarWidth`.
- [ ] Implement `setWindowOpenHandler` on both views to allow Microsoft Azure AD popups.

### Phase 3: Context Passing & Scraping Logic
- [ ] Write the `updatePowerApp()` function to construct the URL based on `config.parameters`.
- [ ] Implement `executeJavaScript` injection to conditionally scrape URL, DOM IDs, and LocalStorage.
- [ ] Implement check to ensure `sidebarView.webContents.loadURL()` is only called if the new URL parameters differ from the active URL (preventing state wipe).
- [ ] Bind `updatePowerApp()` to `did-navigate` and `did-navigate-in-page` events on the main view.
- [ ] Bind `updatePowerApp()` to `setInterval` if the polling timer is enabled in config.

### Phase 4: Configuration Wizard (`wizard.html`)
- [ ] Build the HTML UI (Sidebar, Parameter, and Trigger configuration inputs).
- [ ] Style the wizard using standard CSS (matching dark-mode developer aesthetic).
- [ ] Implement `window.showDirectoryPicker()` logic on the Save button.
- [ ] Format the form inputs into the expected JSON schema and write to disk via `createWritable()`.
- [ ] Build the dynamic terminal output display (revealed post-save) to give users their copy/paste NPM commands.

### Phase 5: Testing & Distribution
- [ ] Test the Microsoft Auth flow using a live Power App URL.
- [ ] Test DOM scraping against a dummy webpage.
- [ ] Test `npm run make` on Windows (Squirrel) and Mac (ZIP) to ensure clean executables are generated.

---

## 4. Agents.md

```markdown
# Agent Directives: Power App Electron Extension

## Project Overview
You are acting as an expert Electron & Node.js developer assisting in the creation of a desktop wrapper for Microsoft Power Apps. The app utilizes a dual-pane layout (`WebContentsView`) to display a Power App in a sidebar and an external browser in the main window. 

## Architectural Constraints & Rules
1.  **YAGNI (You Aren't Gonna Need It):** Keep solutions strictly to one-liners or minimal implementations where possible. Do not over-engineer.
2.  **No IPC/Preload Scripts:** Do NOT use `preload.js` or `ipcMain`/`ipcRenderer` for context scraping. We exclusively use `webContents.executeJavaScript` directly from `main.js` to extract data from the main window. 
3.  **Modern Electron APIs:** Always use `WebContentsView` instead of `BrowserView` (deprecated) or `<webview>` / `<iframe>` tags. 
4.  **State Preservation:** The Power App is a heavy Canvas application. Never call a reload or `loadURL` on the sidebar unless the underlying injected URL parameters have explicitly changed.
5.  **Popup Handling:** Microsoft SSO requires popups. Ensure `setWindowOpenHandler` always returns `{ action: 'allow' }` for auth flows.
6.  **Configuration:** Settings are read from a local `config.json` generated by a web-based wizard. Ensure robust fallback defaults if the file is missing or malformed.
7.  **The Wizard:** The configuration wizard (`wizard.html`) must remain a vanilla, zero-dependency, single-file HTML application relying on the native File System Access API (`window.showDirectoryPicker`). It must be deployable to GitHub Pages without a backend.

## Common Testing Scenarios
*   If a user reports "Blank screen when logging in", check the `setWindowOpenHandler` popup logic.
*   If a user reports "Wizard cannot save file", verify they are using a Secure Context (HTTPS/GitHub Pages) and a Chromium-based browser that supports the File System Access API.
*   If a user reports "Power App keeps refreshing and I lose my text", verify the conditional check preventing identical URL reloads is functioning in the `updatePowerApp()` loop.
```