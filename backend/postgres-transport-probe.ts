import pg from "pg";

import { resolveAuthContext, withSession } from "../auth/session.ts";

const { Client, Pool } = pg;

type ProbePhase = {
  phase: string;
  success: boolean;
  latencyMs: number;
  error?: {
    name: string;
    code: string | null;
    message: string;
  };
};

function nowMs() {
  return Date.now();
}

export function sanitizePostgresTransportError(value: unknown) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-database-url]")
    .replace(/\b(password|token|apikey|api_key|authorization|cookie)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 240);
}

function sanitizedError(error: unknown) {
  const record = error && typeof error === "object" ? error as { name?: unknown; code?: unknown; message?: unknown } : {};
  return {
    name: sanitizePostgresTransportError(record.name || "Error"),
    code: record.code === undefined || record.code === null ? null : sanitizePostgresTransportError(record.code),
    message: sanitizePostgresTransportError(record.message || error),
  };
}

function sslEnabled() {
  return process.env.PGSSLMODE === "require" || process.env.POSTGRES_SSL === "true";
}

async function timedPhase<T>(phase: string, phases: ProbePhase[], operation: () => Promise<T>) {
  const startedAt = nowMs();
  try {
    const value = await operation();
    phases.push({ phase, success: true, latencyMs: nowMs() - startedAt });
    return value;
  } catch (error) {
    phases.push({ phase, success: false, latencyMs: nowMs() - startedAt, error: sanitizedError(error) });
    throw error;
  }
}

function clientConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw Object.assign(new Error("DATABASE_URL is not configured"), { code: "POSTGRES_NOT_CONFIGURED" });
  return {
    connectionString,
    ssl: sslEnabled() ? { rejectUnauthorized: false } : undefined,
  };
}

async function runClientProbe(phases: ProbePhase[]) {
  const config = clientConfig();
  const client = await timedPhase("client_created", phases, async () => new Client(config));
  try {
    await timedPhase("connect_started", phases, async () => client.connect());
    await timedPhase("select_started", phases, async () => client.query("SELECT 1"));
    return { connectSucceeded: true, selectSucceeded: true };
  } finally {
    await timedPhase("client_end_started", phases, async () => client.end()).catch(() => undefined);
  }
}

async function runPoolProbe(phases: ProbePhase[]) {
  const pool = new Pool({ ...clientConfig(), max: 1 });
  try {
    const client = await timedPhase("pool_connect_started", phases, async () => pool.connect());
    try {
      await timedPhase("pool_select_started", phases, async () => client.query("SELECT 1"));
      return { connectSucceeded: true, selectSucceeded: true };
    } finally {
      client.release();
    }
  } finally {
    await timedPhase("pool_end_started", phases, async () => pool.end()).catch(() => undefined);
  }
}

export const handlePostgresTransportProbe = withSession(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const auth = await resolveAuthContext(request);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const requestId = globalThis.crypto?.randomUUID?.() || `postgres-probe-${Date.now()}`;
  const clientPhases: ProbePhase[] = [];
  const poolPhases: ProbePhase[] = [];
  let clientResult = { connectSucceeded: false, selectSucceeded: false };
  let poolResult: { connectSucceeded: boolean; selectSucceeded: boolean } | null = null;

  try {
    clientResult = await runClientProbe(clientPhases);
  } catch {
    // Stop here: if request-scoped Client cannot connect, the Pool comparison is not useful.
  }

  if (clientResult.connectSucceeded && clientResult.selectSucceeded) {
    try {
      poolResult = await runPoolProbe(poolPhases);
    } catch {
      poolResult = {
        connectSucceeded: poolPhases.some((phase) => phase.phase === "pool_connect_started" && phase.success),
        selectSucceeded: poolPhases.some((phase) => phase.phase === "pool_select_started" && phase.success),
      };
    }
  }

  const lastClientPhase = clientPhases.at(-1) ?? null;
  return Response.json({
    requestId,
    client: {
      connectSucceeded: clientResult.connectSucceeded,
      selectSucceeded: clientResult.selectSucceeded,
      lastPhase: lastClientPhase?.phase ?? "not_started",
      phases: clientPhases,
    },
    pool: poolResult ? {
      ...poolResult,
      lastPhase: poolPhases.at(-1)?.phase ?? "not_started",
      phases: poolPhases,
    } : null,
  }, { headers: { "Cache-Control": "no-store" } });
});
