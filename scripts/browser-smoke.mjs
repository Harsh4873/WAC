import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.WAC_PLAYWRIGHT_PATH || 'playwright');
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const artifactDir = process.env.WAC_ARTIFACTS_DIR || join(root, 'artifacts');
await mkdir(artifactDir, { recursive: true });
const executablePath = process.env.WAC_CHROME_PATH || undefined;
const browser = await chromium.launch({
  executablePath,
  channel: executablePath ? undefined : 'chromium',
  headless: true,
});
const errors = [];
async function finishOnboarding(page) {
  await page.waitForSelector('#profile-dialog[open]');
  await page.locator('#profile-form [name=fieldOfStudy]').fill('History');
  await page.locator('#profile-form [name=preferredBlockMinutes]').fill('60');
  await page.getByRole('button', { name: 'Save my preferences', exact: true }).click();
  await page.waitForSelector('#profile-dialog[open]', { state: 'hidden' });
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    timezoneId: 'America/Chicago',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${process.env.WAC_PREVIEW_URL || 'http://127.0.0.1:8765'}/sidepanel.html`);
  await page.waitForSelector('.task-card');
  await finishOnboarding(page);
  assert.equal(await page.locator('.task-card').count(), 4);
  await page.getByRole('button', { name: 'Off', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-mode=off]').getAttribute('aria-pressed') === 'true',
  );
  assert.equal(await page.locator('.effort-badge').count(), 0);
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await page.waitForSelector('.effort-badge');
  assert.equal(
    await page.locator('.deadline-chip.pattern-medium,.deadline-chip.pattern-high').count(),
    0,
  );
  await page.getByRole('button', { name: 'Patterns', exact: true }).click();
  await page.waitForSelector('.deadline-chip.pattern-medium');
  await page.getByRole('button', { name: '+ Add task', exact: true }).click();
  await page.locator('#task-title').fill('User test · <img src=x onerror=alert(1)>');
  await page
    .locator('#task-form [name=description]')
    .fill('Read a research paper and write notes.');
  await page.locator('#task-estimate').fill('120');
  await page.getByRole('button', { name: 'Save assignment', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.task-card').length === 5);
  assert.equal(await page.locator('.task-card img').count(), 0);
  const taskCard = page.locator('.task-card').filter({ hasText: 'User test' });
  await taskCard.getByRole('button', { name: /high effort:/ }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.task-card')]
      .find((c) => c.textContent.includes('User test'))
      ?.querySelector('.effort-badge')
      ?.textContent.toLowerCase()
      .includes('high'),
  );
  await taskCard.getByRole('button', { name: 'Find time ↗', exact: true }).click();
  await page.waitForSelector('#plan-dialog[open]');
  assert.equal(await page.locator('.proposal-item').count(), 2);
  await page.getByRole('button', { name: 'Save local plan', exact: true }).click();
  await page.waitForSelector('#plan-dialog[open]', { state: 'hidden' });
  await page.waitForFunction(() => document.querySelectorAll('#plan-list .plan-item').length === 2);
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('wac-preview-v1')));
  assert.equal(state.blocks.length, 2);
  assert.equal(
    state.blocks.reduce((n, b) => n + (new Date(b.end) - new Date(b.start)) / 60000, 0),
    120,
  );
  await page.getByRole('tab', { name: /Assignments/ }).click();
  await taskCard.getByRole('button', { name: /Edit User test/ }).click();
  await page.locator('#task-estimate').fill('60');
  await page.getByRole('button', { name: 'Save assignment', exact: true }).click();
  await page.waitForSelector('#task-error:not([hidden])');
  assert.match(await page.locator('#task-error').textContent(), /shorter/);
  await page.locator('#task-dialog .close-dialog').first().click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('[name=reminderCount]').selectOption('0');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.waitForSelector('#settings-dialog[open]', { state: 'hidden' });
  await page.getByRole('button', { name: /Connect Google Calendar/ }).click();
  await page.waitForSelector('#settings-dialog[open]');
  assert.equal(await page.locator('#calendar-guide').getAttribute('open'), '');
  assert.match(await page.locator('#calendar-connection-status').textContent(), /preview/);
  assert.doesNotMatch(
    await page.locator('#calendar-guide').textContent(),
    /Client ID|Google Cloud|configure-oauth|Developer mode/,
  );
  assert.equal(await page.locator('#settings-connect-button').isDisabled(), true);
  await page.locator('#settings-dialog .close-dialog').first().click();
  await page.getByRole('tab', { name: /Work blocks/ }).click();
  await page.getByRole('button', { name: 'Clear unpublished work blocks' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#block-count').textContent === '0');
  await page.getByRole('tab', { name: /Assignments/ }).click();
  // Plan two supplied tasks so the deliverable screenshot shows the central interaction.
  for (const title of ['Literature review', 'Neural network lab']) {
    await page
      .locator('.task-card')
      .filter({ hasText: title })
      .getByRole('button', { name: 'Find time ↗', exact: true })
      .click();
    await page.waitForSelector('#plan-dialog[open]');
    await page.getByRole('button', { name: 'Save local plan', exact: true }).click();
    await page.waitForSelector('#plan-dialog[open]', { state: 'hidden' });
    await page.getByRole('tab', { name: /Assignments/ }).click();
  }
  // Remove the injection-test task before making the clean preview.
  await taskCard.getByRole('button', { name: /Remove User test/ }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.task-card').length === 4);
  await page.locator('#toast').evaluate((el) => {
    el.hidden = true;
  });
  await page.screenshot({ path: `${artifactDir}/workspace-preview.png`, fullPage: true });
  await page.setViewportSize({ width: 380, height: 900 });
  await page.screenshot({ path: `${artifactDir}/sidepanel-preview.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: '+ Add task', exact: true }).click();
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector('#task-dialog').scrollWidth <=
        document.querySelector('#task-dialog').clientWidth,
    ),
    true,
  );
  await page.setViewportSize({ width: 320, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#task-dialog .close-dialog').first().click();
  // Check styling against a controlled Calendar-like DOM, including off-mode cleanup.
  const stylePage = await context.newPage();
  await stylePage.setContent(
    '<div data-eventid="a" title="original">WAC · CSCE 671 · Report</div><div data-eventid="b">Unrelated meeting</div>',
  );
  await stylePage.evaluate(() => {
    window.wacIndex = {
      tasks: [{ id: 't', effort: 'high', estimateMinutes: 180 }],
      blocks: [{ taskId: 't', googleEventId: 'a', googleSummary: 'WAC · CSCE 671 · Report' }],
      visualMode: 'patterns',
    };
    window.styleListeners = [];
    window.chrome = {
      runtime: { sendMessage: async () => ({ ok: true, data: window.wacIndex }) },
      storage: { onChanged: { addListener: (fn) => window.styleListeners.push(fn) } },
    };
  });
  await stylePage.addScriptTag({ content: await readFile(`${root}/src/content.js`, 'utf8') });
  await stylePage.waitForSelector('.wac-effort-badge');
  assert.equal(await stylePage.locator('.wac-effort-badge').count(), 1);
  assert.equal(await stylePage.locator('[data-eventid=b]').getAttribute('class'), null);
  await stylePage.evaluate(() => {
    window.wacIndex.visualMode = 'off';
    window.styleListeners.forEach((fn) => fn({ wacState: {} }, 'local'));
  });
  await stylePage.waitForSelector('.wac-effort-badge', { state: 'detached' });
  assert.equal(await stylePage.locator('[data-eventid=a]').getAttribute('title'), 'original');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: desktop + 380/320px layouts; mode switching; safe task entry; edit validation; planning; settings; clear plan; content-script styling and cleanup.',
  );
} finally {
  await browser.close();
}

const profile = await mkdtemp(join(tmpdir(), 'wac-extension-test-'));
let extContext;
try {
  extContext = await chromium.launchPersistentContext(profile, {
    executablePath,
    channel: executablePath ? undefined : 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  const session = await extContext.browser().newBrowserCDPSession();
  const result = await session.send('Extensions.loadUnpacked', { path: root });
  const id = result.id;
  const page = await extContext.newPage();
  const extErrors = [];
  page.on('pageerror', (e) => extErrors.push(e.message));
  // Stub Calendar page content for reuse checks. Chrome API-created tabs can make
  // their first request before Playwright attaches, so an unsigned profile may show sign-in.
  await extContext.route('https://calendar.google.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Calendar navigation fixture</title><h1>Native Calendar placeholder</h1>',
    }),
  );
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.waitForSelector('.task-card');
  await finishOnboarding(page);
  assert.equal(await page.locator('.task-card').count(), 4);
  assert.equal(await page.locator('.calendar-pane').isVisible(), false);
  assert.equal(await page.evaluate(() => chrome.runtime.id), id);
  assert.equal(
    (await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' }))).ok,
    true,
  );
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
  assert.equal(
    (await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' }))).data.configured,
    Boolean(manifest.oauth2?.client_id),
  );
  await page
    .locator('.task-card')
    .first()
    .getByRole('button', { name: 'Find time ↗', exact: true })
    .click();
  await page.waitForSelector('#plan-dialog[open]');
  await page.getByRole('button', { name: 'Save local plan', exact: true }).click();
  await page.waitForSelector('#plan-dialog[open]', { state: 'hidden' });
  assert.ok(
    (await page.evaluate(() => chrome.storage.local.get('wacState'))).wacState.blocks.length > 0,
  );
  // The arrow opens native Calendar once and then reuses its existing account/date/view.
  const calendarPagePromise = extContext.waitForEvent('page');
  await page.getByRole('button', { name: 'Open Google Calendar', exact: true }).click();
  const calendarPage = await calendarPagePromise;
  await calendarPage.waitForURL(
    (url) => ['https://calendar.google.com', 'https://accounts.google.com'].includes(url.origin),
    { waitUntil: 'domcontentloaded' },
  );
  const existingUrl = 'https://calendar.google.com/calendar/u/1/r/month/2026/11/1';
  await calendarPage.goto(existingUrl);
  const pageCount = extContext.pages().length;
  await page.bringToFront();
  await page.getByRole('button', { name: 'Open Google Calendar', exact: true }).click();
  await page.waitForFunction(async () => {
    const tabs = await chrome.tabs.query({
      url: 'https://calendar.google.com/*',
      currentWindow: true,
    });
    return tabs.length === 1 && tabs[0].active;
  });
  assert.equal(extContext.pages().length, pageCount);
  assert.equal(calendarPage.url(), existingUrl);
  assert.ok(!extContext.pages().some((p) => p.url().includes('?workspace=1')));
  assert.deepEqual(extErrors, []);
  console.log(
    `PASS: actual unpacked extension ${id}, background storage, planning, sidebar-only layout, native Calendar navigation and tab reuse. No Google sign-in or API writes performed.`,
  );
} finally {
  if (extContext) await extContext.close();
  await rm(profile, { recursive: true, force: true });
}
