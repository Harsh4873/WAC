import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const url = new URL(process.argv[2] || 'http://127.0.0.1:8787/v1/analyze');
if (url.username || url.password || url.search || url.hash)
  throw new Error('Use a service URL without credentials, query parameters, or fragments.');
if (
  url.protocol !== 'https:' &&
  !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))
)
  throw new Error('Use HTTPS, or a local loopback address for development.');
const configPath = new URL('analysis.config.json', root);
const previous = JSON.parse(await readFile(configPath, 'utf8'));
const manifestPath = new URL('manifest.json', root);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const old = new URL(previous.endpoint);
const match = (u) => `${u.protocol}//${u.hostname}/*`;
const protectedHosts = ['https://www.googleapis.com/*', 'https://calendar.google.com/*'];
manifest.host_permissions = manifest.host_permissions.filter(
  (host) => protectedHosts.includes(host) || host !== match(old),
);
if (!manifest.host_permissions.includes(match(url))) manifest.host_permissions.push(match(url));
let csp = manifest.content_security_policy.extension_pages;
const directives = csp
  .split(';')
  .map((part) => part.trim())
  .filter(Boolean);
const index = directives.findIndex((part) => part.startsWith('connect-src '));
const sources = directives[index].split(/\s+/).filter((source) => source !== old.origin);
if (!sources.includes(url.origin)) sources.push(url.origin);
directives[index] = sources.join(' ');
manifest.content_security_policy.extension_pages = directives.join('; ');
await writeFile(configPath, `${JSON.stringify({ endpoint: url.href }, null, 2)}\n`);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  'Analysis service address configured. Reload WAC in Chrome. No model credentials are stored in the extension.',
);
