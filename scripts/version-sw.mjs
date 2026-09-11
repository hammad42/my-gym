/**
 * Stamps the build version into dist/sw.js.
 *
 * The browser only reinstalls a service worker when the bytes of sw.js change,
 * so the cache name carries a hash of everything in dist/assets. Any change to
 * the bundle changes the hash, changes sw.js, triggers reinstall + activation,
 * and the activate handler then deletes every cache older than the new name.
 *
 * Run automatically as part of `npm run build`.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const swPath = path.join(distDir, 'sw.js');
const assetsDir = path.join(distDir, 'assets');

if (!existsSync(swPath)) {
  console.error('[version-sw] dist/sw.js not found — did the build copy public/?');
  process.exit(1);
}

const hash = createHash('sha256');

if (existsSync(assetsDir)) {
  const files = (await readdir(assetsDir)).sort();
  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(path.join(assetsDir, file)));
  }
} else {
  // No assets dir (should not happen for this app) — fall back to index.html.
  hash.update(await readFile(path.join(distDir, 'index.html')));
}

const version = hash.digest('hex').slice(0, 12);
const sw = await readFile(swPath, 'utf8');

if (!sw.includes('__BUILD_VERSION__')) {
  // Already stamped (e.g. script run twice) or the placeholder was removed.
  console.log('[version-sw] sw.js already carries a version, leaving it as is.');
  process.exit(0);
}

await writeFile(swPath, sw.replaceAll('__BUILD_VERSION__', version));
console.log(`[version-sw] stamped CACHE_NAME -> mygym-pwa-${version}`);
