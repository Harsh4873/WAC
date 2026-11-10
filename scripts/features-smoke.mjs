import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.WAC_PLAYWRIGHT_PATH || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const artifactDir = process.env.WAC_ARTIFACTS_DIR || join(root, 'artifacts');
await mkdir(artifactDir, { recursive: true });
const executablePath = process.env.WAC_CHROME_PATH || undefined;
const profile = await mkdtemp(join(tmpdir(), 'wac-features-test-'));
let context;
const errors = [];
let mode = 'unconfigured',
  captured = null;
const result = {
  title: 'Source comparison',
  type: 'writing',
  complexity: 'medium',
  deadline: null,
  summary: 'A fixed task draft for exercising the upload and review workflow.',
  estimate: { minutes: 120, lowMinutes: 90, highMinutes: 180 },
  steps: [
    { title: 'Read the sources', minutes: 30 },
    { title: 'Draft a comparison', minutes: 60 },
    { title: 'Review and revise', minutes: 30 },
  ],
  reasons: ['Compare evidence and support a written argument.'],
  assumptions: ['Both sources are available.'],
  questions: ['What is the assignment deadline?'],
  suggestedBlockMinutes: 25,
};
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath,
    channel: executablePath ? undefined : 'chromium',
    headless: true,
    viewport: { width: 400, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  await context.route('http://127.0.0.1:8787/v1/analyze', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
      });
      return;
    }
    captured = route.request().postDataJSON();
    await route.fulfill({
      status: mode === 'unconfigured' ? 503 : 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(
        mode === 'unconfigured'
          ? {
              error: {
                code: 'AI_NOT_CONFIGURED',
                message:
                  'AI analysis is not connected yet. Enter your own estimate or try again later.',
              },
            }
          : {
              provider: 'demo',
              model: 'browser-fixture',
              generatedAt: new Date().toISOString(),
              analysis: result,
            },
      ),
    });
  });
  const session = await context.browser().newBrowserCDPSession();
  const { id } = await session.send('Extensions.loadUnpacked', { path: root });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.waitForSelector('#profile-dialog[open]');
  await page.locator('#profile-form [name=fieldOfStudy]').fill('History');
  await page.locator('#profile-form [name=stage]').selectOption('undergraduate');
  await page
    .locator('#profile-form [name=familiarTopics]')
    .fill('Close reading and writing essays');
  await page.locator('#profile-form [name=developingTopics]').fill('Primary-source research');
  await page.locator('#profile-form [name=preferredBlockMinutes]').fill('25');
  await page.screenshot({ path: `${artifactDir}/onboarding-preview.png` });
  await page.getByRole('button', { name: 'Save my preferences', exact: true }).click();
  await page.waitForSelector('#profile-dialog[open]', { state: 'hidden' });
  await page.reload();
  await page.waitForSelector('.task-card');
  assert.equal(await page.locator('#profile-dialog').evaluate((el) => el.open), false);
  assert.equal(
    (await page.evaluate(() => chrome.storage.local.get('wacState'))).wacState.profile.fieldOfStudy,
    'History',
  );
  await page.getByRole('button', { name: '+ Add task', exact: true }).click();
  await page.locator('#task-title').fill('Import test');
  const longText =
    'Compare a primary historical source with a secondary source, explaining evidence, context, and differing interpretations. '.repeat(
      70,
    );
  await page.locator('#assignment-file').setInputFiles({
    name: 'instructions.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(longText),
  });
  await page.waitForFunction(() => document.querySelector('#task-description').value.length > 5000);
  assert.match(await page.locator('#attachment-name').textContent(), /instructions.txt/);
  const pdf = Buffer.from('%PDF-1.4\nWAC upload fixture; not sent to a real model.');
  await page
    .locator('#assignment-file')
    .setInputFiles({ name: 'history-rubric.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() =>
    document.querySelector('#attachment-name').textContent.includes('history-rubric.pdf'),
  );
  await page.getByRole('button', { name: 'Analyze assignment', exact: false }).click();
  await page.waitForSelector('#analysis-error:not([hidden])');
  assert.match(await page.locator('#analysis-error').textContent(), /not connected/);
  assert.equal(await page.locator('#task-estimate').isEditable(), true);
  mode = 'ready';
  await page.getByRole('button', { name: 'Analyze assignment', exact: false }).click();
  await page.waitForSelector('#analysis-result:not([hidden])');
  assert.match(await page.locator('#analysis-source').textContent(), /Demo draft/);
  assert.equal(captured.profile.fieldOfStudy, 'History');
  assert.equal(captured.profile.preferredBlockMinutes, 25);
  assert.ok(captured.text.length > 5000);
  assert.equal(captured.attachment.data, pdf.toString('base64'));
  assert.ok(!JSON.stringify(captured).includes('access_token'));
  assert.equal(await page.locator('#task-title').inputValue(), 'Source comparison');
  assert.notEqual(await page.locator('#task-due').inputValue(), '');
  const due = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(18, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T18:00`;
  });
  await page.locator('#task-due').fill(due);
  await page.locator('#analysis-result').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${artifactDir}/task-import-preview.png` });
  await page.getByRole('button', { name: 'Save assignment', exact: true }).click();
  await page.waitForSelector('#task-dialog[open]', { state: 'hidden' });
  const card = page.locator('.task-card').filter({ hasText: 'Source comparison' });
  await card.getByRole('button', { name: 'Find time ↗', exact: true }).click();
  await page.waitForSelector('#plan-dialog[open]');
  await page.waitForFunction(
    () => document.querySelectorAll('#proposal-list .proposal-item').length === 5,
  );
  assert.equal(await page.locator('#plan-block-length').inputValue(), '25');
  await page.locator('#split-mode').selectOption('custom');
  await page.locator('#custom-block-lengths').fill('90,90');
  assert.equal(await page.locator('#save-plan').isDisabled(), true);
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await page.waitForSelector('#plan-error:not([hidden])');
  assert.match(await page.locator('#plan-error').textContent(), /more than/);
  await page.locator('#custom-block-lengths').fill('25, 45, 50');
  await page.getByRole('button', { name: 'Update plan', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('#proposal-list .proposal-item').length === 3 &&
      !document.querySelector('#save-plan').disabled,
  );
  assert.deepEqual(await page.locator('#proposal-list .proposal-item>span').allTextContents(), [
    '25m',
    '45m',
    '50m',
  ]);
  await page.screenshot({ path: `${artifactDir}/task-splitting-preview.png` });
  await page.getByRole('button', { name: 'Save local plan', exact: true }).click();
  await page.waitForSelector('#plan-dialog[open]', { state: 'hidden' });
  const saved = (await page.evaluate(() => chrome.storage.local.get('wacState'))).wacState;
  const task = saved.tasks.find((t) => t.title === 'Source comparison');
  assert.equal(task.analysis.provider, 'demo');
  assert.equal(task.analysis.complexity, 'medium');
  assert.equal(task.attachment.name, 'history-rubric.pdf');
  assert.equal(task.attachment.data, undefined);
  assert.ok(task.description.length > 5000);
  assert.deepEqual(
    saved.blocks
      .filter((b) => b.taskId === task.id)
      .map((b) => (new Date(b.end) - new Date(b.start)) / 60000),
    [25, 45, 50],
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Edit my learning profile', exact: true }).click();
  await page.locator('#profile-form [name=fieldOfStudy]').fill('Nursing');
  await page.locator('#profile-form [name=preferredBlockMinutes]').fill('35');
  await page.getByRole('button', { name: 'Save my preferences', exact: true }).click();
  await page.waitForSelector('#profile-dialog[open]', { state: 'hidden' });
  assert.equal(
    (await page.evaluate(() => chrome.storage.local.get('wacState'))).wacState.settings
      .blockMinutes,
    35,
  );
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole('button', { name: '+ Add task', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(
    await page.locator('#task-dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '+ Add task', exact: true }).click();
  assert.equal(await page.locator('#analyze-assignment').isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: first-use profile, persisted non-CS preferences, long TXT/PDF intake, unavailable-service recovery, validated analysis draft, required deadline confirmation, editable block lengths, custom 25/45/50 plan, saved metadata without PDF bytes, profile editing and 320px layout. No paid model calls or real calendar writes.',
  );
} finally {
  if (context) await context.close();
  await rm(profile, { recursive: true, force: true });
}
