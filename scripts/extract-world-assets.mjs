/**
 * One-off extractor: pulls the base64-embedded art out of the
 * 3d-final-ver reference page into public/voxel/world3d/ so the app can
 * serve it as normal static files.
 *
 * Usage: node scripts/extract-world-assets.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'refrense', '3d-final-ver', 'index.html');
const outDir = join(root, 'public', 'voxel', 'world3d');
mkdirSync(outDir, { recursive: true });

const html = readFileSync(src, 'utf8');
const start = html.indexOf('const IMG = {');
const end = html.indexOf('};', start);
if (start < 0 || end < 0) {
  console.error('IMG object not found');
  process.exit(1);
}
const img = html.slice(start, end);

const re = /(\w+):\s*'data:image\/([\w.+-]+);base64,([A-Za-z0-9+/=]+)'/g;
const extByMime = { jpeg: 'jpg', png: 'png', webp: 'webp' };
let count = 0;
for (const m of img.matchAll(re)) {
  const [, key, mime, b64] = m;
  const ext = extByMime[mime] ?? mime;
  const file = join(outDir, `${key}.${ext}`);
  writeFileSync(file, Buffer.from(b64, 'base64'));
  count++;
  console.log(`${key}.${ext}`);
}
console.log(`Extracted ${count} assets to ${outDir}`);
