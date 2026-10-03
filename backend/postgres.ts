import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
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

function sslEnabledFromEnv() {
  return process.env.PGSSLMODE === "require" || process.env.POSTGRES_SSL === "true";
}

export type DriverSsl = { rejectUnauthorized: boolean; ca?: string };

// The pinned Supabase CA must be a real PEM chain or we refuse to run rather
// than silently drop certificate validation.
function loadAndValidateCa(caPath: string): string {
  let pem: string;
  try {
    pem = readFileSync(caPath, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "ERROR";
    throw new Error(`POSTGRES_CA_PATH 无法读取（${code}）: ${caPath}`);
  }
  const blocks = [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)];
  if (!blocks.length) throw new Error(`POSTGRES_CA_PATH 不含有效证书（INVALID_CA）: ${caPath}`);
  for (const block of blocks) {
    try {
      new X509Certificate(block[0]);
    } catch {
      throw new Error(`POSTGRES_CA_PATH 含无效证书（INVALID_CA）: ${caPath}`);
    }
  }
  return pem;
}

// Detects an sslmode parameter embedded in the connection string. The driver
// merges connectionString params OVER the caller's ssl option (pg 8.x:
// Object.assign({}, config, parse(connectionString))), so a sslmode inside
// DATABASE_URL silently overrides the explicit application setting in both
// directions (disable kills TLS; require re-enables it). We surface that as a
// configuration error instead of letting the driver decide.
function sslmodeInConnectionString(connectionString: string): string | undefined {
  try {
    const url = new URL(connectionString);
    const raw = url.searchParams.get("sslmode");
    if (raw) return raw;
    // pg-connection-string also accepts whitespace-separated key=value pairs
    // after the host part; handle the common "?sslmode=" and "&sslmode=" shapes
    // (URLSearchParams covers both) plus explicit " sslmode=" segments.
    const fallback = /(?:^|[\s?&])sslmode=([^&\s]+)/i.exec(connectionString)?.[1];
    return fallback;
  } catch {
    // Not a parseable URL: fall back to a conservative regex scan.
    return /(?:^|[\s?&])sslmode=([^&\s]+)/i.exec(connectionString)?.[1];
  }
}

function rejectSslConflict(appSetting: "enabled" | "disabled", urlMode: string): never {
  throw new Error(
    `SSL 配置冲突：应用显式配置 SSL 为 ${appSetting}，但连接串包含 sslmode=${urlMode}。` +
      "请统一连接串与应用配置后重试（错误信息已脱敏，不含连接串与凭证）。",
  );
}

// Resolves the driver-ready ssl option.
// - config.ssl, when provided, is the source of truth: an explicit `false` is
//   never overridden by the environment switch.
// - when config.ssl is undefined, the environment switch (PGSSLMODE /
//   POSTGRES_SSL) decides.
// - a disabled result is the explicit boolean `false` (not undefined) so any
//   sslmode parameter in DATABASE_URL cannot silently re-enable TLS.
// - TLS is never configured to fall back to plaintext.
// - TLS without a CA path is a configuration error: the driver would silently
//   accept rejectUnauthorized:false, which this contract forbids.
// - a sslmode embedded in the connection string that contradicts the explicit
//   application setting is a rejected conflict (the driver would otherwise
//   apply it silently in either direction).
export function resolveDriverSsl(config?: DatabaseConfig): DriverSsl | false {
  const enabled = config?.ssl ?? sslEnabledFromEnv();
  const urlSslmode = config ? sslmodeInConnectionString(config.connectionString) : undefined;
  if (urlSslmode) {
    const normalized = urlSslmode.toLowerCase();
    if (enabled && (normalized === "disable" || normalized === "off" || normalized === "false" || normalized === "0")) {
      rejectSslConflict("enabled", urlSslmode);
    }
    if (!enabled && normalized !== "disable" && normalized !== "off" && normalized !== "false" && normalized !== "0" && normalized !== "prefer") {
      // pg-connection-string treats prefer/require/verify-ca/verify-full as TLS-on;
      // only a genuinely conflicting TLS-on mode against app-disabled is rejected.
      rejectSslConflict("disabled", urlSslmode);
    }
  }
  if (!enabled) return false;
  const caPath = process.env.POSTGRES_CA_PATH;
  if (!caPath) {
    throw new Error(
      "SSL 配置错误：TLS 已启用但 POSTGRES_CA_PATH 未配置。" +
        "为避免无法验证服务器证书，本配置不会回退到跳过证书校验的模式；请配置 CA 路径后重试。",
    );
  }
  return { rejectUnauthorized: true, ca: loadAndValidateCa(caPath) };
}

export function buildPoolOptions(config: DatabaseConfig) {
  return {
    connectionString: config.connectionString,
    max: Number.parseInt(process.env.POSTGRES_POOL_MAX || "5", 10),
    idleTimeoutMillis: Number.parseInt(process.env.POSTGRES_IDLE_TIMEOUT_MS || "10000", 10),
    connectionTimeoutMillis: Number.parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || "5000", 10),
    keepAlive: true,
    ssl: resolveDriverSsl(config),
  };
}

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function readDatabaseConfig(): DatabaseConfig | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  return {
    connectionString,
    ssl: sslEnabledFromEnv(),
  };
}

export function createPostgresPool(config = readDatabaseConfig()) {
  if (!config) {
    throw new Error("PostgreSQL is not configured");
  }
  const pool = new Pool(buildPoolOptions(config));
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
