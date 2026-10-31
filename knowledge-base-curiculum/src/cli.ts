import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from './database.js';
import { manifestSchema, type Extraction, type ImportManifest } from './contracts.js';
import { CurriculumRepository } from './repository.js';
import { createCurriculumServer } from './server.js';
import { bootstrapCorpus } from './bootstrap.js';

type ParsedArgs = { positionals: string[]; options: Map<string, string> };

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value.startsWith('--')) {
      const [key, inline] = value.slice(2).split('=', 2);
      const optionValue = inline ?? args[++index];
      if (!optionValue || optionValue.startsWith('--')) throw new Error(`Missing value for --${key}`);
      options.set(key, optionValue);
    } else positionals.push(value);
  }
  return { positionals, options };
}

function option(args: ParsedArgs, name: string, envName: string, fallback?: string): string | undefined {
  return args.options.get(name) ?? process.env[envName] ?? fallback;
}

function usage(): string {
  return `Usage:\n  kb init [--data-dir DIR]\n  kb import MANIFEST.json EXTRACTION.json [ASSET_ROOT] [--data-dir DIR]\n  kb coverage [--data-dir DIR]\n  kb serve [--host HOST] [--port PORT] [--data-dir DIR] [--asset-root DIR]\n\nEnvironment:\n  KB_DATABASE_URL  PostgreSQL connection string (otherwise local PGlite is used)\n  KB_DATA_DIR      Local database/data directory (default ./data)\n  KB_ASSET_ROOT    Root for extracted asset object keys (default KB_DATA_DIR)\n  KB_API_TOKEN     Optional Bearer token or x-api-key required by HTTP and MCP\n  KB_HOST          Bind host (default 0.0.0.0)\n  KB_PORT          Bind port (default 3000)`;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function validateAssetRoot(root: string, extraction: Extraction): Promise<void> {
  const rootPath = await realpath(root);
  for (const asset of extraction.assets) {
    if (path.isAbsolute(asset.objectKey)) throw new Error(`Asset objectKey must be relative: ${asset.objectKey}`);
    const candidate = path.resolve(rootPath, asset.objectKey);
    const relative = path.relative(rootPath, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Asset objectKey escapes asset root: ${asset.objectKey}`);
    const resolved = await realpath(candidate);
    const resolvedRelative = path.relative(rootPath, resolved);
    if (resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative)) throw new Error(`Asset objectKey escapes asset root: ${asset.objectKey}`);
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error(`Asset objectKey is not a file: ${asset.objectKey}`);
  }
}

async function withRepository<T>(dataDir: string, callback: (repository: CurriculumRepository) => Promise<T>): Promise<T> {
  const database = await openDatabase({ databaseUrl: process.env.KB_DATABASE_URL, dataDir });
  const repository = new CurriculumRepository(database);
  try {
    await repository.initialize();
    return await callback(repository);
  } finally {
    await database.close();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';
  const parsed = parseArgs(process.argv.slice(3));
  const dataDir = path.resolve(option(parsed, 'data-dir', 'KB_DATA_DIR', './data')!);

  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === 'init') {
    await withRepository(dataDir, async () => undefined);
    process.stdout.write(`Initialized database at ${dataDir}\n`);
    return;
  }
  if (command === 'coverage') {
    const coverage = await withRepository(dataDir, (repository) => repository.getCoverage());
    process.stdout.write(`${JSON.stringify(coverage, null, 2)}\n`);
    return;
  }
  if (command === 'import') {
    if (parsed.positionals.length < 2) throw new Error('import requires MANIFEST.json and EXTRACTION.json');
    const manifestInput = await readJson<ImportManifest>(path.resolve(parsed.positionals[0]));
    const extraction = await readJson<Extraction>(path.resolve(parsed.positionals[1]));
    const manifest = manifestSchema.parse(manifestInput);
    const assetRoot = option(parsed, 'asset-root', 'KB_ASSET_ROOT', parsed.positionals[2] ? path.resolve(parsed.positionals[2]) : undefined);
    if (assetRoot) await validateAssetRoot(assetRoot, extraction);
    const result = await withRepository(dataDir, (repository) => repository.importResource(manifest, extraction));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === 'serve') {
    if (process.env.KB_BOOTSTRAP_URL) {
      const root = path.resolve(process.env.KB_BOOTSTRAP_ROOT ?? '/app/data/corpus');
      if (dataDir !== path.join(root, 'db') || process.env.KB_DATABASE_URL) throw new Error('Bootstrap requires its own local corpus/db directory');
      await bootstrapCorpus({ root, url: process.env.KB_BOOTSTRAP_URL, token: process.env.KB_BOOTSTRAP_TOKEN ?? '', sha256: process.env.KB_BOOTSTRAP_SHA256 ?? '', parts: Number(process.env.KB_BOOTSTRAP_PARTS ?? '1'), partSha256s: process.env.KB_BOOTSTRAP_PART_SHA256S ?? '' });
    }
    const host = option(parsed, 'host', 'KB_HOST', '0.0.0.0')!;
    const port = Number(option(parsed, 'port', 'KB_PORT', '3000'));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be an integer from 1 to 65535');
    const assetRoot = path.resolve(option(parsed, 'asset-root', 'KB_ASSET_ROOT', dataDir)!);
    const database = await openDatabase({ databaseUrl: process.env.KB_DATABASE_URL, dataDir });
    const repository = new CurriculumRepository(database);
    await repository.initialize();
    const server = createCurriculumServer({ repository, assetRoot, apiToken: process.env.KB_API_TOKEN });
    const close = async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await database.close(); };
    process.once('SIGINT', () => { void close().then(() => process.exit(0)); });
    process.once('SIGTERM', () => { void close().then(() => process.exit(0)); });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        process.stdout.write(`Curriculum service listening on http://${host}:${port}\n`);
        resolve();
      });
    });
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
