#!/usr/bin/env node
// One-shot authenticated HTTPS source for the corpus bootstrap bundle.
// Serves a single file behind a Bearer token so kwdb's bootstrapCorpus()
// can download it over the cloudflared quick tunnel. Run locally:
//   node scripts/serve-bundle.mjs <bundle.ndjson.gz> <token> [port]
// Then: cloudflared tunnel --url http://127.0.0.1:<port>
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const [file, token, port = '8787'] = process.argv.slice(2);
if (!file || !token) {
  console.error('usage: node scripts/serve-bundle.mjs <bundle.ndjson.gz> <token> [port]');
  process.exit(1);
}
const size = statSync(file).size;
let hits = 0;
createServer((request, response) => {
  const auth = request.headers.authorization ?? '';
  if (auth !== `Bearer ${token}`) {
    response.writeHead(401).end('unauthorized');
    return;
  }
  if (request.method === 'HEAD' || request.url?.endsWith('/sha256')) {
    const digest = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(digest.digest('hex'));
    });
    return;
  }
  hits += 1;
  console.log(`streaming ${file} (${size} bytes) to ${request.socket.remoteAddress} [hit ${hits}]`);
  response.writeHead(200, { 'content-length': size, 'content-type': 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(Number(port), '127.0.0.1', () => console.log(`serving ${file} on 127.0.0.1:${port}`));
