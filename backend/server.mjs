import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createAnalysisHandler, MAX_REQUEST_BYTES } from './handler.mjs';
import { readServerConfig } from './config.mjs';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
if (process.argv.slice(2).some((argument) => argument !== '--demo'))
  throw new Error('Usage: node backend/server.mjs [--demo]');
const env = {
  ...process.env,
  ...(process.argv.includes('--demo') ? { WAC_ANALYSIS_MODE: 'demo' } : {}),
};
const { port, allowedOrigins } = readServerConfig({ manifest, env });
const handle = createAnalysisHandler({ allowedOrigins, env });
const server = createServer((req, res) => {
  const chunks = [];
  let size = 0,
    tooLarge = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      tooLarge = true;
      chunks.length = 0;
    } else if (!tooLarge) chunks.push(chunk);
  });
  req.on('end', async () => {
    if (tooLarge) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'This upload is too large.' },
        }),
      );
      return;
    }
    const abort = new AbortController();
    res.once('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers))
        if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value);
      const request = new Request(new URL(req.url, `http://127.0.0.1:${port}`), {
        method: req.method,
        headers,
        ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
        signal: abort.signal,
      });
      const response = await handle(request, { clientId: req.socket.remoteAddress || 'local' });
      if (res.destroyed) return;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.destroyed) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              code: 'SERVICE_ERROR',
              message: 'The analysis service could not complete the request.',
            },
          }),
        );
      }
    }
  });
  req.on('error', () => {
    if (!res.destroyed) res.end();
  });
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(port, '127.0.0.1', () => {
  const status =
    env.WAC_ANALYSIS_MODE === 'demo'
      ? 'DEMO — no AI calls'
      : env.GEMINI_API_KEY && env.GEMINI_MODEL
        ? 'Gemini configured'
        : 'AI not configured — no AI calls';
  console.log(`WAC analysis service: http://127.0.0.1:${port} (${status})`);
});
server.on('error', (error) => {
  console.error(`Could not start the local analysis service: ${error.code || 'unknown error'}`);
  process.exitCode = 1;
});
