import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readServerConfig } from '../backend/config.mjs';

test('allows the stable development ID and explicitly configured store ID without wildcard access', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const storeId = 'jemkcnfiakblmlfoefjenckljbcngeoj';
  const config = readServerConfig({
    manifest,
    env: { WAC_EXTENSION_IDS: `${storeId}, ${storeId}` },
  });
  assert.equal(config.port, 8787);
  assert.ok(config.allowedOrigins.includes('chrome-extension://opiabkfomcghikkaicmfmhhbfgfonjhi'));
  assert.ok(config.allowedOrigins.includes(`chrome-extension://${storeId}`));
  assert.equal(config.allowedOrigins.filter((value) => value.endsWith(storeId)).length, 1);
  assert.ok(!config.allowedOrigins.includes('*'));
});

test('accepts an explicit store ID without a local manifest key and rejects invalid origins or ports', () => {
  assert.ok(
    readServerConfig({
      env: { WAC_EXTENSION_IDS: 'abcdefghijklmnopabcdefghijklmnop' },
    }).allowedOrigins.includes('chrome-extension://abcdefghijklmnopabcdefghijklmnop'),
  );
  for (const id of ['*', 'https://example.com', 'invalid-id']) {
    assert.throws(
      () => readServerConfig({ env: { WAC_EXTENSION_IDS: id } }),
      /Chrome extension IDs/,
    );
  }
  for (const port of ['0', '1023', '65536', 'not-a-port']) {
    assert.throws(() => readServerConfig({ env: { WAC_ANALYSIS_PORT: port } }), /port/);
  }
});
