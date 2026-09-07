import { readFile } from "node:fs/promises";
import { join } from "node:path";

import pg from "pg";

import { PostgresSignalRepository } from "../information/repositories/postgres.ts";

const { Pool } = pg;

export type DatabaseConfig = {
  connectionString: string;
  ssl?: boolean;
};

let sharedPool: pg.Pool | null = null;

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
  return new Pool({
    connectionString: config.connectionString,
    max: Number.parseInt(process.env.POSTGRES_POOL_MAX || "5", 10),
    idleTimeoutMillis: Number.parseInt(process.env.POSTGRES_IDLE_TIMEOUT_MS || "30000", 10),
    connectionTimeoutMillis: Number.parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || "5000", 10),
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  });
}

export function getPostgresPool() {
  sharedPool ??= createPostgresPool();
  return sharedPool;
}

export function createPostgresRepository(pool = getPostgresPool()) {
  return new PostgresSignalRepository(pool);
}

export async function readMigration(name: string) {
  return readFile(join(process.cwd(), "migrations", name), "utf8");
}

export async function runRagCoreMigration(pool = getPostgresPool()) {
  const sql = await readMigration("0001_rag_core.sql");
  await pool.query(sql);
}

export async function closePostgresPool() {
  if (!sharedPool) return;
  await sharedPool.end();
  sharedPool = null;
}
