import { readFile, access, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const project = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Expected Manifest V3.');
if (manifest.version !== project.version)
  throw new Error('Keep package.json and manifest.json versions in sync.');
if (!manifest.key) throw new Error('A stable extension key is required for Google OAuth.');
if (manifest.oauth2?.client_secret)
  throw new Error('OAuth client secrets must never be stored in the extension.');
const paths = [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap((c) => [...c.js, ...c.css]),
];
for (const path of paths) await access(new URL(path, root));
for (const folder of ['src', 'scripts', 'tests', 'backend'])
  for (const name of await readdir(new URL(`${folder}/`, root))) {
    if (!/\.(js|mjs)$/.test(name)) continue;
    const path = new URL(`${folder}/${name}`, root);
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(path)], {
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`${name}: ${result.stderr}`);
  }
const html = await readFile(new URL('sidepanel.html', root), 'utf8');
await access(new URL('analysis.config.json', root));
for (const match of html.matchAll(/(?:src|href)="((?:src|icons)\/[^"?]+)"/g))
  await access(new URL(match[1], root));
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) || /\bon(?:click|load|submit)=/i.test(html))
  throw new Error('Inline executable code is blocked by the extension CSP.');
console.log('Manifest, extension assets, JavaScript syntax, and CSP-compatible HTML verified.');
