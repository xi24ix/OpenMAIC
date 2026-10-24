import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { PGlite } from '@electric-sql/pglite';

export interface DatabaseResult<Row extends QueryResultRow = Record<string, unknown>> {
  rows: Row[];
  rowCount: number;
}

export interface Database {
  query<Row extends QueryResultRow = Record<string, unknown>>(text: string, values?: unknown[]): Promise<DatabaseResult<Row>>;
  transaction<T>(fn: (database: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PostgresDatabase implements Database {
  constructor(private readonly pool: Pool) {}

  async query<Row extends QueryResultRow = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<DatabaseResult<Row>> {
    const result: QueryResult<Row> = await this.pool.query<Row>(text, values);
    return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
  }

  async transaction<T>(fn: (database: Database) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    const tx: Database = {
      query: async <Row extends QueryResultRow = Record<string, unknown>>(text: string, values: unknown[] = []) => {
        const result = await client.query<Row>(text, values);
        return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
      },
      transaction: async <Nested>(nested: (database: Database) => Promise<Nested>) => nested(tx),
      close: async () => undefined,
    };
    try {
      await client.query('BEGIN');
      const value = await fn(tx);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PGliteDatabase implements Database {
  constructor(private readonly database: PGlite) {}

  async query<Row extends QueryResultRow = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<DatabaseResult<Row>> {
    const result = await this.database.query<Row>(text, values);
    return { rows: result.rows, rowCount: result.rows.length };
  }

  async transaction<T>(fn: (database: Database) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const scoped: Database = {
        query: async <Row extends QueryResultRow = Record<string, unknown>>(text: string, values: unknown[] = []) => {
          const result = await transaction.query<Row>(text, values);
          return { rows: result.rows, rowCount: result.rows.length };
        },
        transaction: async <Nested>(nested: (database: Database) => Promise<Nested>) => nested(scoped),
        close: async () => undefined,
      };
      return fn(scoped);
    });
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}

async function migrationSql(name: string): Promise<string> {
  const candidates = [
    new URL(`../database/${name}`, import.meta.url),
    new URL(`../../database/${name}`, import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return readFile(candidate, 'utf8');
    } catch {
      // The first path is used by tsx/source; the second is used by dist/src.
    }
  }
  throw new Error(`Unable to locate database/${name} relative to the database module`);
}

export async function applyInitialMigration(database: Database): Promise<void> {
  await database.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const version of ['001_initial.sql', '002_hardening.sql']) {
    const applied = await database.query<{ version: string }>('SELECT version FROM schema_migrations WHERE version=$1', [version]);
    if (applied.rows.length) continue;
    const sql = await migrationSql(version);
    await database.transaction(async (db) => {
      // PGlite prepares `query` statements and rejects a multi-command string;
      // these migrations contain no function bodies or quoted semicolons.
      for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
        await db.query(statement);
      }
      await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
  }
}

export async function openDatabase(options: { databaseUrl?: string; dataDir: string }): Promise<Database> {
  if (options.databaseUrl) {
    return new PostgresDatabase(new Pool({ connectionString: options.databaseUrl }));
  }
  const pglite = new PGlite(options.dataDir);
  await pglite.waitReady;
  return new PGliteDatabase(pglite);
}
