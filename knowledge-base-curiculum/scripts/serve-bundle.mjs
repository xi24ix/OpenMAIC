#!/usr/bin/env node
// One-shot authenticated HTTPS source for the corpus bootstrap bundle.
// Serves every file in a directory behind a Bearer token so kwdb's
// bootstrapCorpus() can download the archive or its split parts over a
// cloudflared quick tunnel. Run locally:
//   node scripts/serve-bundle.mjs <dir-with-parts> <token> [port]
// Files are addressed as /get/<name>; /sha256/<name> streams its digest.
import { createReadStream, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import path from 'node:path';

const [dir, token, port = '8787'] = process.argv.slice(2);
if (!dir || !token) {
  console.error('usage: node scripts/serve-bundle.mjs <bundle-or-dir> <token> [port]');
  process.exit(1);
}
const files = new Map();
for (const name of readdirSync(dir)) {
  const full = path.join(dir, name);
  if (statSync(full).isFile()) files.set(name, full);
}
if (!files.size) { console.error('no files to serve'); process.exit(1); }
console.log(`serving ${files.size} file(s) from ${dir} on 127.0.0.1:${port}`);
let hits = 0;
createServer((request, response) => {
  const auth = request.headers.authorization ?? '';
  if (auth !== `Bearer ${token}`) { response.writeHead(401).end('unauthorized'); return; }
  const url = (request.url ?? '').replace(/^\/+/, '');
  const name = decodeURIComponent(url.startsWith('sha256/') ? url.slice(7) : url.startsWith('get/') ? url.slice(4) : url);
  const full = files.get(name);
  if (!full) { response.writeHead(404).end('not found'); return; }
  if (request.method === 'HEAD' || url.startsWith('sha256/')) {
    const digest = createHash('sha256');
    const stream = createReadStream(full);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('end', () => { response.writeHead(200, { 'content-type': 'text/plain' }); response.end(digest.digest('hex')); });
    stream.on('error', () => response.writeHead(500).end('read error'));
    return;
  }
  const size = statSync(full).size;
  hits += 1;
  console.log(`streaming ${name} (${size} bytes) [hit ${hits}]`);
  response.writeHead(200, { 'content-length': size, 'content-type': 'application/octet-stream' });
  createReadStream(full).on('error', () => response.destroy()).pipe(response);
}).listen(Number(port), '127.0.0.1', () => console.log('ready'));
