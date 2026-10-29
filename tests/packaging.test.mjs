import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildStorePackage } from '../scripts/package-webstore.mjs';

async function fixture(t, changes = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'wac-package-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'src'));
  await mkdir(join(directory, 'icons'));
  await mkdir(join(directory, 'backend'));
  const manifest = {
    manifest_version: 3,
    version: '0.1.0',
    key: 'development-public-key',
    background: { service_worker: 'src/background.js' },
    side_panel: { default_path: 'sidepanel.html' },
    icons: {},
    content_scripts: [],
    ...changes,
  };
  const files = {
    'manifest.json': JSON.stringify(manifest),
    'sidepanel.html': '<!doctype html><title>WAC</title>',
    'analysis.config.json': '{"endpoint":"http://127.0.0.1:8787/v1/analyze"}',
    'src/background.js': "import './helper.mjs';\nexport const ready = true;",
    'src/helper.mjs': 'export const helper = true;',
    '.env': 'TEST_ONLY_SECRET=must-not-be-packaged',
    'backend/private.mjs': 'server-only code',
    'README.md': 'developer documentation',
  };
  for (const [path, content] of Object.entries(files))
    await writeFile(join(directory, path), content);
  return { directory, root: pathToFileURL(`${directory}/`), manifest };
}

test('store package includes runtime dependencies, strips the public key, and leaves source files untouched', async (t) => {
  const { directory, root } = await fixture(t);
  const before = await readFile(join(directory, 'manifest.json'), 'utf8');
  const { entries, archive } = await buildStorePackage(root);
  assert.deepEqual(
    entries.map((entry) => entry.name).sort(),
    [
      'manifest.json',
      'sidepanel.html',
      'analysis.config.json',
      'src/background.js',
      'src/helper.mjs',
    ].sort(),
  );
  assert.equal(
    JSON.parse(entries.find((entry) => entry.name === 'manifest.json').data).key,
    undefined,
  );
  assert.equal(await readFile(join(directory, 'manifest.json'), 'utf8'), before);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
});

test('packaging rejects OAuth secrets rather than including them in an upload', async (t) => {
  const { root } = await fixture(t, { oauth2: { client_secret: 'test-only-secret' } });
  await assert.rejects(buildStorePackage(root), /client secret/);
});

test('packaging rejects invalid Chrome version components', async (t) => {
  const { directory, root, manifest } = await fixture(t);
  for (const version of ['0.0.0', '01.2', '1.65536', '1.2.3.4.5', '1.2-beta']) {
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, version }));
    await assert.rejects(buildStorePackage(root), /version/, version);
  }
});

test('packaging catches missing imported modules before producing a release', async (t) => {
  const { directory, root } = await fixture(t);
  await rm(join(directory, 'src/helper.mjs'));
  await assert.rejects(buildStorePackage(root), /Missing module dependency/);
});
