import { readFile } from "node:fs/promises";
import { join } from "node:path";

import pg from "pg";

import { isPostgresConnectionError, PostgresSignalRepository, type PostgresClient } from "../information/repositories/postgres.ts";

const { Pool } = pg;

export type DatabaseConfig = {
  connectionString: string;
  ssl?: boolean;
};

let sharedPool: pg.Pool | null = null;

function sanitizePostgresLogValue(value: unknown) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-database-url]")
    .replace(/\b(password|token|apikey|api_key|authorization|cookie)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 240);
}

function sslEnabled() {
  return process.env.PGSSLMODE === "require" || process.env.POSTGRES_SSL === "true";
}

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function readDatabaseConfig(): DatabaseConfig | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  return {
    connectionString,
    ssl: sslEnabled(),
  };
}

export function createPostgresPool(config = readDatabaseConfig()) {
  if (!config) {
    throw new Error("PostgreSQL is not configured");
  }
  const pool = new Pool({
    connectionString: config.connectionString,
    max: Number.parseInt(process.env.POSTGRES_POOL_MAX || "5", 10),
    idleTimeoutMillis: Number.parseInt(process.env.POSTGRES_IDLE_TIMEOUT_MS || "10000", 10),
    connectionTimeoutMillis: Number.parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || "5000", 10),
    keepAlive: true,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  });
  pool.on("error", (error) => {
    console.warn(JSON.stringify({
      event: "postgres_pool_error",
      errorName: sanitizePostgresLogValue(error.name || "Error"),
      errorCode: "code" in error ? sanitizePostgresLogValue(error.code) : undefined,
      errorMessage: sanitizePostgresLogValue(error.message),
      connectionClass: isPostgresConnectionError(error),
    }));
  });
  return pool;
}

export function getPostgresPool() {
  sharedPool ??= createPostgresPool();
  return sharedPool;
}

export function createPostgresRepository(pool = getPostgresPool()) {
  return new PostgresSignalRepository(pool, recoverPostgresReadClient);
}

function recoverPostgresReadClient(failedClient: PostgresClient, error: unknown) {
  if (!isPostgresConnectionError(error)) return failedClient;
  if (sharedPool === failedClient) sharedPool = createPostgresPool();
  return sharedPool ?? getPostgresPool();
}

export async function readMigration(name: string) {
  return readFile(join(process.cwd(), "migrations", name), "utf8");
}

export async function runRagCoreMigration(pool = getPostgresPool()) {
  for (const name of ["0001_rag_core.sql", "0002_user_preferences.sql"]) {
    const sql = await readMigration(name);
    await pool.query(sql);
  }
}

export async function closePostgresPool() {
  if (!sharedPool) return;
  await sharedPool.end();
  sharedPool = null;
}
