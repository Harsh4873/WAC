import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

export async function resolvePreviewFile(pathname, rootDir = ROOT) {
  const path = decodeURIComponent(pathname === '/' ? '/sidepanel.html' : pathname);
  // Serve runtime assets only. Never expose local credentials, backend files, or Git metadata.
  if (
    !/^\/(?:sidepanel\.html|analysis\.config\.json|src\/[^/]+\.(?:mjs|js|css)|icons\/[^/]+\.png)$/.test(
      path,
    )
  ) {
    throw new Error('Not found');
  }
  const root = await realpath(rootDir);
  const file = await realpath(resolve(root, `.${path}`));
  if (!file.startsWith(`${root}${sep}`)) throw new Error('Not found');
  return file;
}

export function createPreviewServer({ rootDir = ROOT } = {}) {
  return createServer(async (request, response) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { ...headers, Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    try {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      const file = await resolvePreviewFile(pathname, rootDir);
      const body = await readFile(file);
      response.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : 'Not found');
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.WAC_PREVIEW_PORT || 8765);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('WAC_PREVIEW_PORT must be between 1024 and 65535.');
  }
  const server = createPreviewServer();
  server.on('error', (error) => {
    console.error(`Could not start the preview: ${error.code || 'unknown error'}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`WAC demo preview: http://127.0.0.1:${port}/sidepanel.html`);
  });
}
