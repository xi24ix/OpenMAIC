import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { openDatabase } from './database.js';
import { CurriculumRepository } from './repository.js';

// Only an operator-selected HTTPS bundle with an independently supplied digest
// can bootstrap an empty volume. There is deliberately no HTTP upload endpoint.
// Large bundles may be split into parts (KB_BOOTSTRAP_PARTS) served as
// `${url}.${NNN}` with per-part SHA-256s (comma-separated) so a flaky transfer
// retries one small part instead of the whole archive.
export async function bootstrapCorpus(options: {
  root: string; url: string; token: string; sha256: string;
  parts?: number; partSha256s?: string;
}): Promise<void> {
  const root = path.resolve(options.root);
  try { await access(path.join(root, 'complete.json')); return; } catch { /* New volume. */ }
  if (!/^[a-f0-9]{64}$/.test(options.sha256)) throw new Error('Bootstrap SHA-256 is required');
  const target = new URL(options.url);
  const localTest = ['127.0.0.1', 'localhost'].includes(target.hostname);
  if (target.protocol !== 'https:' && !localTest) throw new Error('Bootstrap requires HTTPS');
  if (!options.token) throw new Error('Bootstrap download token is required');
  await mkdir(path.dirname(root), { recursive: true });
  const temporary = await mkdtemp(path.join(path.dirname(root), '.bootstrap-'));
  try {
    const archive = path.join(temporary, 'bundle.ndjson.gz');
    const digest = createHash('sha256');
    await mkdir(path.join(temporary, 'parts'), { recursive: true });
    const partCount = Math.max(1, Math.floor(options.parts ?? 1));
    const partShas = (options.partSha256s ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    for (let index = 1; index <= partCount; index += 1) {
      const suffix = `.${String(index).padStart(3, '0')}`;
      const partUrl = partCount === 1 ? options.url : `${options.url}${suffix}`;
      const expectedPart = partShas[index - 1];
      const partFile = path.join(temporary, 'parts', `part${suffix}`);
      let done = false;
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= 3 && !done; attempt += 1) {
        try {
          const response = await fetch(partUrl, {
            headers: { authorization: `Bearer ${options.token}` }, redirect: 'error',
            signal: AbortSignal.timeout(2 * 60 * 60 * 1000),
          });
          if (!response.ok || !response.body) throw new Error(`Bootstrap download HTTP ${response.status}`);
          const partDigest = createHash('sha256');
          let bytes = 0;
          await pipeline(Readable.fromWeb(response.body as never), new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              bytes += chunk.length;
              if (bytes > 8 * 1024 ** 3) { callback(new Error('Bootstrap bundle exceeds 8 GiB')); return; }
              partDigest.update(chunk); callback(null, chunk);
            },
          }), createWriteStream(partFile, { flags: 'w', mode: 0o600 }));
          const actualPart = partDigest.digest('hex');
          if (expectedPart && actualPart !== expectedPart) {
            throw new Error(`Part ${index} checksum mismatch (attempt ${attempt})`);
          }
          done = true;
        } catch (error) {
          lastError = error;
          if (attempt < 3) {
            console.log(`Bootstrap part ${index} attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
            await new Promise((resolve) => setTimeout(resolve, attempt * 15000));
          }
        }
      }
      if (!done) throw lastError instanceof Error ? lastError : new Error(`Bootstrap part ${index} failed`);
      await pipeline(createReadStream(partFile), new Transform({
        transform(chunk: Buffer, _encoding, callback) { digest.update(chunk); callback(null, chunk); },
      }), createWriteStream(archive, { flags: partCount === 1 && index === 1 ? 'wx' : 'a', mode: 0o600 }));
    }
    if (digest.digest('hex') !== options.sha256) throw new Error('Bootstrap checksum mismatch');
    const output = path.join(temporary, 'corpus');
    await restoreBundle(archive, output);
    // Never merge into, replace, or delete an existing deployment database.
    await rename(output, root);
    console.log('Corpus bootstrap complete');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function restoreBundle(archive: string, output: string): Promise<void> {
  await mkdir(output, { recursive: false });
  await mkdir(path.join(output, 'assets'));
  const database = await openDatabase({ dataDir: path.join(output, 'db') });
  const repository = new CurriculumRepository(database);
  try { await repository.initialize(); } catch (error) { await database.close(); throw error; }
  // Attach the async iterator immediately: readline consumes input eagerly.
  // Waiting for migrations after opening it can lose a small bundle's records.
  const compressed = createReadStream(archive);
  const decoded = compressed.pipe(createGunzip());
  compressed.on('error', (error) => decoded.destroy(error));
  const lines = createInterface({ input: decoded, crlfDelay: Infinity });
  const assets = new Map<string, string>();
  const required = new Map<string, string>();
  let books = 0;
  try {
    for await (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.type === 'asset') {
        if (!/^assets\/[a-f0-9]{64}\.png$/.test(entry.key)) throw new Error('Invalid bundle asset key');
        const data = Buffer.from(entry.data, 'base64');
        const sha256 = createHash('sha256').update(data).digest('hex');
        if (sha256 !== entry.sha256) throw new Error('Bundle asset checksum mismatch');
        await writeFile(path.join(output, entry.key), data, { flag: 'wx' });
        assets.set(entry.key, sha256);
      } else if (entry.type === 'book') {
        for (const asset of entry.extraction.assets) {
          if (required.has(asset.objectKey) && required.get(asset.objectKey) !== asset.sha256) throw new Error('Conflicting asset digest');
          required.set(asset.objectKey, asset.sha256);
        }
        await repository.importResource(entry.manifest, entry.extraction);
        books += 1;
        console.log(`Imported bootstrap book ${books}`);
      } else throw new Error('Unknown bundle record');
    }
    if (!books) throw new Error('Bootstrap bundle has no books');
    for (const [key, digest] of required) {
      if (assets.get(key) !== digest) throw new Error('Bootstrap bundle missing required asset');
    }
    await writeFile(path.join(output, 'complete.json'), JSON.stringify({ books, assets: assets.size, coverage: await repository.getCoverage() }));
  } finally {
    lines.close(); decoded.destroy(); compressed.destroy();
    await database.close();
  }
}
