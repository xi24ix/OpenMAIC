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
export async function bootstrapCorpus(options: {
  root: string; url: string; token: string; sha256: string;
}): Promise<void> {
  const root = path.resolve(options.root);
  try { await access(path.join(root, 'complete.json')); return; } catch { /* New volume. */ }
  if (!/^[a-f0-9]{64}$/.test(options.sha256)) throw new Error('Bootstrap SHA-256 is required');
  if (new URL(options.url).protocol !== 'https:') throw new Error('Bootstrap requires HTTPS');
  if (!options.token) throw new Error('Bootstrap download token is required');
  await mkdir(path.dirname(root), { recursive: true });
  const temporary = await mkdtemp(path.join(path.dirname(root), '.bootstrap-'));
  try {
    const response = await fetch(options.url, {
      headers: { authorization: `Bearer ${options.token}` }, redirect: 'error',
      signal: AbortSignal.timeout(2 * 60 * 60 * 1000),
    });
    if (!response.ok || !response.body) throw new Error(`Bootstrap download HTTP ${response.status}`);
    const digest = createHash('sha256');
    let bytes = 0;
    const archive = path.join(temporary, 'bundle.ndjson.gz');
    await pipeline(Readable.fromWeb(response.body as never), new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > 8 * 1024 ** 3) { callback(new Error('Bootstrap bundle exceeds 8 GiB')); return; }
        digest.update(chunk); callback(null, chunk);
      },
    }), createWriteStream(archive, { flags: 'wx', mode: 0o600 }));
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

// Operator-only merge path used for updating an already-populated deployment.
// The normal bootstrap path intentionally refuses to touch an existing corpus;
// this path keeps that safety boundary while importing through the live service.
export async function importBundleInto(options: {
  archive: string;
  repository: CurriculumRepository;
  assetRoot: string;
}): Promise<{ books: number; assets: number; coverage: unknown }> {
  await mkdir(options.assetRoot, { recursive: true });
  const compressed = createReadStream(options.archive);
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
        if (sha256 !== entry.sha256 || entry.key !== `assets/${sha256}.png`) throw new Error('Bundle asset checksum mismatch');
        const target = path.resolve(options.assetRoot, entry.key);
        await mkdir(path.dirname(target), { recursive: true });
        try {
          await access(target);
        } catch {
          await writeFile(target, data, { flag: 'wx', mode: 0o600 });
        }
        assets.set(entry.key, sha256);
      } else if (entry.type === 'book') {
        for (const asset of entry.extraction.assets) {
          if (required.has(asset.objectKey) && required.get(asset.objectKey) !== asset.sha256) throw new Error('Conflicting asset digest');
          required.set(asset.objectKey, asset.sha256);
        }
        await options.repository.importResource(entry.manifest, entry.extraction);
        books += 1;
      } else {
        throw new Error('Unknown bundle record');
      }
    }
    if (!books) throw new Error('Bundle has no books');
    for (const [key, digest] of required) {
      if (assets.get(key) !== digest) {
        try { await access(path.resolve(options.assetRoot, key)); }
        catch { throw new Error('Bundle missing required asset'); }
      }
    }
    return { books, assets: assets.size, coverage: await options.repository.getCoverage() };
  } finally {
    lines.close();
    decoded.destroy();
    compressed.destroy();
  }
}
