import { createHash } from 'node:crypto';

const EXTENSION_ID = /^[a-p]{32}$/;

export function readServerConfig({ env = process.env, manifest = {} } = {}) {
  const port = Number(env.WAC_ANALYSIS_PORT || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Use a port between 1024 and 65535.');
  }

  const extensionIds = new Set();
  if (manifest.key) {
    const id = createHash('sha256')
      .update(Buffer.from(manifest.key, 'base64'))
      .digest('hex')
      .slice(0, 32)
      .replace(/[0-9a-f]/g, (character) =>
        String.fromCharCode(97 + Number.parseInt(character, 16)),
      );
    extensionIds.add(id);
  }

  for (const value of (env.WAC_EXTENSION_IDS || '').split(',')) {
    const id = value.trim();
    if (!id) continue;
    if (!EXTENSION_ID.test(id)) {
      throw new Error('WAC_EXTENSION_IDS must contain comma-separated Chrome extension IDs.');
    }
    extensionIds.add(id);
  }

  return {
    port,
    allowedOrigins: [
      ...Array.from(extensionIds, (id) => `chrome-extension://${id}`),
      'http://127.0.0.1:8765',
      'http://localhost:8765',
    ],
  };
}
