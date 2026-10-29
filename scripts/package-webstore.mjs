import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ROOT = new URL('../', import.meta.url);
export async function buildStorePackage(root = ROOT) {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  if (
    manifest.manifest_version !== 3 ||
    typeof manifest.version !== 'string' ||
    !/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/.test(manifest.version) ||
    manifest.version.split('.').some((part) => Number(part) > 65535) ||
    !manifest.version.split('.').some((part) => Number(part) > 0)
  )
    throw new Error('Expected a valid Manifest V3 extension version.');
  const storeManifest = structuredClone(manifest);
  delete storeManifest.key;
  if (storeManifest.oauth2?.client_secret)
    throw new Error('Do not package an OAuth client secret.');

  // Only runtime assets belong in the upload. Development keys, server code,
  // tests, screenshots, documentation, and environment files stay outside it.
  const entries = [
    { name: 'manifest.json', data: Buffer.from(`${JSON.stringify(storeManifest, null, 2)}\n`) },
  ];
  for (const path of ['sidepanel.html', 'analysis.config.json'])
    entries.push({ name: path, data: await readFile(new URL(path, root)) });
  for (const folder of ['src', 'icons']) {
    for (const item of (await readdir(new URL(`${folder}/`, root), { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (!item.isFile()) continue;
      if (folder === 'src' && !/\.(?:mjs|js|css)$/.test(item.name)) continue;
      if (folder === 'icons' && !/\.png$/.test(item.name)) continue;
      const path = `${folder}/${item.name}`;
      entries.push({ name: path, data: await readFile(new URL(path, root)) });
    }
  }
  const included = new Set(entries.map((entry) => entry.name));
  for (const path of [
    storeManifest.side_panel.default_path,
    storeManifest.background.service_worker,
    ...Object.values(storeManifest.icons),
    ...storeManifest.content_scripts.flatMap((script) => [...script.js, ...script.css]),
  ]) {
    if (!included.has(path)) throw new Error(`Missing packaged asset: ${path}`);
  }
  for (const entry of entries.filter((e) => /\.(?:js|mjs)$/.test(e.name))) {
    for (const match of entry.data
      .toString('utf8')
      .matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"](\.\.?\/[^'"]+)['"]/g)) {
      const target = new URL(match[1], new URL(entry.name, root));
      const path = fileURLToPath(target).slice(fileURLToPath(root).length);
      if (!included.has(path))
        throw new Error(`Missing module dependency: ${entry.name} -> ${path}`);
    }
  }

  const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    let crc = n;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    return crc >>> 0;
  });
  const crc32 = (buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const localRecords = [],
    directory = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    localRecords.push(header, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += header.length + name.length + compressed.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return {
    version: manifest.version,
    entries,
    archive: Buffer.concat([...localRecords, central, end]),
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--out-dir'))
    throw new Error('Usage: npm run package:webstore -- [--out-dir DIRECTORY]');
  const releaseDir = args.length ? resolve(args[1]) : fileURLToPath(new URL('dist/', ROOT));
  const { version, entries, archive } = await buildStorePackage();
  await mkdir(releaseDir, { recursive: true });
  const output = resolve(releaseDir, `wac-webstore-${version}.zip`);
  await writeFile(output, archive);
  console.log(`Chrome Web Store upload: ${output}`);
  console.log(
    `Packaged ${entries.length} runtime files. The upload manifest has no key field; the local development manifest is unchanged.`,
  );
  console.log(
    'Match the store Item ID with the Google OAuth client before testing calendar authorization.',
  );
}
