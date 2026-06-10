import pg from 'pg';

const { Pool } = pg;

// Neon requires TLS; the connection string must include ?sslmode=require.
const DATABASE_URL = process.env.DATABASE_URL;

let pool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getPool(): pg.Pool {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not defined');
  }
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 8000,
    });
  }
  return pool;
}

// All embeddings are 768-dim (see EMBEDDING_DIMENSIONS in server.ts); the
// pgvector columns must match.
const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  github_id BIGINT UNIQUE NOT NULL,
  login TEXT NOT NULL,
  avatar_url TEXT,
  ai_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repos (
  id SERIAL PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  branch TEXT NOT NULL,
  last_commit_sha TEXT,
  overview JSONB,
  stats JSONB,
  highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_indexed TIMESTAMPTZ NOT NULL DEFAULT now(),
  github_user_id BIGINT,
  is_private BOOLEAN NOT NULL DEFAULT false,
  is_temporary BOOLEAN NOT NULL DEFAULT false,
  indexed_by TEXT[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  embedding vector(768),
  UNIQUE (owner, name, branch)
);
CREATE INDEX IF NOT EXISTS repos_github_user_idx ON repos (github_user_id);
CREATE INDEX IF NOT EXISTS repos_indexed_by_idx ON repos USING GIN (indexed_by);

CREATE TABLE IF NOT EXISTS files (
  id SERIAL PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  type TEXT NOT NULL,
  sha TEXT,
  url TEXT,
  content TEXT,
  UNIQUE (repo_id, path)
);

CREATE TABLE IF NOT EXISTS snippets (
  id SERIAL PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  purpose TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  embedding vector(768)
);
CREATE INDEX IF NOT EXISTS snippets_repo_path_idx ON snippets (repo_id, path);
`;

export async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getPool()
      .query(SCHEMA_SQL)
      .then(() => undefined)
      .catch((err) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

export async function query<R extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<R>> {
  await ensureSchema();
  return getPool().query<R>(text, params);
}

export function isConfigured(): boolean {
  return !!DATABASE_URL;
}

/**
 * node-postgres has no native pgvector type — embeddings are bound as a
 * string literal and cast with `::vector` in the query.
 */
export function toVectorLiteral(embedding: number[] | null | undefined): string | null {
  if (!embedding || embedding.length === 0) return null;
  return `[${embedding.join(',')}]`;
}

/**
 * Maps a repos row to the JSON shape the frontend has always consumed
 * (Mongo-era field names, `_id` as a string id).
 */
export function repoToJson(row: any): any {
  if (!row) return null;
  return {
    _id: String(row.id),
    owner: row.owner,
    name: row.name,
    branch: row.branch,
    lastCommitSha: row.last_commit_sha ?? undefined,
    overview: row.overview ?? undefined,
    stats: row.stats ?? undefined,
    highlights: row.highlights ?? [],
    lastIndexed: row.last_indexed,
    githubUserId: row.github_user_id != null ? Number(row.github_user_id) : undefined,
    isPrivate: row.is_private,
    isTemporary: row.is_temporary,
    indexedBy: row.indexed_by ?? [],
    expiresAt: row.expires_at ?? undefined,
    score: row.score != null ? Number(row.score) : undefined,
  };
}

export function snippetToJson(row: any): any {
  if (!row) return null;
  return {
    _id: String(row.id),
    repoId: String(row.repo_id),
    owner: row.owner,
    name: row.name,
    path: row.path,
    content: row.content,
    purpose: row.purpose ?? undefined,
    startLine: row.start_line,
    endLine: row.end_line,
    score: row.score != null ? Number(row.score) : undefined,
  };
}

/**
 * Anonymous-indexed repos used to expire via a Mongo TTL index; with Postgres
 * we expire them lazily. Cheap enough to call before reads/writes.
 */
export async function deleteExpiredRepos(): Promise<number[]> {
  const res = await query(
    `DELETE FROM repos WHERE expires_at IS NOT NULL AND expires_at < now() RETURNING id`
  );
  return res.rows.map((r: any) => r.id);
}
