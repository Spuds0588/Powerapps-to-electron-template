// [PowerApp Desktop] test/wizard.test.js
//
// Drives the shipping `wizard.html` step by step through a minimal DOM stub
// (test/harness.js). This covers the parts a static check cannot: the
// Previous/Next flow, the conditional steps, the simulated Test & Preview
// output, and the save -> distribution-guide phase switch.
//
// Run with: npm test

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadWizard } = require('./harness');

test('the wizard boots on the intro and hides the navigation', () => {
  const page = loadWizard();

  assert.match(page.html(), /class="wizard-step active"/);
  assert.ok(page.html().includes('Power App Desktop Builder'), 'the hero should render');
  assert.equal(page.el('.wizard-navigation').style.display, 'none');
  assert.equal(page.el('.container').style.maxWidth, '1200px');
  assert.equal(page.el('next-btn').textContent, 'Get Started →');
  assert.equal(page.el('prev-btn').disabled, true);
});

test('the wizard walks the whole configuration flow and saves a valid config.json', async () => {
  const page = loadWizard();
  const { el, html, click, sandbox } = page;

  // Intro -> step 1.
  await el('hero-get-started-btn').click();
  assert.ok(html().includes('id="powerAppUrl"'), 'step 1 should render the Power App URL field');
  assert.equal(el('.wizard-navigation').style.display, 'flex');

  el('powerAppUrl').value = 'https://apps.powerapps.com/play/e/ENV/a/APP?tenantId=TT';
  el('defaultMainUrl').value = 'https://www.bing.com';
  await click('next-btn');

  // Step 2: sizing and the sidebar side.
  assert.ok(html().includes('id="sidebarWidth"'), 'step 2 should render the sizing fields');
  el('windowWidth').value = '1280';
  el('windowHeight').value = '800';
  el('sidebarWidth').value = '380';
  el('sidebarPosition').value = 'right';
  await el('sidebarPosition').dispatch('change');
  await click('next-btn');

  // Step 3: data sources. Enabling the two optional sources must reveal their steps.
  assert.ok(html().includes('id="includeTabBody"'), 'step 3 should render the data sources');
  el('includeTabUrl').checked = true;
  el('includeTabBody').checked = true;
  el('includeLocalStorage').checked = true;
  await click('next-btn');

  assert.ok(html().includes('id="targetIds"'), 'the element-ID step should appear when enabled');
  el('targetIds').value = 'customerName, caseStatus\npolicyNumber';
  await click('next-btn');

  assert.ok(html().includes('id="targetLocalStorageKeys"'), 'the storage step should appear when enabled');
  el('targetLocalStorageKeys').value = 'sessionToken';
  await click('next-btn');

  // Step 6: triggers.
  assert.ok(html().includes('id="onTimerEnabled"'), 'step 6 should render the triggers');
  el('onUrlChange').checked = true;
  el('onTimerEnabled').checked = true;
  el('onTimerInterval').value = '3000';
  await click('next-btn');

  // Step 7: the simulated output.
  assert.ok(html().includes('id="simulateBtn"'), 'the preview step should render the simulator');
  assert.ok(html().includes('id="sim_customerName"'), 'the simulator should ask for a value per element ID');
  assert.ok(html().includes('id="simloc_sessionToken"'), 'the simulator should ask for a value per storage key');
  assert.equal(el('.container').style.maxWidth, '1200px', 'the preview step should use the wide layout');

  el('simTabUrl').value = 'https://example.com/claims/1042';
  el('sim_customerName').value = 'Ada Lovelace';
  el('sim_caseStatus').value = 'Open';
  el('sim_policyNumber').value = '';
  el('simloc_sessionToken').value = 'tok-123';
  await el('simulateBtn').click();

  const sidebarUrl = el('simUrl').textContent;
  assert.ok(sidebarUrl.startsWith('https://apps.powerapps.com/play/e/ENV/a/APP?tenantId=TT&tabURL='));
  assert.ok(sidebarUrl.includes('tabBody='), 'the simulator should append tabBody');
  assert.ok(sidebarUrl.includes('tabLocalStorage='), 'the simulator should append tabLocalStorage');
  // URLSearchParams encodes spaces as '+' - same as main.js.
  assert.ok(decodeURIComponent(sidebarUrl.replace(/\+/g, '%20')).includes('"customerName":"Ada Lovelace"'));
  assert.equal(el('simParamCount').textContent, '3');
  assert.equal(el('simReload').textContent, 'Reload');
  assert.ok(el('simScrape').textContent.includes('Ada Lovelace'), 'the scrape preview should show the values');
  assert.ok(el('simConsole').innerHTML.includes('Updating Power App with 3 parameter(s)'));
  assert.equal(el('mockMainUrl').textContent, 'https://example.com/claims/1042');

  // A second identical scrape must be reported as deduped - the app skips the reload.
  await el('simulateBtn').click();
  assert.equal(el('simReload').textContent, 'Skipped');
  assert.ok(el('simConsole').innerHTML.includes('skipping reload'));

  // Step 8: review.
  await click('next-btn');
  assert.ok(html().includes('id="review-json"'), 'the review step should render');
  assert.ok(html().includes('Sidebar: 380 px (right)'));
  assert.ok(html().includes('customerName'), 'the review should list the captured IDs');

  // Step 9: save.
  await click('next-btn');
  assert.ok(html().includes('id="save-btn"'), 'the save step should render');
  assert.equal(el('next-btn').textContent, '💾 Save config.json');

  let written = null;
  sandbox.window.showDirectoryPicker = async () => ({
    name: 'Powerapps-to-electron-template',
    getFileHandle: async () => ({
      createWritable: async () => ({
        write: async (text) => { written = text; },
        close: async () => {}
      })
    })
  });

  await click('next-btn');

  const config = JSON.parse(written);
  assert.equal(config.powerAppUrl, 'https://apps.powerapps.com/play/e/ENV/a/APP?tenantId=TT');
  assert.equal(config.defaultMainUrl, 'https://www.bing.com');
  assert.equal(config.sidebarWidth, 380);
  assert.equal(config.sidebarPosition, 'right');
  assert.equal(config.windowWidth, 1280);
  assert.equal(config.windowHeight, 800);
  assert.deepEqual(config.parameters.targetIds, ['customerName', 'caseStatus', 'policyNumber']);
  assert.deepEqual(config.parameters.targetLocalStorageKeys, ['sessionToken']);
  assert.equal(config.parameters.includeTabUrl, true);
  assert.equal(config.parameters.includeTabBody, true);
  assert.equal(config.parameters.includeLocalStorage, true);
  assert.equal(config.triggers.onUrlChange, true);
  assert.equal(config.triggers.onTimer.enabled, true);
  assert.equal(config.triggers.onTimer.interval, 3000);
  assert.equal(written.endsWith('\n'), true, 'the written file should end with a newline');
  assert.equal(el('status').className, 'status ok');

  // Saving swaps the whole step list for the distribution guide.
  assert.ok(html().includes("You're all set"), 'the guide should replace the wizard after saving');
  assert.ok(html().includes('data-tab="win"') && html().includes('data-tab="linux"'));
  assert.equal(el('next-btn').textContent, '🔄 Start Over');
  assert.equal(el('.container').style.maxWidth, 'var(--container-width)');
});

test('a cancelled save keeps the wizard on the save step', async () => {
  const page = loadWizard();
  const { el, html, click, sandbox } = page;

  // Skip straight to the save step: intro -> 1 -> 2 -> 3 -> triggers -> preview -> review -> save.
  el('powerAppUrl').value = 'https://apps.powerapps.com/play/e/ENV/a/APP';
  for (let i = 0; i < 7; i += 1) await click('next-btn');
  assert.ok(html().includes('id="save-btn"'), 'should be on the save step');

  const abort = new Error('user cancelled');
  abort.name = 'AbortError';
  sandbox.window.showDirectoryPicker = async () => { throw abort; };

  await click('next-btn');

  assert.equal(el('status').textContent, 'Save cancelled.');
  assert.ok(html().includes('id="save-btn"'), 'a cancelled save must not advance the wizard');

  // The download fallback marks the configuration as saved so Next can continue.
  await el('download-btn').click();
  assert.equal(el('next-btn').textContent, 'Continue →');
});

test('the sidebar position is selectable and written to config.json', async () => {
  const page = loadWizard();
  const { el, html, click, sandbox } = page;

  // The hero mockup docks the Power App on the right until told otherwise.
  assert.ok(html().includes('class="browser-content sidebar-right"'), 'the mockup should start right-handed');
  assert.ok(
    html().indexOf('Browser (main pane)') < html().indexOf('Power App (sidebar)'),
    'the right-handed layout renders the main pane first'
  );

  await click('next-btn');
  el('powerAppUrl').value = 'https://apps.powerapps.com/play/e/ENV/a/APP';
  await click('next-btn');

  el('sidebarPosition').value = 'left';
  await el('sidebarPosition').dispatch('change');

  // Walk to the simulated preview, whose mockup uses the chosen position.
  for (let i = 0; i < 3; i += 1) await click('next-btn');
  assert.ok(html().includes('id="simulateBtn"'), 'the preview step should render');
  assert.ok(!html().includes('class="browser-content sidebar-right"'), 'the left-handed layout drops the right modifier class');
  assert.ok(
    html().indexOf('Power App (sidebar)') < html().indexOf('Browser (main pane)'),
    'the left-handed layout renders the Power App pane first'
  );

  await click('next-btn');
  assert.ok(html().includes('id="review-json"'), 'the review step should render');
  assert.ok(html().includes('Sidebar: 420 px (left)'), 'the review should show the flipped position');

  let written = null;
  sandbox.window.showDirectoryPicker = async () => ({
    name: 'project',
    getFileHandle: async () => ({
      createWritable: async () => ({
        write: async (text) => { written = text; },
        close: async () => {}
      })
    })
  });

  await click('next-btn'); // review -> save
  await click('next-btn'); // saves config.json
  assert.equal(JSON.parse(written).sidebarPosition, 'left');
});

test('importing a config.json keeps its sidebar position', async () => {
  const page = loadWizard();
  const { el, html, click } = page;

  el('import-config-file').files = [{
    text: async () => JSON.stringify({ powerAppUrl: 'https://apps.powerapps.com/play/e/ENV/a/APP', sidebarPosition: 'left' })
  }];
  await el('import-config-file').dispatch('change');

  assert.ok(html().includes('id="powerAppUrl"'), 'the import should jump back into the wizard');

  for (let i = 0; i < 5; i += 1) await click('next-btn');
  assert.ok(html().includes('Sidebar: 420 px (left)'), 'the imported position should survive the import');
});

test('Previous walks back out of the guide and Start Over resets everything', async () => {
  const page = loadWizard();
  const { el, html, click, sandbox } = page;

  sandbox.window.showDirectoryPicker = async () => ({
    name: 'project',
    getFileHandle: async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) })
  });

  el('powerAppUrl').value = 'https://apps.powerapps.com/play/e/ENV/a/APP';
  for (let i = 0; i < 8; i += 1) await click('next-btn');
  assert.ok(html().includes("You're all set"), 'should have saved and reached the guide');

  await click('prev-btn');
  assert.ok(html().includes('id="save-btn"'), 'Previous should return to the save step');
  await click('prev-btn');
  assert.ok(html().includes('id="review-json"'), 'Previous should keep walking back');

  // Start Over from the guide clears the persisted state and returns to the intro.
  for (let i = 0; i < 2; i += 1) await click('next-btn');
  assert.ok(html().includes("You're all set"));
  await click('next-btn');

  assert.ok(html().includes('hero-title'), 'Start Over should return to the intro');

  const page2 = loadWizard();
  assert.ok(page2.html().includes('hero-title'), 'a fresh boot should still show the intro');
});

test('the wizard restores a saved session from localStorage', async () => {
  // Boot lazily so the stored state is in place before the wizard reads it.
  const page = loadWizard({ boot: false });

  page.sandbox.localStorage.setItem(
    'powerAppDesktopBuilderState',
    JSON.stringify({
      configData: {
        powerAppUrl: 'https://apps.powerapps.com/play/e/ENV/a/RESUMED',
        defaultMainUrl: 'https://www.bing.com',
        sidebarWidth: 500,
        includeTabUrl: true
      },
      currentStep: 1,
      isBuilt: false,
      configSaved: false
    })
  );

  page.boot();

  assert.ok(page.html().includes('id="powerAppUrl"'), 'the resumed session should reopen on step 1');
  assert.ok(page.html().includes('https://apps.powerapps.com/play/e/ENV/a/RESUMED'));

  await page.click('next-btn');

  assert.match(page.html(), /value="500"/, 'the saved sizing should be restored too');
});
