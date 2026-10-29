import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPreviewServer, resolvePreviewFile } from '../scripts/preview.mjs';

test('preview serves the app and modules but refuses credentials, backend code, and write requests', async (t) => {
  const server = createPreviewServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${url}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /WAC/);
  const module = await fetch(`${url}/src/core.mjs`);
  assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type'), /javascript/);
  for (const path of [
    '/.env',
    '/backend/server.mjs',
    '/.git/config',
    '/package.json',
    '/src/%2e%2e%2f.env',
  ]) {
    assert.equal((await fetch(`${url}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(`${url}/`, { method: 'POST' })).status, 405);
  const head = await fetch(`${url}/sidepanel.html`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('preview refuses malformed or non-runtime paths before reading files', async () => {
  for (const path of ['/src/%', '/src/../../.env', '/scripts/check.mjs', '/docs/DEVELOPMENT.md']) {
    await assert.rejects(resolvePreviewFile(path));
  }
});
