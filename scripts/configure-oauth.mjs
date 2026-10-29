import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const manifestPath = new URL('../manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const extensionId = createHash('sha256')
  .update(Buffer.from(manifest.key, 'base64'))
  .digest('hex')
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
const clientId = process.argv[2];
if (!clientId || clientId === '--id') {
  console.log(
    `Extension ID: ${extensionId}\n\nCreate a Google OAuth client of type Chrome Extension using this ID. Then run:\nnode scripts/configure-oauth.mjs YOUR_CLIENT_ID.apps.googleusercontent.com`,
  );
} else if (clientId === '--clear') {
  delete manifest.oauth2;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('OAuth configuration removed. Reload the extension to return to demo-only mode.');
} else if (!/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
  console.error(
    'Enter a valid Google OAuth Client ID, ending in .apps.googleusercontent.com. Do not enter a client secret.',
  );
  process.exitCode = 1;
} else {
  manifest.oauth2 = {
    client_id: clientId,
    scopes: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.events.freebusy',
    ],
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `OAuth configured. Extension ID: ${extensionId}\nReload WAC at chrome://extensions, refresh any open Calendar tabs, and click Connect Google Calendar.`,
  );
}
