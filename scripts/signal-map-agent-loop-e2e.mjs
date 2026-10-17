import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn, execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import pg from "pg";
// Real production attention-preference modifier: replay evidence is re-derived
// by executing this, never by trusting caller-declared outcome booleans.
import { applyAttentionPreferences } from "../agent/evaluation.ts";

const { Client } = pg;

const startedAt = Date.now();
const runId = `gha-agent-loop-${randomUUID()}`;
const port = Number.parseInt(process.env.PORT || "18080", 10);
const baseUrl = `http://127.0.0.1:${port}`;
const origin = process.env.SIGNAL_MAP_ALLOWED_ORIGIN || baseUrl;
const reportPathJson = "signal-map-agent-loop-e2e-report.json";
const reportPathMd = "signal-map-agent-loop-e2e-report.md";
const qualityQuery = (process.env.SIGNAL_MAP_QUALITY_QUERY || "").trim();
const qualityModelRequestTimeoutMs = qualityQuery
  ? (process.env.SIGNAL_MAP_QUALITY_MODEL_REQUEST_TIMEOUT_MS || "6000")
  : "";
const qualityReportPathJson = "signal-map-agent-quality-report.json";
const qualityReportPathMd = "signal-map-agent-quality-report.md";
const signalsDeadlineBudgetMs = 25_000;
const minimumRetrievalBudgetMs = 4_000;
const captureDir = process.env.SIGNAL_MAP_CAPTURE_DIR || join("captures", runId);
const scenarioConfigPath = process.env.SIGNAL_MAP_SCENARIO_CONFIG || null;

const statuses = {
  pass: "PASS",
  partial: "PARTIAL",
  fail: "FAIL",
  blocked: "BLOCKED",
  notRun: "NOT_RUN",
};

const phaseReports = {
  runtimeDb: section("Runtime / DB"),
  authTenant: section("Auth / Tenant"),
  persistence: section("Persistence"),
  realResearch: section("Real Research"),
  statefulSecondRun: section("Stateful Second Run"),
  tenQuery: section("Real Provider 10-Query"),
};

let qualityReport = null;

const serverLogs = [];
const created = {
  runId,
  filterIds: new Set(),
  userIds: new Set(),
};

let serverProcess = null;
let serverInstance = null;
let dbClient = null;
let acceptanceSessions = [];
let statefulSecondRunForQuality = null;

function section(name) {
  return {
    name,
    status: statuses.notRun,
    requestId: null,
    httpStatus: null,
    lastPhase: null,
    evidence: [],
    failureReason: null,
  };
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-database-url]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(password|token|token_hash|apikey|api_key|authorization|cookie)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 500);
}

function record(sectionReport, values) {
  Object.assign(sectionReport, values);
}

function addEvidence(sectionReport, value) {
  sectionReport.evidence.push(sanitize(value));
}

function fail(sectionReport, reason, values = {}) {
  record(sectionReport, { status: statuses.fail, failureReason: sanitize(reason), ...values });
}

function partial(sectionReport, reason, values = {}) {
  record(sectionReport, { status: statuses.partial, failureReason: sanitize(reason), ...values });
}

function pass(sectionReport, values = {}) {
  record(sectionReport, { status: statuses.pass, failureReason: null, ...values });
}

function blockAll(reason) {
  for (const report of Object.values(phaseReports)) {
    if (report.status === statuses.notRun) {
      record(report, { status: statuses.blocked, failureReason: sanitize(reason) });
    }
  }
}

function envPresent(name) {
  return Boolean(process.env[name]?.trim());
}

function requiredEnvironment() {
  return [
    "DATABASE_URL",
    "POSTGRES_SSL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "TEST_SUPABASE_PROJECT_REF",
    "TEST_DATABASE_SAFETY_ACK",
    "TEST_ACCOUNT_A_EMAIL",
    "TEST_ACCOUNT_A_PASSWORD",
    "TEST_ACCOUNT_B_EMAIL",
    "TEST_ACCOUNT_B_PASSWORD",
  ];
}

function projectRefFromSupabaseUrl(value) {
  try {
    const host = new URL(value).hostname;
    return host.endsWith(".supabase.co") ? host.split(".")[0] : null;
  } catch {
    return null;
  }
}

function projectRefFromDatabaseUrl(value) {
  try {
    const url = new URL(value);
    const username = decodeURIComponent(url.username || "");
    const usernameRef = username.match(/^postgres[._-]([a-z0-9]+)$/i)?.[1] || null;
    const directRef = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1] || null;
    return {
      hostType: url.hostname.includes("pooler.supabase.com")
        ? "supabase-pooler"
        : url.hostname.endsWith(".supabase.co")
          ? "supabase-direct"
          : "other",
      port: url.port || null,
      database: url.pathname.replace(/^\//, "") || null,
      usernameFormat: usernameRef ? "postgres.project-ref" : username ? "other" : "missing",
      projectRef: usernameRef || directRef,
    };
  } catch {
    return null;
  }
}

async function phase0SafetyCheck() {
  const missing = requiredEnvironment().filter((name) => !envPresent(name));
  addEvidence(phaseReports.runtimeDb, `Environment presence: ${requiredEnvironment().map((name) => `${name}=${envPresent(name)}`).join(", ")}`);
  if (missing.length) {
    blockAll(`Missing required GitHub Secrets: ${missing.join(", ")}`);
    return false;
  }
  if (process.env.POSTGRES_SSL !== "true") {
    blockAll("POSTGRES_SSL must be true for this validation");
    return false;
  }
  if (process.env.TEST_DATABASE_SAFETY_ACK !== "independent-test-database") {
    blockAll("TEST_DATABASE_SAFETY_ACK must equal independent-test-database");
    return false;
  }
  const expectedRef = process.env.TEST_SUPABASE_PROJECT_REF.trim();
  const authRef = projectRefFromSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const dbShape = projectRefFromDatabaseUrl(process.env.DATABASE_URL);
  addEvidence(phaseReports.runtimeDb, `Supabase auth project ref matches expected: ${authRef === expectedRef}`);
  addEvidence(phaseReports.runtimeDb, `Database shape: ${JSON.stringify({
    hostType: dbShape?.hostType,
    port: dbShape?.port,
    database: dbShape?.database,
    usernameFormat: dbShape?.usernameFormat,
    projectRefMatchesExpected: dbShape?.projectRef === expectedRef,
  })}`);
  if (!authRef || authRef !== expectedRef) {
    blockAll("TEST_SUPABASE_PROJECT_REF does not match TEST_SUPABASE_URL");
    return false;
  }
  if (!dbShape || dbShape.projectRef !== expectedRef) {
    blockAll("TEST_SUPABASE_PROJECT_REF does not match TEST_DATABASE_URL structure");
    return false;
  }
  return true;
}

async function connectDb() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  dbClient = client;
  return client;
}

async function query(sql, values = []) {
  if (!dbClient) throw new Error("DB client is not connected");
  return dbClient.query(sql, values);
}

// Apply the repository's idempotent migrations to the connected test database.
// Called ONLY after phase0SafetyCheck has validated the database identity and
// safety configuration, so a misconfigured target receives zero writes.
async function applyMigrations() {
  const migrationsDir = join(process.cwd(), "migrations");
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    await query(await readFile(join(migrationsDir, file), "utf8"));
  }
  return files;
}

async function verifySchemaReady() {
  const expectedTables = [
    "filters",
    "personal_knowledge",
    "research_context_revisions",
    "research_run_metadata",
    "goals",
    "notifications",
    "user_preferences",
  ];
  const result = await query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [expectedTables],
  );
  const found = new Set(result.rows.map((row) => row.table_name));
  const missing = expectedTables.filter((table) => !found.has(table));
  if (missing.length) throw new Error(`Prepared test schema missing tables: ${missing.join(", ")}`);
  addEvidence(phaseReports.runtimeDb, `Prepared schema tables found: ${expectedTables.length - missing.length}/${expectedTables.length}`);
}

async function waitForHealth(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { cache: "no-store" });
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = sanitize(error instanceof Error ? error.message : error);
    }
    await delay(250);
  }
  throw new Error(`Server health did not pass: ${lastError}`);
}

function startServer(envOverrides = {}) {
  if (serverProcess) throw new Error("Server already running");
  serverLogs.length = 0;
  const instanceId = randomUUID();
  serverProcess = spawn(process.execPath, ["dist-api/server.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      SIGNAL_MAP_ALLOWED_ORIGIN: origin,
      SIGNAL_MAP_SERVER_INSTANCE_ID: instanceId,
      ...envOverrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverInstance = { instanceId, pid: serverProcess.pid };
  serverProcess.stdout.setEncoding("utf8");
  serverProcess.stderr.setEncoding("utf8");
  const capture = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      serverLogs.push(line);
      console.log(sanitize(line));
    }
  };
  serverProcess.stdout.on("data", capture);
  serverProcess.stderr.on("data", capture);
  serverProcess.on("exit", (code, signal) => {
    serverLogs.push(`server_exit code=${code ?? "null"} signal=${signal ?? "null"}`);
  });
  return { instanceId, pid: serverProcess.pid };
}

// A child counts as alive only while it is actually running: no recorded exit
// code, no terminating signal, and a real pid (a failed spawn has no pid).
function isProcessAlive(child) {
  if (!child || typeof child !== "object") return false;
  if (typeof child.pid !== "number") return false;
  if (child.exitCode !== null && child.exitCode !== undefined) return false;
  if (child.signalCode !== null && child.signalCode !== undefined) return false;
  return true;
}

// The served process must confirm its own identity through its health
// response. A 200 from any listener is not proof: the reported instance id
// must equal the instance this harness started. Identity is diagnostics-only.
async function confirmServerIdentity({ baseUrl: base = baseUrl, expectedInstanceId, fetchImpl = globalThis.fetch } = {}) {
  try {
    const response = await fetchImpl(`${base}/health`, { cache: "no-store" });
    if (!response.ok) return { confirmed: false, reason: `health-http-${response.status}` };
    const data = await response.json().catch(() => null);
    const instanceId = data?.instanceId ?? null;
    if (!instanceId) return { confirmed: false, reason: "health-response-missing-instance-id", instanceId };
    if (instanceId !== expectedInstanceId) return { confirmed: false, reason: "health-response-instance-mismatch", instanceId };
    return { confirmed: true, instanceId };
  } catch (error) {
    return { confirmed: false, reason: "health-check-unreachable", error: sanitize(error instanceof Error ? error.message : error) };
  }
}

// Stop a child-like process and only report stopped:true when the exit event
// was actually observed. SIGTERM escalates to SIGKILL, but even after SIGKILL
// the caller waits for the exit confirmation instead of assuming it.
function stopProcessLike(child, { termTimeoutMs = 3_000, killTimeoutMs = 2_000 } = {}) {
  return new Promise((resolve) => {
    if (!child) {
      resolve({ stopped: false, reason: "not-running", exitCode: null, signal: null });
      return;
    }
    if (child.exitCode !== null && child.exitCode !== undefined) {
      resolve({ stopped: true, alreadyExited: true, exitCode: child.exitCode, signal: null });
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    child.once("exit", (code, signal) => finish({ stopped: true, exitCode: code, signal: signal || null }));
    child.kill("SIGTERM");
    delay(termTimeoutMs).then(() => {
      if (settled) return;
      child.kill("SIGKILL");
      delay(killTimeoutMs).then(() => {
        if (!settled) finish({ stopped: false, reason: "exit-unconfirmed", exitCode: child.exitCode ?? null, signal: null });
      });
    });
  });
}

async function stopServer() {
  if (!serverProcess) return { stopped: false, reason: "not-running", exitCode: null, signal: null };
  const child = serverProcess;
  const result = await stopProcessLike(child);
  serverProcess = null;
  serverInstance = null;
  return result;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class HttpSession {
  constructor(label) {
    this.label = label;
    this.cookies = new Map();
    this.user = null;
  }

  cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  storeCookies(response) {
    const values = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : splitSetCookie(response.headers.get("set-cookie"));
    for (const value of values) {
      const first = value.split(";")[0];
      const index = first.indexOf("=");
      if (index <= 0) continue;
      const name = first.slice(0, index);
      const cookieValue = first.slice(index + 1);
      if (/Max-Age=0/i.test(value)) this.cookies.delete(name);
      else this.cookies.set(name, cookieValue);
    }
  }

  async request(path, { method = "GET", body, requestId } = {}) {
    const headers = new Headers();
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (method !== "GET") headers.set("Origin", origin);
    if (requestId) headers.set("X-Signal-Map-Request-Id", requestId);
    const cookie = this.cookieHeader();
    if (cookie) headers.set("Cookie", cookie);
    const started = Date.now();
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    this.storeCookies(response);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: sanitize(text) };
    }
    return {
      path,
      status: response.status,
      durationMs: Date.now() - started,
      requestId: response.headers.get("X-Signal-Map-Request-Id") || requestId || null,
      data,
    };
  }
}

function splitSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=]+=[^;,]+)/);
}

async function login(session, email, password) {
  const response = await session.request("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (response.status !== 200 || !response.data?.user?.id) {
    throw new Error(`${session.label} login failed: HTTP ${response.status} ${sanitize(JSON.stringify(response.data))}`);
  }
  session.user = response.data.user;
  addEvidence(phaseReports.authTenant, `${session.label} login HTTP 200 user=${session.user.id}`);
  const me = await session.request("/api/auth/me");
  if (me.status !== 200 || me.data?.user?.id !== session.user.id) {
    throw new Error(`${session.label} /api/auth/me mismatch: HTTP ${me.status}`);
  }
  addEvidence(phaseReports.authTenant, `${session.label} /api/auth/me returned same authenticated user`);
  return session.user;
}

async function readControl(session, path, report) {
  const response = await session.request(path);
  addEvidence(report, `${session.label} GET ${path} HTTP ${response.status}`);
  if (response.status !== 200) {
    throw new Error(`${session.label} ${path} failed with HTTP ${response.status}: ${sanitize(JSON.stringify(response.data))}`);
  }
  return response;
}

async function createFollow(session, filterId, topic) {
  created.filterIds.add(filterId);
  const response = await session.request(`/api/control/follows?filterId=${encodeURIComponent(filterId)}`, {
    method: "POST",
    body: {
      topic,
      intensity: "worth_knowing",
      delivery: "important",
    },
  });
  if (response.status !== 200 || !response.data?.follow?.id) {
    throw new Error(`create follow failed: HTTP ${response.status} ${sanitize(JSON.stringify(response.data))}`);
  }
  return response;
}

async function seedKnowledge(userId, filterId) {
  const now = new Date().toISOString();
  created.userIds.add(userId);
  created.filterIds.add(filterId);
  await query(
    `INSERT INTO filters (id, user_id, name, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at
     WHERE filters.user_id = EXCLUDED.user_id`,
    [filterId, userId, `Agent loop e2e ${runId}`, now],
  );
  await query(
    `INSERT INTO personal_knowledge (
      id, user_id, filter_id, type, text, structured_payload, normalized_text, stable_id, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
    ON CONFLICT (user_id, filter_id, stable_id) DO UPDATE SET
      text = EXCLUDED.text,
      structured_payload = EXCLUDED.structured_payload,
      normalized_text = EXCLUDED.normalized_text,
      updated_at = EXCLUDED.updated_at`,
    [
      `pk-${runId}`,
      userId,
      filterId,
      "KNOWN_INFORMATION",
      `Signal Map e2e seed knowledge ${runId}: AI video tool baseline already known.`,
      JSON.stringify({ runId, source: "agent-loop-e2e-seed" }),
      `signal map e2e seed knowledge ${runId}: ai video tool baseline already known.`,
      `e2e-seed:${runId}`,
      now,
    ],
  );
  await query(
    `INSERT INTO research_context_revisions (user_id, filter_id, research_context_revision, updated_at)
     VALUES ($1,$2,2,$3)
     ON CONFLICT (user_id, filter_id) DO UPDATE SET
       research_context_revision = GREATEST(research_context_revisions.research_context_revision, 2),
       updated_at = EXCLUDED.updated_at`,
    [userId, filterId, now],
  );
}

async function seedFilter(userId, filterId, name) {
  const now = new Date().toISOString();
  created.userIds.add(userId);
  created.filterIds.add(filterId);
  await query(
    `INSERT INTO filters (id, user_id, name, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at
     WHERE filters.user_id = EXCLUDED.user_id`,
    [filterId, userId, name, now],
  );
}

function tracesForRequest(requestId) {
  return serverLogs
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry?.event === "signals_phase_trace" && entry.requestId === requestId);
}

function lastPhaseFor(requestId) {
  const phases = tracesForRequest(requestId);
  return phases.at(-1)?.phase || null;
}

function phaseNamesFor(requestId) {
  return tracesForRequest(requestId).map((entry) => entry.phase);
}

function phaseTraceFor(requestId) {
  return tracesForRequest(requestId).map((entry) => ({
    phase: unavailable(entry.phase),
    round: typeof entry.round === "number" ? entry.round : undefined,
    attemptId: typeof entry.attemptId === "string" ? entry.attemptId : undefined,
    attemptType: typeof entry.attemptType === "string" ? entry.attemptType : undefined,
    startedAt: unavailable(entry.startedAt),
    finishedAt: unavailable(entry.finishedAt),
    success: entry.success !== false,
    itemCount: unavailable(entry.itemCount),
    errorCode: unavailable(entry.errorCode),
    durationMs: unavailable(entry.durationMs),
    diagnostic: unavailable(entry.diagnostic),
  }));
}

function attemptTraceGroups(phaseTrace) {
  const groups = new Map();
  let currentKey = "round-1-primary";
  let searchCount = 0;
  for (const entry of phaseTrace) {
    if (entry.attemptId) currentKey = entry.attemptId;
    if (entry.phase === "plan_finished" && entry.diagnostic?.fallback === true) {
      currentKey = `round-${entry.round || 1}-fallback`;
    }
    if (entry.phase === "search_started" && !entry.attemptId) {
      searchCount += 1;
      currentKey = `round-${entry.round || 1}-${searchCount === 1 ? "primary" : "fallback"}`;
    }
    const group = groups.get(currentKey) || [];
    group.push(entry);
    groups.set(currentKey, group);
  }
  return [...groups.entries()].map(([attemptId, entries]) => ({ attemptId, entries }));
}

function attemptDiagnostics(phaseTrace) {
  return attemptTraceGroups(phaseTrace)
    .filter(({ entries }) => entries.some((entry) => [
      "search_started",
      "search_finished",
      "evidence_preservation_finished",
    ].includes(entry.phase)))
    .map(({ attemptId, entries }) => {
      const first = entries[0] || {};
      const sourceSelection = [...entries].reverse().find((entry) => entry.phase === "source_selection_finished")?.diagnostic;
      const plan = [...entries].reverse().find((entry) => entry.phase === "plan_finished")?.diagnostic;
      const searchStarted = entries.find((entry) => entry.phase === "search_started");
      const searchFinished = [...entries].reverse().find((entry) => entry.phase === "search_finished");
      const detailFinished = [...entries].reverse().find((entry) => entry.phase === "detail_fetch_finished");
      const aggregationFinished = [...entries].reverse().find((entry) => entry.phase === "aggregation_finished");
      const evidenceFinished = [...entries].reverse().find((entry) => entry.phase === "evidence_finished");
      const preservation = [...entries].reverse().find((entry) => entry.phase === "evidence_preservation_finished");
      return {
        round: first.round || sourceSelection?.round || plan?.round || 1,
        attemptId,
        attemptType: first.attemptType || (plan?.fallback ? "fallback" : "primary"),
        sourceSelection: searchStarted?.diagnostic || sourceSelection || "unavailable",
        plan: plan || "unavailable",
        searchStarted: searchStarted?.diagnostic || "unavailable",
        queries: {
          agentGeneratedQueries: searchStarted?.diagnostic?.agentGeneratedQueries || plan?.agentGeneratedQueries || "unavailable",
          pipelineActualQueries: searchStarted?.diagnostic?.pipelineActualQueries || "unavailable",
        },
        search: {
          returnedCount: searchFinished?.itemCount ?? "unavailable",
          providerOutcomes: searchFinished?.diagnostic?.providerOutcomes || "unavailable",
          providerResponseCount: searchFinished?.diagnostic?.providerResponseCount ?? "unavailable",
          providerErrorCodes: searchFinished?.diagnostic?.providerErrorCodes || "unavailable",
          durationMs: searchFinished?.durationMs ?? "unavailable",
        },
        detailFetch: {
          attemptedCount: detailFinished?.diagnostic?.detailAttempted ?? "unavailable",
          successCount: detailFinished?.diagnostic?.detailSucceeded ?? detailFinished?.itemCount ?? "unavailable",
          failedCount: detailFinished?.diagnostic?.detailFailed ?? "unavailable",
          durationMs: detailFinished?.durationMs ?? "unavailable",
        },
        aggregation: {
          inputCount: aggregationFinished?.diagnostic?.inputCount ?? "unavailable",
          clusteredCount: aggregationFinished?.itemCount ?? "unavailable",
          deduplicatedCount: aggregationFinished?.diagnostic?.deduplicatedCount ?? "unavailable",
          durationMs: aggregationFinished?.durationMs ?? "unavailable",
        },
        evidence: {
          phaseItemCount: evidenceFinished?.itemCount ?? "unavailable",
          preservation: preservation?.diagnostic || "unavailable",
        },
      };
    });
}

function lastSuccessfulPhaseFromTrace(phaseTrace) {
  return [...phaseTrace].reverse().find((entry) => entry.success)?.phase || "unavailable";
}

function timestampMs(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tracePhase(phaseTrace, phase) {
  return phaseTrace.find((entry) => entry.phase === phase);
}

function durationBetween(startValue, endValue) {
  const start = timestampMs(startValue);
  const end = timestampMs(endValue);
  if (start === null || end === null || end < start) return "unavailable";
  return end - start;
}

function remainingDeadlineFrom(requestEntry, targetEntry) {
  const start = timestampMs(requestEntry?.startedAt) ?? timestampMs(requestEntry?.finishedAt);
  const target = timestampMs(targetEntry?.startedAt) ?? timestampMs(targetEntry?.finishedAt);
  if (start === null || target === null || target < start) return "unavailable";
  return Math.max(0, signalsDeadlineBudgetMs - (target - start));
}

function planningTimingDiagnostics(phaseTrace) {
  const requestReceived = tracePhase(phaseTrace, "request_received");
  const sourceSelectionStarted = tracePhase(phaseTrace, "source_selection_started");
  const sourceSelectionFinished = tracePhase(phaseTrace, "source_selection_finished");
  const searchStarted = tracePhase(phaseTrace, "search_started");
  const agentFinished = [...phaseTrace].reverse().find((entry) => entry.phase === "agent_finished");
  const preRetrievalEnd = searchStarted || agentFinished;
  const preRetrievalWindowMs = sourceSelectionFinished && preRetrievalEnd
    ? durationBetween(sourceSelectionFinished.finishedAt, preRetrievalEnd.startedAt)
    : "unavailable";
  return {
    modelRequestTimeoutMs: qualityModelRequestTimeoutMs || unavailable(process.env.MODEL_REQUEST_TIMEOUT_MS) || "8000(default)",
    signalsDeadlineBudgetMs,
    minimumRetrievalBudgetMs,
    createResearchPlan: {
      startedAt: "unavailable",
      finishedAt: "unavailable",
      durationMs: "unavailable",
    },
    applyModelPlanning: {
      startedAt: "unavailable",
      finishedAt: "unavailable",
      durationMs: "unavailable",
    },
    modelPlanningTimedOut: "unavailable",
    fallbackToDeterministicPlan: "unavailable",
    sourceSelectionDurationMs: unavailable(sourceSelectionFinished?.durationMs),
    postSourceSelectionPreRetrievalWindowMs: unavailable(preRetrievalWindowMs),
    remainingDeadlineMsBeforeRunResearchPipeline: remainingDeadlineFrom(requestReceived, preRetrievalEnd),
    retrievalStarted: Boolean(searchStarted),
    deadlineErrorCode: unavailable(agentFinished?.errorCode),
    observabilityNote: "Function-level createResearchPlan/applyModelPlanning timings are unavailable without AgentRunner instrumentation; this harness reports the observable window between source selection and retrieval/deadline.",
    sourceSelectionStartedAt: unavailable(sourceSelectionStarted?.startedAt),
    sourceSelectionFinishedAt: unavailable(sourceSelectionFinished?.finishedAt),
    preRetrievalEndedAt: unavailable(preRetrievalEnd?.startedAt || preRetrievalEnd?.finishedAt),
  };
}

function summarizeSignalResponse(response) {
  const data = response.data || {};
  const signals = Array.isArray(data.signals) ? data.signals : [];
  return {
    requestId: response.requestId || data.requestId || null,
    status: response.status,
    durationMs: response.durationMs,
    signalCount: signals.length,
    dataMode: data.dataMode || null,
    claimCount: signals.reduce((count, signal) => count + (Array.isArray(signal.claims) ? signal.claims.length : 0), 0),
    evidenceCount: evidenceItems(signals).length,
    errorCode: data.errorCode || null,
    error: data.error || null,
  };
}

function unavailable(value) {
  if (value === undefined || value === null) return "unavailable";
  if (Array.isArray(value) && value.length === 0) return "unavailable";
  if (typeof value === "string" && !value.trim()) return "unavailable";
  return value;
}

function compact(value, maxLength = 1200) {
  if (value === undefined || value === null) return "unavailable";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return sanitize(text).slice(0, maxLength);
}

function domainFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "unavailable";
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function keptSource(signal) {
  const topicRelevance = signal?.topicRelevance;
  return {
    title: unavailable(signal?.title),
    url: unavailable(signal?.sourceUrl),
    domain: signal?.sourceUrl ? domainFromUrl(signal.sourceUrl) : "unavailable",
    sourceType: unavailable(signal?.sourceType),
    sourceTier: unavailable(signal?.sourceTier),
    publisher: unavailable(signal?.publisher),
    publishedAt: unavailable(signal?.publishedAt || signal?.eventOccurredAt),
    freshness: unavailable(signal?.time || signal?.freshnessScore),
    whyKept: unavailable(signal?.why || signal?.whyItMatters),
    reliability: unavailable(signal?.reliabilityScore ?? signal?.truth),
    verificationStatus: unavailable(signal?.verificationStatus),
    topicRelevanceStatus: unavailable(topicRelevance?.decision),
    topicRelevanceReason: unavailable(topicRelevance?.reason),
    matchedDomainAnchors: unavailable(topicRelevance?.matchedDomainAnchors),
    matchedTaskAnchors: unavailable(topicRelevance?.matchedTaskAnchors),
    matchedGenericTerms: unavailable(topicRelevance?.matchedGenericTerms),
    matchedQueryTerms: unavailable(topicRelevance?.matchedQueryTerms),
    relevanceGateApplied: unavailable(topicRelevance?.relevanceGateApplied),
    relevanceGatePassed: unavailable(topicRelevance?.relevanceGatePassed),
    evidence: Array.isArray(signal?.claims)
      ? signal.claims.slice(0, 3).map((claim) => ({
          claim: unavailable(claim.claimText),
          verificationStatus: unavailable(claim.verificationStatus),
          sourceTier: unavailable(claim.sourceTier),
          independentEvidenceCount: unavailable(claim.independentEvidenceCount),
          snippet: unavailable(claim.evidenceSnippet),
        }))
      : "unavailable",
  };
}

function evidenceItems(signals) {
  return signals.flatMap((signal) => Array.isArray(signal.claims)
    ? signal.claims.flatMap((claim) => {
        const sources = Array.isArray(claim.evidenceSources) ? claim.evidenceSources : [];
        if (!sources.length) {
          return [{
            signal: signal.title,
            claim: claim.claimText,
            source: claim.sourceUrl,
            publisher: claim.publisher,
            snippet: claim.evidenceSnippet,
            verificationStatus: claim.verificationStatus,
            topicRelevance: signal.topicRelevance,
          }];
        }
        return sources.slice(0, 3).map((source) => ({
          signal: signal.title,
          claim: claim.claimText,
          source: source.sourceUrl,
          publisher: source.publisher,
          snippet: source.evidenceSnippet,
          verificationStatus: source.verificationStatus,
          topicRelevance: signal.topicRelevance,
        }));
      })
    : []);
}

function latestRunForQuality(agentRuns) {
  return Array.isArray(agentRuns) && agentRuns.length ? agentRuns[0] : null;
}

function sumDiagnostics(sourceDiagnostics, field) {
  return Array.isArray(sourceDiagnostics)
    ? sourceDiagnostics.reduce((total, item) => total + (Number.isFinite(item?.[field]) ? item[field] : 0), 0)
    : undefined;
}

function searchDiagnostics(data, phaseTrace) {
  const queryPlan = data.queryPlan || {};
  const queries = unique([
    ...(Array.isArray(queryPlan.searchCombinations) ? queryPlan.searchCombinations : []),
    ...(Array.isArray(queryPlan.knowledgeAwareQueries) ? queryPlan.knowledgeAwareQueries : []),
  ]);
  const attempts = attemptDiagnostics(phaseTrace);
  const primaryAttempt = attempts.find((attempt) => attempt.attemptType === "primary") || attempts[0];
  const finalAttempt = attempts.at(-1);
  const sourceSelections = phaseTrace
    .filter((entry) => entry.phase === "source_selection_finished")
    .map((entry) => entry.diagnostic || {});
  const providerPlans = attempts.map((attempt) => attempt.searchStarted?.providerPlan).filter(Boolean);
  const providerOutcomes = attempts.map((attempt) => ({
    attemptId: attempt.attemptId,
    round: attempt.round,
    attemptType: attempt.attemptType,
    outcomes: attempt.search.providerOutcomes,
  }));
  const providerCallAttempted = attempts.map((attempt) => ({
    attemptId: attempt.attemptId,
    round: attempt.round,
    attemptType: attempt.attemptType,
    providers: attempt.searchStarted?.providerPlan || "unavailable",
  }));
  const providerReturnedCount = providerOutcomes;
  const finalProviderErrors = finalAttempt?.search.providerErrorCodes;
  const finalProviderFailed = Array.isArray(finalProviderErrors)
    ? finalProviderErrors.length > 0
    : finalProviderErrors !== "unavailable";
  const topicProfileAttempt = attempts
    .map((attempt) => attempt.searchStarted?.topicProfile)
    .find((profile) => profile && typeof profile === "object");
  const topicProfile = topicProfileAttempt || queryPlan.topicProfile || "unavailable";
  return {
    attempts,
    perRoundSearch: attempts.length
      ? attempts.map((attempt) => ({
          round: attempt.round,
          attemptId: attempt.attemptId,
          attemptType: attempt.attemptType,
          queries: attempt.queries.pipelineActualQueries,
          returnedCount: attempt.search.returnedCount,
        }))
      : [{
          round: "unavailable",
          queries: queries.length ? queries.map((query) => ({ query, returnedCount: "unavailable" })) : "unavailable",
          returnedCount: "unavailable",
        }],
    agentGeneratedQueries: primaryAttempt?.queries.agentGeneratedQueries || "unavailable",
    agentPlanSelectedSourceType: primaryAttempt?.plan?.selectedSourceType || "unavailable",
    pipelineActualQueries: primaryAttempt?.queries.pipelineActualQueries || "unavailable",
    fallbackUsed: attempts.length
      ? attempts.some((attempt) => attempt.attemptType === "fallback" || attempt.plan?.fallback === true)
      : "unavailable",
    retrievalPlanSource: primaryAttempt?.searchStarted?.retrievalPlanSource || "unavailable",
    fallbackReason: finalAttempt?.searchStarted?.fallbackReason || "unavailable",
    resolvedEntities: primaryAttempt?.searchStarted?.resolvedEntities ?? queryPlan.resolvedEntities ?? queryPlan.entities ?? "unavailable",
    selectedSourceTypes: sourceSelections.map((entry) => entry.selectedSourceType).filter(Boolean).length
      ? sourceSelections.map((entry) => entry.selectedSourceType).filter(Boolean)
      : "unavailable",
    discoveryMode: sourceSelections.find((entry) => entry.discoveryMode !== undefined)?.discoveryMode ?? "unavailable",
    verificationSourceTypes: sourceSelections.find((entry) => entry.verificationSourceTypes !== undefined)?.verificationSourceTypes ?? "unavailable",
    sourceSelectionReason: sourceSelections[0]?.sourceSelectionReason || sourceSelections[0]?.reason || "unavailable",
    topicProfile,
    topicProfileSource: topicProfileAttempt
      ? (primaryAttempt?.searchStarted?.topicProfileSource || "pipeline_trace")
      : (queryPlan.topicProfile ? "research_response" : "unavailable"),
    topicProfileApplied: topicProfileAttempt
      ? primaryAttempt?.searchStarted?.topicProfileApplied === true
      : Boolean(queryPlan.topicProfile),
    searchProvider: attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      round: attempt.round,
      attemptType: attempt.attemptType,
      providers: attempt.search.providerOutcomes,
    })),
    providerCallAttempted,
    providerReturnedCount,
    allowedProviderIds: primaryAttempt?.plan?.allowedProviderIds || "unavailable",
    generatedSearchQueryCount: Array.isArray(primaryAttempt?.queries.pipelineActualQueries)
      ? primaryAttempt.queries.pipelineActualQueries.length
      : "unavailable",
    generatedSearchQueries: primaryAttempt?.queries.pipelineActualQueries || "unavailable",
    providerPlan: providerPlans.length ? providerPlans : "unavailable",
    providerOutcomes,
    providerResponseCount: finalAttempt?.search.providerResponseCount ?? "unavailable",
    providerErrorCodes: finalAttempt?.search.providerErrorCodes ?? "unavailable",
    emptyResultReason: finalAttempt?.search.providerResponseCount === 0
      ? (finalProviderFailed ? "all_results_empty_with_provider_failure" : "all_results_empty")
      : "unavailable",
    providerReturnedCounts: attempts.length
      ? attempts.map((attempt) => ({
          attemptId: attempt.attemptId,
          round: attempt.round,
          attemptType: attempt.attemptType,
          providers: attempt.search.providerOutcomes,
        }))
      : "unavailable",
    sourceDiagnostics: Array.isArray(data.sourceDiagnostics)
      ? data.sourceDiagnostics.map((item) => ({
          providerId: unavailable(item.providerId),
          rawProviderResultCount: unavailable(item.rawProviderResultCount),
          normalizedCandidateCount: unavailable(item.normalizedCandidateCount),
          rejectedRawCount: unavailable(item.rejectedRawCount),
          normalizationRejectionReasons: unavailable(item.normalizationRejectionReasons),
          normalizationRejectedSamples: unavailable(item.normalizationRejectedSamples),
          candidateAdmissionRejectionReasons: unavailable(item.candidateAdmissionRejectionReasons),
          candidateAdmissionRejectedSamples: unavailable(item.candidateAdmissionRejectedSamples),
          admittedCandidateCount: unavailable(item.admittedCandidateCount),
          pipelineRetrievedCount: unavailable(item.pipelineRetrievedCount),
          displayedCount: unavailable(item.displayedCount),
        }))
      : "unavailable",
    sourceOutcomes: unavailable(data.sourceOutcomes),
  };
}

function detailFetchDiagnostics(data, attempts = []) {
  const detail = data.filteringSummary?.detailEnrichment || {};
  const attemptValue = (field) => {
    const values = attempts.map((attempt) => Number(attempt.detailFetch[field])).filter(Number.isFinite);
    return values.length ? values.reduce((total, value) => total + value, 0) : undefined;
  };
  return {
    attemptedCount: unavailable(attemptValue("attemptedCount") ?? detail.detailAttempted ?? sumDiagnostics(data.sourceDiagnostics, "detailAttempted")),
    successCount: unavailable(attemptValue("successCount") ?? detail.detailSucceeded ?? sumDiagnostics(data.sourceDiagnostics, "detailSucceeded")),
    failedCount: unavailable(attemptValue("failedCount") ?? detail.detailFailed ?? sumDiagnostics(data.sourceDiagnostics, "detailFailed")),
    stillInsufficient: unavailable(detail.stillInsufficient),
    byAttempt: attempts.length
      ? attempts.map((attempt) => ({
          attemptId: attempt.attemptId,
          round: attempt.round,
          attemptType: attempt.attemptType,
          attemptedCount: attempt.detailFetch.attemptedCount,
          successCount: attempt.detailFetch.successCount,
          failedCount: attempt.detailFetch.failedCount,
          durationMs: attempt.detailFetch.durationMs,
      }))
      : "unavailable",
    byProvider: Array.isArray(data.sourceDiagnostics)
      ? data.sourceDiagnostics.map((item) => ({
          providerId: unavailable(item.providerId),
          enrichmentEligibleCount: unavailable(item.enrichmentEligibleCount),
          detailAttempted: unavailable(item.detailAttempted),
          detailSucceeded: unavailable(item.detailSucceeded),
          detailFailed: unavailable(item.detailFailed),
        }))
      : "unavailable",
  };
}

function aggregationDiagnostics(data, summary, attempts = []) {
  const attemptValue = (field) => {
    const values = attempts.map((attempt) => Number(attempt.aggregation[field])).filter(Number.isFinite);
    return values.length ? values.reduce((total, value) => total + value, 0) : undefined;
  };
  return {
    inputCount: unavailable(attemptValue("inputCount") ?? summary.retrievedCount ?? data.overview?.scanned ?? data.counts?.candidates),
    clusteredCount: unavailable(attemptValue("clusteredCount") ?? summary.clusteredCount ?? data.overview?.events),
    deduplicatedCount: unavailable(attemptValue("deduplicatedCount") ?? data.overview?.deduplicated),
    byAttempt: attempts.length
      ? attempts.map((attempt) => ({
          attemptId: attempt.attemptId,
          round: attempt.round,
          attemptType: attempt.attemptType,
          inputCount: attempt.aggregation.inputCount,
          clusteredCount: attempt.aggregation.clusteredCount,
          deduplicatedCount: attempt.aggregation.deduplicatedCount,
          durationMs: attempt.aggregation.durationMs,
        }))
      : "unavailable",
  };
}

function summedAttemptCount(attempts, selector) {
  const values = attempts.map(selector).map(Number).filter(Number.isFinite);
  return values.length ? values.reduce((total, value) => total + value, 0) : undefined;
}

function producedEvidenceCountFromResponseData(data) {
  return Array.isArray(data?.evidenceRecords) ? data.evidenceRecords.length : "unavailable";
}

function actionabilityDiagnostics(signals) {
  return signals.map((signal) => ({
    title: unavailable(signal?.title),
    action: unavailable(signal?.action),
    actionabilityStatus: unavailable(signal?.actionabilityStatus),
    informationGainStatus: unavailable(signal?.informationGainStatus),
    hasExecutableAction: unavailable(signal?.hasExecutableAction),
    executionEntry: unavailable(signal?.executionEntry),
  }));
}

const MAPPED_REJECTION_REASON_KEYS = new Set([
  "stale",
  "duplicate",
  "lowReliability",
  "insufficientVerification",
  "background",
  "lowNovelty",
  "unresolvedConflict",
  "lowActionability",
  "noInformationGain",
  "insufficientContent",
]);

function numericCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : undefined;
}

function rejectionAccounting(rejectedEvidenceCount, reasonSources = []) {
  const mappedReasons = {};
  let unclassifiedReasonOccurrences = 0;
  for (const source of reasonSources) {
    if (!source || typeof source !== "object") continue;
    for (const [reason, value] of Object.entries(source)) {
      const count = numericCount(value);
      if (count === undefined || count === 0) continue;
      if (MAPPED_REJECTION_REASON_KEYS.has(reason)) {
        mappedReasons[reason] = (mappedReasons[reason] || 0) + count;
      } else {
        unclassifiedReasonOccurrences += count;
      }
    }
  }
  const mappedCount = Object.values(mappedReasons).reduce((sum, value) => sum + value, 0);
  const rejected = numericCount(rejectedEvidenceCount);
  const evidenceWithMappedPrimaryReasonCount = rejected === undefined
    ? undefined
    : Math.min(rejected, mappedCount);
  const unclassifiedRejectedEvidenceCount = rejected === undefined
    ? undefined
    : Math.max(0, rejected - mappedCount);
  return {
    primaryRejectionReasonCounts: mappedReasons,
    rejectionReasonOccurrences: unavailable(mappedCount),
    evidenceWithMappedPrimaryReasonCount: unavailable(evidenceWithMappedPrimaryReasonCount),
    unclassifiedRejectedEvidenceCount: unavailable(unclassifiedRejectedEvidenceCount),
    rejectionAccountingComplete: rejected !== undefined
      && mappedCount === rejected
      && unclassifiedReasonOccurrences === 0,
  };
}

function runCumulativeDiagnostics(attempts, evidence) {
  return {
    retrievedCount: unavailable(summedAttemptCount(attempts, (attempt) => attempt.search.returnedCount)),
    evaluatedCount: unavailable(summedAttemptCount(attempts, (attempt) => attempt.evidence.phaseItemCount)),
    clusteredCount: unavailable(summedAttemptCount(attempts, (attempt) => attempt.aggregation.clusteredCount)),
    detailAttemptedCount: unavailable(summedAttemptCount(attempts, (attempt) => attempt.detailFetch.attemptedCount)),
    detailSucceededCount: unavailable(summedAttemptCount(attempts, (attempt) => attempt.detailFetch.successCount)),
    detailFailedCount: unavailable(summedAttemptCount(attempts, (attempt) => attempt.detailFetch.failedCount)),
    aggregationInputCount: unavailable(summedAttemptCount(attempts, (attempt) => attempt.aggregation.inputCount)),
    aggregationOutputCount: unavailable(summedAttemptCount(attempts, (attempt) => attempt.aggregation.clusteredCount)),
    producedEvidenceCount: evidence.producedEvidenceCount,
    cumulativeEvidenceCount: evidence.cumulativeEvidenceCount,
  };
}

function filteringDiagnostics(data, summary, signals) {
  const evaluatedCount = Array.isArray(summary.filteringDetails)
    ? summary.filteringDetails.length
    : undefined;
  const keptCount = summary.displayedCount ?? signals.length;
  const filteredCount = Number.isFinite(evaluatedCount) && Number.isFinite(keptCount)
    ? Math.max(0, evaluatedCount - keptCount)
    : undefined;
  return {
    evaluatedCount: unavailable(evaluatedCount),
    keptCount: unavailable(keptCount),
    filteredCount: unavailable(filteredCount),
    reasonCounts: unavailable(summary.filteredReasons),
    strongestHiddenSignal: unavailable(summary.strongestHiddenSignal),
  };
}

function preservationDiagnostics(phaseTrace) {
  const preservation = phaseTrace
    .filter((entry) => entry.phase === "evidence_preservation_finished")
    .map((entry) => entry.diagnostic || {});
  const latest = preservation.at(-1) || {};
  const cumulative = preservation
    .map((entry) => Number(entry.cumulativeEvidenceCount))
    .filter(Number.isFinite);
  const carriedForward = preservation
    .map((entry) => Number(entry.carriedForwardEvidenceCount))
    .filter(Number.isFinite);
  const finalCounts = preservation
    .map((entry) => Number(entry.finalEvidenceCount))
    .filter(Number.isFinite);
  return {
    roundEvidenceCount: unavailable(latest.roundEvidenceCount),
    producedEvidenceCount: unavailable(latest.producedEvidenceCount),
    cumulativeEvidenceCount: unavailable(cumulative.length ? Math.max(...cumulative) : latest.cumulativeEvidenceCount),
    carriedForwardEvidenceCount: unavailable(carriedForward.length ? Math.max(...carriedForward) : latest.carriedForwardEvidenceCount),
    acceptedEvidenceCount: unavailable(latest.acceptedEvidenceCount),
    rejectedEvidenceCount: unavailable(latest.rejectedEvidenceCount),
    verificationOutcome: unavailable(latest.verificationOutcome),
    finalEvidenceCount: unavailable(finalCounts.length ? Math.max(...finalCounts) : latest.finalEvidenceCount),
    rejectionReason: unavailable(latest.rejectionReason),
    perRound: preservation.length ? preservation : "unavailable",
  };
}

function evidenceDiagnostics(data, summary, signals, latestRun, phaseTrace) {
  const accepted = evidenceItems(signals);
  const preservation = preservationDiagnostics(phaseTrace);
  const accounting = data.evidenceAccounting || {};
  const hasPreservation = Array.isArray(preservation.perRound);
  const attempts = attemptDiagnostics(phaseTrace);
  const rejectedByAttempt = attempts
    .map((attempt) => Number(attempt.evidence.preservation?.rejectedEvidenceCount))
    .filter(Number.isFinite);
  const acceptedByAttempt = attempts
    .map((attempt) => Number(attempt.evidence.preservation?.acceptedEvidenceCount))
    .filter(Number.isFinite);
  const evidenceRecordCount = producedEvidenceCountFromResponseData(data);
  const producedEvidenceCount = evidenceRecordCount === "unavailable" ? undefined : evidenceRecordCount;
  const rejectedEvidenceCount = Number.isFinite(Number(accounting.rejectedEvidenceCount))
    ? Number(accounting.rejectedEvidenceCount)
    : (rejectedByAttempt.length ? Math.max(...rejectedByAttempt) : undefined);
  const acceptedEvidenceCount = Number.isFinite(Number(accounting.acceptedEvidenceCount))
    ? Number(accounting.acceptedEvidenceCount)
    : (acceptedByAttempt.length ? Math.max(...acceptedByAttempt) : undefined);
  const preservationReason = [...attempts]
    .reverse()
    .map((attempt) => attempt.evidence.preservation?.rejectionReason)
    .find((source) => source && typeof source === "object");
  const reasonSources = [accounting.rejectionReasons || preservationReason];
  const rejection = rejectionAccounting(rejectedEvidenceCount, reasonSources);
  const cumulativeTraceCounts = attempts
    .map((attempt) => numericCount(attempt.evidence.preservation?.cumulativeEvidenceCount))
    .filter((value) => value !== undefined);
  const cumulativeEvidenceCount = cumulativeTraceCounts.length
    ? Math.max(...cumulativeTraceCounts)
    : producedEvidenceCount;
  const finalEvidenceCount = Number.isFinite(Number(accounting.finalEvidenceCount))
    ? Number(accounting.finalEvidenceCount)
    : (hasPreservation ? preservation.finalEvidenceCount : acceptedEvidenceCount);
  return {
    candidateCount: unavailable(summary.clusteredCount ?? summary.filteringDetails?.length ?? data.overview?.events),
    discoveredCandidateCount: unavailable(accounting.discoveredCandidateCount ?? summary.retrievedCount ?? data.overview?.scanned),
    producedEvidenceCount: unavailable(producedEvidenceCount),
    producedEvidenceDataSource: Array.isArray(data.evidenceRecords) ? "ResearchResponse.evidenceRecords" : "unavailable",
    cumulativeEvidenceCount: unavailable(cumulativeEvidenceCount),
    evaluatedEvidenceCount: unavailable(accounting.evaluatedEvidenceCount ?? (hasPreservation ? preservation.evaluatedEvidenceCount : producedEvidenceCount)),
    acceptedEvidenceCount: unavailable(acceptedEvidenceCount ?? (preservation.acceptedEvidenceCount === "unavailable" ? latestRun?.evidenceCount ?? accepted.length : preservation.acceptedEvidenceCount)),
    rejectedEvidenceCount: unavailable(rejectedEvidenceCount),
    finalEvidenceCount: unavailable(finalEvidenceCount),
    rejectedReason: rejection.primaryRejectionReasonCounts,
    rejectionReasonObserved: "unavailable",
    ...rejection,
    evidenceWithMappedPrimaryReasonCount: rejection.evidenceWithMappedPrimaryReasonCount,
    byAttempt: attempts.length
      ? attempts.map((attempt) => ({
          attemptId: attempt.attemptId,
          round: attempt.round,
          attemptType: attempt.attemptType,
          phaseItemCount: attempt.evidence.phaseItemCount,
          preservation: attempt.evidence.preservation,
        }))
      : "unavailable",
    preservation,
    byDisplayedSignal: signals.map((signal) => ({
      title: unavailable(signal.title),
      claimCount: unavailable(Array.isArray(signal.claims) ? signal.claims.length : undefined),
      evidenceSourceCount: unavailable(evidenceItems([signal]).length),
      verificationStatus: unavailable(signal.verificationStatus),
      contentQuality: unavailable(signal.contentQuality),
      contentFailureReason: unavailable(signal.contentFailureReason),
      action: unavailable(signal.action),
      actionabilityStatus: unavailable(signal.actionabilityStatus),
      informationGainStatus: unavailable(signal.informationGainStatus),
      hasExecutableAction: unavailable(signal.hasExecutableAction),
      executionEntry: unavailable(signal.executionEntry),
    })),
  };
}

function statefulSecondRunDiagnostics(secondRun) {
  if (!secondRun) return "unavailable";
  return {
    requestId: unavailable(secondRun.requestId),
    httpStatus: unavailable(secondRun.httpStatus),
    lastPhase: unavailable(secondRun.lastPhase),
    latestStatus: unavailable(secondRun.latestStatus),
    evidenceCount: unavailable(secondRun.evidenceCount),
    knowledgeChanges: unavailable(secondRun.knowledgeChanges),
    traceStates: unavailable(secondRun.traceStates),
    reason: unavailable(secondRun.reason),
  };
}

function qualityAcceptance(summary, report) {
  if (summary.status !== 200) {
    return {
      status: statuses.fail,
      reason: sanitize(summary.errorCode || summary.error || `HTTP ${summary.status}`),
    };
  }
  const accounting = report?.evidenceDiagnostics || {};
  const produced = Number(accounting.producedEvidenceCount);
  const accepted = Number(accounting.acceptedEvidenceCount);
  const rejected = Number(accounting.rejectedEvidenceCount);
  const hasCompleteRejectionAccounting = Number.isFinite(produced)
    && Number.isFinite(rejected)
    && rejected === produced
    && accounting.rejectedReason !== "unavailable"
    && accounting.rejectionAccountingComplete === true;
  if (summary.signalCount > 0 && summary.evidenceCount > 0 && (!Number.isFinite(accepted) || accepted > 0)) {
    return { status: statuses.pass, reason: null };
  }
  if (hasCompleteRejectionAccounting) {
    return {
      status: statuses.partial,
      reason: `HTTP 200; produced Evidence was rejected with complete accounting (produced=${produced}, rejected=${rejected})`,
    };
  }
  return {
    status: statuses.fail,
    reason: `HTTP 200 but incomplete quality output: signalCount=${summary.signalCount}, evidenceCount=${summary.evidenceCount}, producedEvidenceCount=${Number.isFinite(produced) ? produced : "unavailable"}`,
  };
}

function emptyQualityReport(status, reason, state = {}) {
  return {
    generatedAt: new Date().toISOString(),
    reportSchemaVersion: 2,
    buildCommitSha: process.env.GITHUB_SHA || "unavailable",
    sourceTraceRequestId: state.requestId ?? "unavailable",
    attempts: "unavailable",
    executionStatus: "unavailable",
    qualityStatus: status,
    runCumulative: { cumulativeEvidenceCount: "unavailable", carriedForwardEvidenceCount: "unavailable" },
    finalResponse: { acceptedEvidenceCount: "unavailable", finalEvidenceCount: "unavailable" },
    mode: "quality_acceptance",
    acceptanceStatus: status,
    query: { original: qualityQuery || "unavailable" },
    inference: {
      inferredIntent: "unavailable",
      intentReason: "unavailable",
      freshnessTimeRange: "unavailable",
      sourcePreference: "unavailable",
      sourceSelection: "unavailable",
      entitiesTopic: "unavailable",
    },
    planning: planningTimingDiagnostics([]),
    retrieval: {
      retrievedCount: "unavailable",
      evaluatedCount: "unavailable",
      clusteredCount: "unavailable",
      displayedCount: "unavailable",
      search: "unavailable",
      detailFetch: "unavailable",
      aggregation: "unavailable",
      keptSources: "unavailable",
    },
    sources: "unavailable",
    filtered: {
      summaryText: "unavailable",
      reasonCounts: "unavailable",
      strongestHiddenSignal: "unavailable",
      evaluation: "unavailable",
      sampleFilteredResults: "unavailable",
    },
    evidenceDiagnostics: {
      candidateCount: "unavailable",
      discoveredCandidateCount: "unavailable",
      producedEvidenceCount: "unavailable",
      producedEvidenceDataSource: "unavailable",
      cumulativeEvidenceCount: "unavailable",
      evaluatedEvidenceCount: "unavailable",
      acceptedEvidenceCount: "unavailable",
      rejectedEvidenceCount: "unavailable",
      finalEvidenceCount: "unavailable",
      rejectedReason: "unavailable",
      primaryRejectionReasonCounts: "unavailable",
      rejectionReasonOccurrences: "unavailable",
      evidenceWithMappedPrimaryReasonCount: "unavailable",
      unclassifiedRejectedEvidenceCount: "unavailable",
      rejectionAccountingComplete: false,
      byAttempt: "unavailable",
      preservation: "unavailable",
      byDisplayedSignal: "unavailable",
    },
    evidence: "unavailable",
    result: {
      finalNaturalLanguageConclusion: "unavailable",
      recommendedUserTests: "unavailable",
      outputMode: "unavailable",
      intentOutput: "unavailable",
    },
    state: {
      requestId: state.requestId ?? null,
      httpStatus: state.httpStatus ?? null,
      latencyMs: state.latencyMs ?? null,
      lastPhase: state.lastPhase ?? "unavailable",
      lastSuccessfulPhase: state.lastSuccessfulPhase ?? "unavailable",
      phaseTrace: state.phaseTrace ?? "unavailable",
      statefulSecondRun: statefulSecondRunDiagnostics(statefulSecondRunForQuality),
    },
    rawAvailability: {
      hasIntent: false,
      hasFilteringSummary: false,
      hasAgentRun: false,
      displayedSignals: 0,
    },
    failureReason: sanitize(reason),
  };
}

async function runQualityAcceptance(session) {
  if (!qualityQuery || qualityReport?.state?.requestId) return;
  let restartedForQuality = false;
  try {
    await stopServer();
    startServer({ MODEL_REQUEST_TIMEOUT_MS: qualityModelRequestTimeoutMs });
    restartedForQuality = true;
    await waitForHealth();
    const qualityFilter = `filter-${runId}-quality`;
    await seedFilter(session.user.id, qualityFilter, `Agent quality report ${runId}`);
    const qualityRun = await runQualityResearch(session, qualityFilter, qualityQuery);
    let qualityRuns = [];
    let agentRunsError = null;
    try {
      qualityRuns = await latestAgentRuns(session, qualityFilter);
    } catch (error) {
      agentRunsError = sanitize(error instanceof Error ? error.message : error);
    }
    qualityReport = buildQualityReport({
      query: qualityQuery,
      signalRun: qualityRun,
      agentRuns: qualityRuns,
      secondRun: statefulSecondRunForQuality,
    });
    const acceptance = qualityAcceptance(qualityRun.summary, qualityReport);
    qualityReport.acceptanceStatus = acceptance.status;
    qualityReport.qualityStatus = acceptance.status;
    qualityReport.failureReason = acceptance.reason;
    if (agentRunsError) qualityReport.rawAvailability.agentRunsError = agentRunsError;
    if (acceptance.status !== statuses.pass) process.exitCode = 1;
  } catch (error) {
    qualityReport = emptyQualityReport(
      statuses.fail,
      error instanceof Error ? error.message : error,
      { lastPhase: "quality_acceptance" },
    );
    process.exitCode = 1;
  } finally {
    if (restartedForQuality) {
      try {
        await stopServer();
        startServer();
        await waitForHealth();
      } catch (error) {
        const reason = `Quality server restore failed: ${sanitize(error instanceof Error ? error.message : error)}`;
        if (qualityReport?.rawAvailability) {
          qualityReport.rawAvailability.serverRestoreError = reason;
        } else {
          qualityReport = emptyQualityReport(statuses.fail, reason, { lastPhase: "quality_server_restore" });
        }
        process.exitCode = 1;
      }
    }
  }
}

function buildQualityReport({ query, signalRun, agentRuns, secondRun }) {
  const response = signalRun.response;
  const data = response.data || {};
  const signals = Array.isArray(data.signals) ? data.signals : [];
  const summary = data.filteringSummary || {};
  const latestRun = latestRunForQuality(agentRuns);
  const keptSources = signals.map(keptSource);
  const phaseTrace = phaseTraceFor(signalRun.summary.requestId);
  const search = searchDiagnostics(data, phaseTrace);
  const filteredDetails = Array.isArray(summary.filteringDetails)
    ? summary.filteringDetails
        .filter((item) => item.decision === "filtered")
        .slice(0, 12)
        .map((item) => ({
          title: unavailable(item.title),
          reason: unavailable(item.reason),
            explanation: unavailable(item.explanation),
            topicRelevanceStatus: unavailable(item.topicRelevance?.decision),
            topicRelevanceReason: unavailable(item.topicRelevance?.reason),
            matchedDomainAnchors: unavailable(item.topicRelevance?.matchedDomainAnchors),
            matchedTaskAnchors: unavailable(item.topicRelevance?.matchedTaskAnchors),
            matchedGenericTerms: unavailable(item.topicRelevance?.matchedGenericTerms),
            matchedQueryTerms: unavailable(item.topicRelevance?.matchedQueryTerms),
            relevanceGateApplied: unavailable(item.topicRelevance?.relevanceGateApplied),
            relevanceGatePassed: unavailable(item.topicRelevance?.relevanceGatePassed),
          sources: Array.isArray(item.sources)
            ? item.sources.slice(0, 3).map((source) => ({
                publisher: unavailable(source.publisher),
                domain: source.sourceUrl ? domainFromUrl(source.sourceUrl) : "unavailable",
              }))
            : "unavailable",
        }))
    : "unavailable";
  const sourcePreference = data.sourceProfile?.preferredSourceTypes
    || data.queryPlan?.allowedProviderIds
    || unique([data.queryPlan?.selectedSourceType, ...(data.queryPlan?.fallbackSourceTypes || [])]);
  const planningTiming = planningTimingDiagnostics(phaseTrace);
  const evidence = evidenceDiagnostics(data, summary, signals, latestRun, phaseTrace);
  const runCumulative = runCumulativeDiagnostics(search.attempts, evidence);
  const finalResponse = {
    ...evidence.final,
    displayedCount: signals.length,
    signalCount: signals.length,
    displayedEvidenceCount: evidenceItems(signals).length,
  };
  return {
    generatedAt: new Date().toISOString(),
    reportSchemaVersion: 2,
    buildCommitSha: process.env.GITHUB_SHA || "unavailable",
    sourceTraceRequestId: signalRun.summary.requestId || "unavailable",
    attempts: search.attempts,
    runCumulative,
    finalResponse,
    executionStatus: signalRun.summary.status === 200 ? statuses.pass : statuses.fail,
    qualityStatus: "unavailable",
    mode: "quality_acceptance",
    query: {
      original: query,
    },
    inference: {
      inferredIntent: unavailable(data.intent?.primaryIntent || data.sourceProfile?.intent),
      intentReason: unavailable(data.intent?.reason),
      freshnessTimeRange: unavailable(data.queryPlan?.requestedFreshnessWindow || data.sourceProfile?.freshnessRequirement),
      freshnessMentionedByUser: query,
      freshnessInferred: data.queryPlan?.requestedFreshnessWindow || data.sourceProfile?.freshnessRequirement || "unavailable",
      sourcePreference: unavailable(sourcePreference),
      sourceSelection: search.selectedSourceTypes?.length
        ? {
            selectedSourceTypes: search.selectedSourceTypes,
            sourceSelectionReason: search.sourceSelectionReason,
          }
        : unavailable(latestRun?.selectedSources || {
            selectedSourceType: data.queryPlan?.selectedSourceType,
            fallbackSourceTypes: data.queryPlan?.fallbackSourceTypes,
            sourceSelectionReason: data.queryPlan?.sourceSelectionReason,
          }),
      entitiesTopic: data.queryPlan?.resolvedEntities ?? data.queryPlan?.entities ?? data.queryPlan?.coreKeywords ?? "unavailable",
    },
    planning: planningTiming,
    topicProfile: search.topicProfile,
    topicProfileSource: search.topicProfileSource,
    topicProfileApplied: search.topicProfileApplied,
    retrieval: {
      ...runCumulative,
      retrievedCount: runCumulative.retrievedCount,
      evaluatedCount: runCumulative.evaluatedCount,
      clusteredCount: runCumulative.clusteredCount,
      displayedCount: unavailable(summary.displayedCount ?? signals.length),
      evaluatedByCurrentFields: {
        counts: unavailable(data.counts),
        overview: unavailable(data.overview),
        sourceDiagnostics: unavailable(data.sourceDiagnostics),
        sourceOutcomes: unavailable(data.sourceOutcomes),
      },
      search,
      detailFetch: detailFetchDiagnostics(data, search.attempts),
      aggregation: aggregationDiagnostics(data, summary, search.attempts),
      keptSources: keptSources.map((item) => ({
        title: item.title,
        url: item.url,
        domain: item.domain,
        sourceType: item.sourceType,
        publishedAt: item.publishedAt,
      })),
    },
    sources: keptSources,
    filtered: {
      summaryText: unavailable(summary.summaryText),
      reasonCounts: unavailable(summary.filteredReasons),
      strongestHiddenSignal: unavailable(summary.strongestHiddenSignal),
      evaluation: filteringDiagnostics(data, summary, signals),
      sampleFilteredResults: filteredDetails,
    },
    evidenceDiagnostics: evidence,
    evidence: evidenceItems(signals).slice(0, 20).map((item) => ({
      signal: unavailable(item.signal),
      claim: unavailable(item.claim),
      source: unavailable(item.source),
      domain: item.source ? domainFromUrl(item.source) : "unavailable",
      publisher: unavailable(item.publisher),
      verificationStatus: unavailable(item.verificationStatus),
      topicRelevanceStatus: unavailable(item.topicRelevance?.decision),
      topicRelevanceReason: unavailable(item.topicRelevance?.reason),
      matchedDomainAnchors: unavailable(item.topicRelevance?.matchedDomainAnchors),
      matchedTaskAnchors: unavailable(item.topicRelevance?.matchedTaskAnchors),
      matchedGenericTerms: unavailable(item.topicRelevance?.matchedGenericTerms),
      matchedQueryTerms: unavailable(item.topicRelevance?.matchedQueryTerms),
      relevanceGateApplied: unavailable(item.topicRelevance?.relevanceGateApplied),
      relevanceGatePassed: unavailable(item.topicRelevance?.relevanceGatePassed),
      snippet: unavailable(item.snippet),
    })),
    result: {
      finalNaturalLanguageConclusion: unavailable(data.finalConclusion || data.summary || data.answer),
      recommendedUserTests: unavailable(signals.map((signal) => signal.action).filter(Boolean)),
      actionability: actionabilityDiagnostics(signals),
      outputMode: unavailable(data.outputMode || data.intentOutput?.mode),
      intentOutput: unavailable(data.intentOutput),
    },
    state: {
      knowledgeWriteCount: unavailable(Array.isArray(latestRun?.knowledgeChanges) ? latestRun.knowledgeChanges.length : undefined),
      knowledgeChanges: unavailable(latestRun?.knowledgeChanges),
      attentionDecision: unavailable(latestRun?.finalAttention || signals.map((signal) => signal.attentionDecision)),
      requestId: signalRun.summary.requestId,
      httpStatus: signalRun.summary.status,
      latencyMs: signalRun.summary.durationMs,
      lastPhase: signalRun.lastPhase,
      lastSuccessfulPhase: lastSuccessfulPhaseFromTrace(phaseTrace),
      phaseTrace,
      traceStates: unavailable(Array.isArray(latestRun?.trace) ? latestRun.trace.map((entry) => entry.state) : undefined),
      statefulSecondRun: statefulSecondRunDiagnostics(secondRun),
    },
    rawAvailability: {
      hasIntent: Boolean(data.intent || data.sourceProfile),
      hasFilteringSummary: Boolean(data.filteringSummary),
      hasAgentRun: Boolean(latestRun),
      hasPreservationTrace: phaseTrace.some((entry) => entry.phase === "evidence_preservation_finished"),
      displayedSignals: signals.length,
    },
  };
}

function qualityMarkdown(report) {
  if (report.acceptanceStatus === statuses.fail && !report.inference) {
    return [
      "# Signal Map Agent Quality Report",
      "",
      `- status: \`${report.acceptanceStatus}\``,
      `- executionStatus: \`${report.executionStatus || "unavailable"}\``,
      `- qualityStatus: \`${report.qualityStatus || report.acceptanceStatus || "unavailable"}\``,
      `- requestId: \`${report.state?.requestId || "unavailable"}\``,
      `- HTTP: \`${report.state?.httpStatus ?? "unavailable"}\``,
      `- lastPhase: \`${report.state?.lastPhase || "unavailable"}\``,
      `- failure: ${report.failureReason || "unavailable"}`,
      "",
      "## QUERY",
      "",
      report.query?.original || "unavailable",
      "",
    ].join("\n");
  }
  const lines = [
    "# Signal Map Agent Quality Report",
    "",
    `- status: \`${report.acceptanceStatus || "unavailable"}\``,
    `- executionStatus: \`${report.executionStatus || "unavailable"}\``,
    `- qualityStatus: \`${report.qualityStatus || report.acceptanceStatus || "unavailable"}\``,
    `- reportSchemaVersion: \`${report.reportSchemaVersion || "unavailable"}\``,
    `- buildCommitSha: \`${report.buildCommitSha || "unavailable"}\``,
    `- sourceTraceRequestId: \`${report.sourceTraceRequestId || "unavailable"}\``,
    `- requestId: \`${report.state.requestId || "unavailable"}\``,
    `- HTTP: \`${report.state.httpStatus ?? "unavailable"}\``,
    `- latency: \`${report.state.latencyMs ?? "unavailable"}ms\``,
    `- lastPhase: \`${report.state.lastPhase || "unavailable"}\``,
    `- lastSuccessfulPhase: \`${report.state.lastSuccessfulPhase || "unavailable"}\``,
    `- failure: ${report.failureReason || "none"}`,
    "",
    "## QUERY",
    "",
    report.query.original,
    "",
    "## INFERENCE",
    "",
    `- inferred intent: ${compact(report.inference.inferredIntent)}`,
    `- freshness mentioned / inferred: ${compact(report.inference.freshnessMentionedByUser, 500)} / ${compact(report.inference.freshnessInferred)}`,
    `- source preference: ${compact(report.inference.sourcePreference)}`,
    `- source selection: ${compact(report.inference.sourceSelection, 1000)}`,
    `- entities / topic: ${compact(report.inference.entitiesTopic)}`,
    "",
    "## RETRIEVAL",
    "",
    `- retrieved: ${compact(report.retrieval.retrievedCount)}`,
    `- evaluated: ${compact(report.retrieval.evaluatedCount)}`,
    `- clustered: ${compact(report.retrieval.clusteredCount)}`,
    `- displayed: ${compact(report.retrieval.displayedCount)}`,
    `- selectedSourceTypes: ${compact(report.retrieval.search?.selectedSourceTypes)}`,
    `- discoveryMode: ${compact(report.retrieval.search?.discoveryMode)}`,
    `- verificationSourceTypes: ${compact(report.retrieval.search?.verificationSourceTypes)}`,
    `- sourceSelectionReason: ${compact(report.retrieval.search?.sourceSelectionReason)}`,
    `- resolvedEntities: ${compact(report.retrieval.search?.resolvedEntities)}`,
    `- agentGeneratedQueries: ${compact(report.retrieval.search?.agentGeneratedQueries, 1400)}`,
    `- pipelineActualQueries: ${compact(report.retrieval.search?.pipelineActualQueries, 1400)}`,
    `- searchProvider: ${compact(report.retrieval.search?.searchProvider, 1400)}`,
    `- providerCallAttempted: ${compact(report.retrieval.search?.providerCallAttempted, 1400)}`,
    `- providerReturnedCount: ${compact(report.retrieval.search?.providerReturnedCount, 1400)}`,
    `- emptyResultReason: ${compact(report.retrieval.search?.emptyResultReason)}`,
    `- fallbackUsed: ${compact(report.retrieval.search?.fallbackUsed)}`,
    `- retrievalPlanSource: ${compact(report.retrieval.search?.retrievalPlanSource)}`,
    `- fallbackReason: ${compact(report.retrieval.search?.fallbackReason)}`,
    `- search returned count: ${compact(report.retrieval.search, 1800)}`,
    `- detail fetch: ${compact(report.retrieval.detailFetch, 1200)}`,
    `- aggregation: ${compact(report.retrieval.aggregation, 1000)}`,
    `- runCumulative: ${compact(report.runCumulative, 1400)}`,
    `- finalResponse: ${compact(report.finalResponse, 800)}`,
    `- attempts: ${compact(report.retrieval.search?.attempts, 2600)}`,
    "",
    "## PLANNING TIMING",
    "",
    `- quality MODEL_REQUEST_TIMEOUT_MS: ${compact(report.planning?.modelRequestTimeoutMs)}`,
    `- /api/signals deadline budget: ${compact(report.planning?.signalsDeadlineBudgetMs)}ms`,
    `- minimum retrieval budget: ${compact(report.planning?.minimumRetrievalBudgetMs)}ms`,
    `- createResearchPlan: ${compact(report.planning?.createResearchPlan)}`,
    `- applyModelPlanning: ${compact(report.planning?.applyModelPlanning)}`,
    `- model planning timed out: ${compact(report.planning?.modelPlanningTimedOut)}`,
    `- deterministic fallback used: ${compact(report.planning?.fallbackToDeterministicPlan)}`,
    `- source selection duration: ${compact(report.planning?.sourceSelectionDurationMs)}ms`,
    `- post-source-selection pre-retrieval window: ${compact(report.planning?.postSourceSelectionPreRetrievalWindowMs)}ms`,
    `- remaining deadline before runResearchPipeline: ${compact(report.planning?.remainingDeadlineMsBeforeRunResearchPipeline)}ms`,
    `- retrieval started: ${compact(report.planning?.retrievalStarted)}`,
    `- topicProfile: ${compact(report.topicProfile, 1200)}`,
    `- topicProfileSource: ${compact(report.topicProfileSource)}`,
    `- topicProfileApplied: ${compact(report.topicProfileApplied)}`,
    `- deadline error code: ${compact(report.planning?.deadlineErrorCode)}`,
    `- note: ${compact(report.planning?.observabilityNote, 500)}`,
    "",
    "## SOURCES",
    "",
    ...(Array.isArray(report.sources) && report.sources.length
      ? report.sources.flatMap((source, index) => [
          `${index + 1}. ${compact(source.title, 220)}`,
          `   - domain: ${compact(source.domain)}`,
          `   - url: ${compact(source.url)}`,
          `   - source type: ${compact(source.sourceType)}`,
          `   - published / freshness: ${compact(source.publishedAt)} / ${compact(source.freshness)}`,
          `   - why kept: ${compact(source.whyKept, 350)}`,
          `   - reliability / evidence: ${compact(source.reliability)} / ${compact(source.verificationStatus)}`,
          `   - topic relevance: ${compact(source.topicRelevanceStatus)} / ${compact(source.topicRelevanceReason)}`,
          `   - relevance matches: ${compact({ domain: source.matchedDomainAnchors, task: source.matchedTaskAnchors, generic: source.matchedGenericTerms, query: source.matchedQueryTerms })}`,
          `   - relevance gate: ${compact({ applied: source.relevanceGateApplied, passed: source.relevanceGatePassed })}`,
        ])
      : ["unavailable"]),
    "",
    "## FILTERED",
    "",
    `- summary: ${compact(report.filtered.summaryText, 500)}`,
    `- reason counts: ${compact(report.filtered.reasonCounts)}`,
    `- evaluation: ${compact(report.filtered.evaluation, 1000)}`,
    `- sample filtered results: ${compact(report.filtered.sampleFilteredResults, 1600)}`,
    "",
    "## EVIDENCE DIAGNOSTICS",
    "",
    `- candidate / accepted: ${compact(report.evidenceDiagnostics.candidateCount)} / ${compact(report.evidenceDiagnostics.acceptedEvidenceCount)}`,
    `- discoveredCandidateCount: ${compact(report.evidenceDiagnostics.discoveredCandidateCount)}`,
    `- roundEvidenceCount: ${compact(report.evidenceDiagnostics.preservation?.roundEvidenceCount)}`,
    `- producedEvidenceCount: ${compact(report.evidenceDiagnostics.producedEvidenceCount)}`,
    `- producedEvidenceDataSource: ${compact(report.evidenceDiagnostics.producedEvidenceDataSource)}`,
    `- evaluatedEvidenceCount: ${compact(report.evidenceDiagnostics.evaluatedEvidenceCount)}`,
    `- cumulativeEvidenceCount: ${compact(report.evidenceDiagnostics.cumulativeEvidenceCount)}`,
    `- carriedForwardEvidenceCount: ${compact(report.evidenceDiagnostics.preservation?.carriedForwardEvidenceCount)}`,
    `- acceptedEvidenceCount: ${compact(report.evidenceDiagnostics.acceptedEvidenceCount)}`,
    `- rejectedEvidenceCount: ${compact(report.evidenceDiagnostics.rejectedEvidenceCount)}`,
    `- primaryRejectionReasonCounts: ${compact(report.evidenceDiagnostics.primaryRejectionReasonCounts)}`,
    `- rejectionReasonOccurrences: ${compact(report.evidenceDiagnostics.rejectionReasonOccurrences)}`,
    `- evidenceWithMappedPrimaryReasonCount: ${compact(report.evidenceDiagnostics.evidenceWithMappedPrimaryReasonCount)}`,
    `- unclassifiedRejectedEvidenceCount: ${compact(report.evidenceDiagnostics.unclassifiedRejectedEvidenceCount)}`,
    `- rejectionAccountingComplete: ${compact(report.evidenceDiagnostics.rejectionAccountingComplete)}`,
    `- verificationOutcome: ${compact(report.evidenceDiagnostics.preservation?.verificationOutcome)}`,
    `- finalEvidenceCount: ${compact(report.evidenceDiagnostics.finalEvidenceCount)}`,
    `- rejectionReason: ${compact(report.evidenceDiagnostics.preservation?.rejectionReason, 1000)}`,
    `- rejected reason: ${compact(report.evidenceDiagnostics.rejectedReason, 1000)}`,
    `- observed rejection reason: ${compact(report.evidenceDiagnostics.rejectionReasonObserved, 1000)}`,
    `- runCumulative: ${compact(report.runCumulative)}`,
    `- finalResponse: ${compact(report.finalResponse)}`,
    `- by attempt: ${compact(report.evidenceDiagnostics.byAttempt, 2200)}`,
    `- by displayed signal: ${compact(report.evidenceDiagnostics.byDisplayedSignal, 1200)}`,
    "",
    "## EVIDENCE",
    "",
    ...(Array.isArray(report.evidence) && report.evidence.length
      ? report.evidence.slice(0, 10).map((item, index) =>
          `${index + 1}. ${compact(item.claim, 260)} — ${compact(item.publisher)} (${compact(item.domain)})`,
        )
      : ["unavailable"]),
    "",
    "## RESULT",
    "",
    `- final conclusion: ${compact(report.result.finalNaturalLanguageConclusion, 800)}`,
    `- recommended user tests: ${compact(report.result.recommendedUserTests, 800)}`,
    `- actionability: ${compact(report.result.actionability, 1600)}`,
    "",
    "## STATE",
    "",
    `- Knowledge writes: ${compact(report.state.knowledgeWriteCount)}`,
    `- Attention: ${compact(report.state.attentionDecision)}`,
    `- final signals count: ${compact(report.rawAvailability?.displayedSignals)}`,
    `- needs_more_evidence reason: ${compact(report.state.statefulSecondRun, 1200)}`,
    `- trace states: ${compact(report.state.traceStates)}`,
    `- phase trace: ${compact(report.state.phaseTrace, 1800)}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function runSignals(session, filterId, label) {
  const requestId = `${runId}-${label}`;
  const response = await session.request(`/api/signals?filterId=${encodeURIComponent(filterId)}`, {
    method: "POST",
    requestId,
    body: {
      filterId,
      identity: "AI product builder validating Signal Map",
      industry: "最近值得测试的 AI 视频工具",
      focusAreas: "AI video generation tools, product launches, API cost changes",
      currentQuestions: "最近有什么值得测试的 AI 视频工具？",
      knownInformation: "Do not use fixtures; use live public sources and keep evidence-bound conclusions.",
      informationGaps: "Which recent AI video tools or updates are important enough to affect testing priorities?",
      freshnessWindow: "7d",
      sourceScope: "hybrid",
    },
  });
  await delay(250);
  return {
    response,
    summary: summarizeSignalResponse(response),
    phases: phaseNamesFor(response.requestId || requestId),
    lastPhase: lastPhaseFor(response.requestId || requestId),
  };
}

async function runQualityResearch(session, filterId, query) {
  const requestId = `${runId}-quality`;
  const response = await session.request(`/api/signals?filterId=${encodeURIComponent(filterId)}`, {
    method: "POST",
    requestId,
    body: {
      filterId,
      identity: "Signal Map quality acceptance reviewer",
      industry: query,
      focusAreas: query,
      currentQuestions: query,
      knownInformation: "Use only the authenticated test account state and live public evidence. Do not use fixtures or mocks.",
      informationGaps: "What evidence-backed changes or opportunities should a user pay attention to?",
      trackedEntities: "",
      trackedEvents: "",
      userJudgements: "",
      evidenceHistory: "",
      freshnessWindow: "30d",
      sourceScope: "hybrid",
    },
  });
  await delay(250);
  return {
    response,
    summary: summarizeSignalResponse(response),
    phases: phaseNamesFor(response.requestId || requestId),
    lastPhase: lastPhaseFor(response.requestId || requestId),
  };
}

async function latestAgentRuns(session, filterId) {
  const response = await session.request(`/api/control/agent-runs?filterId=${encodeURIComponent(filterId)}`);
  if (response.status !== 200) throw new Error(`/api/control/agent-runs failed HTTP ${response.status}`);
  return response.data?.agentRuns || [];
}

// Actual binding sequence for one acceptance query:
// 1. snapshot every run id that already exists for this user/filter
// 2. issue the research request
// 3. fetch the runs again and bind against the window, excluding the snapshot
// A snapshot read failure aborts binding BEFORE the request is issued, so a
// binding claim can never rest on an unverified run universe.
async function executeAndBindQuery(session, filterId, requestId, body, priorRunIds = []) {
  let snapshotIds;
  try {
    const preRuns = await latestAgentRuns(session, filterId);
    snapshotIds = [...new Set([...(priorRunIds || []), ...preRuns.map((run) => run?.id).filter(Boolean)])];
  } catch (error) {
    return {
      ok: false,
      bindingStatus: "SNAPSHOT_UNAVAILABLE",
      reason: sanitize(error instanceof Error ? error.message : error),
      response: null,
    };
  }
  const requestStartedAt = Date.now();
  const response = await session.request(`/api/signals?filterId=${encodeURIComponent(filterId)}`, {
    method: "POST",
    requestId,
    body,
  });
  const requestCompletedAt = Date.now();
  let runs;
  try {
    runs = await latestAgentRuns(session, filterId);
  } catch (error) {
    return {
      ok: false,
      bindingStatus: "RUNS_UNAVAILABLE",
      reason: sanitize(error instanceof Error ? error.message : error),
      response,
    };
  }
  const binding = selectRunForRequest(runs, {
    requestStartedAt,
    requestCompletedAt,
    excludeRunIds: snapshotIds,
  });
  return {
    ok: true,
    response,
    binding,
    requestStartedAt,
    requestCompletedAt,
    snapshotSize: snapshotIds.length,
  };
}

const TEN_QUERY_SEQUENCE = [
  { q: "Palmier Pro launch news for macOS AI video editing", entity: "Palmier Pro", phase: "NEW_BASELINE" },
  { q: "Palmier Pro launch news for macOS AI video editing", entity: "Palmier Pro", phase: "DUPLICATE_SAME_FACT" },
  { q: "Palmier Pro shipped team workspace collaboration", entity: "Palmier Pro", phase: "UPDATE_PROBE" },
  { q: "unverified rumor claims Palmier Pro will pivot to hardware", entity: "Palmier Pro", phase: "RELIABILITY_DIFF" },
  { q: "Acme agent coding tool official release", entity: "Acme", phase: "NEW_ENTITY_B" },
  { q: "Acme agent coding tool official release", entity: "Acme", phase: "DUPLICATE_ENTITY_B" },
  { q: "Palmier Pro collaboration rollout details", entity: "Palmier Pro", phase: "SAVE_PREFERENCE_RESTART" },
  { q: "Palmier Pro pricing and plan changes", entity: "Palmier Pro", phase: "PREFERENCE_ATTRIBUTION" },
  { q: "Acme agent tool new benchmark results", entity: "Acme", phase: "ISOLATION_CONTROL" },
  { q: "Palmier Pro high-value launch follow-up", entity: "Palmier Pro", phase: "PREFERENCE_STABILITY" },
];

function runAgentStatesFromTrace(trace) {
  const states = Array.isArray(trace) ? trace.map((entry) => entry?.state).filter(Boolean) : [];
  const required = ["UNDERSTAND", "RETRIEVE", "INTENT", "EVALUATE", "UPDATE_KNOWLEDGE"];
  return {
    present: required.filter((state) => states.includes(state)),
    proven: required.every((state) => states.includes(state)),
  };
}

// Outcome classification. Auth, rate-limit and business failures are decided
// BEFORE evidence accounting so an auth error body can never be read as a
// zero-evidence success. Evidence-based outcomes require HTTP 200 AND a
// response matching the research contract: a signals array plus an evidence
// accounting whose counts all exist, are finite numbers and are non-negative.
// Missing fields are never defaulted to zero.
function classifyQueryOutcome(httpStatus, data) {
  if (httpStatus === 401 || httpStatus === 403) return "AUTH_FAILURE";
  if (httpStatus === 429) return "RATE_LIMITED";
  if (httpStatus >= 500 || data?.errorCode === "DB_TIMEOUT") return "BUSINESS_FAILURE";
  if (httpStatus !== 200) return "INVALID_RESPONSE";
  const validShape = Boolean(data) && typeof data === "object"
    && Array.isArray(data.signals)
    && Boolean(data.evidenceAccounting) && typeof data.evidenceAccounting === "object";
  if (!validShape) return "INVALID_RESPONSE";
  const accounting = data.evidenceAccounting;
  const counts = {
    discovered: accounting.discoveredCandidateCount,
    produced: accounting.producedEvidenceCount,
    accepted: accounting.acceptedEvidenceCount,
  };
  const countsValid = Object.values(counts).every((value) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (!countsValid) return "INVALID_RESPONSE";
  const reasons = accounting.rejectionReasons || null;
  const hasRejectionReasons = Boolean(reasons) && Object.values(reasons).some((value) => Number(value) > 0);
  const failuresText = (Array.isArray(data?.failures) ? data.failures : [])
    .map((item) => JSON.stringify(item)).join(" ");
  const providerFailure = /upstream_error|timeout|forbidden|failed_to_fetch|unreachable|econn/i.test(failuresText);
  if (counts.discovered === 0 && providerFailure) return "PROVIDER_FAILURE";
  if (counts.discovered > 0 && counts.accepted === 0 && hasRejectionReasons) return "CORRECT_REJECTION";
  if (counts.discovered === 0 && !providerFailure) return "CORRECT_EMPTY";
  return "PRODUCED";
}

// A run record belongs to the current request only if it started at or after
// the request was issued (small skew allowance). This prevents a failed
// request from inheriting a previous run's evidence, knowledge or attention.
// A run record belongs to the current request only when all of these hold:
// - its id is not one of the runs already observed before the request
// - it started inside [requestStartedAt - skew, requestCompletedAt + skew]
// - it matches the requesting user/filter when the record exposes them
// Several candidates inside the window are reported as AMBIGUOUS instead of
// silently binding the newest one.
function selectRunForRequest(runs, {
  requestStartedAt,
  requestCompletedAt,
  skewMs = 2000,
  excludeRunIds = [],
  authenticatedUserId,
  filterId,
} = {}) {
  const list = Array.isArray(runs) ? runs : [];
  const excluded = new Set(excludeRunIds || []);
  const lowerBound = requestStartedAt - skewMs;
  const upperBound = (requestCompletedAt ?? Number.POSITIVE_INFINITY) + skewMs;
  const candidates = list.filter((run) => {
    if (!run || excluded.has(run.id)) return false;
    if (authenticatedUserId && run.userId && run.userId !== authenticatedUserId) return false;
    if (filterId && run.filterId && run.filterId !== filterId) return false;
    const started = Date.parse(run?.startedAt || "");
    return Number.isFinite(started) && started >= lowerBound && started <= upperBound;
  });
  if (!candidates.length) return { status: "NOT_FOUND", run: null, candidateIds: [] };
  if (candidates.length > 1) {
    return { status: "AMBIGUOUS", run: null, candidateIds: candidates.map((run) => run.id) };
  }
  return { status: "BOUND", run: candidates[0], candidateIds: [candidates[0].id] };
}

// Knowledge-comparison level classification, derived from the reconciled
// information-gain status on the response signals (NOT from the persisted
// knowledgeChanges list, which by contract excludes DUPLICATE entries).
function deriveGainClassification(gainStatuses) {
  const list = Array.isArray(gainStatuses) ? gainStatuses.filter(Boolean) : [];
  if (!list.length) return "NO_RUN";
  if (list.includes("UPDATED_INFORMATION")) return "UPDATED";
  if (list.includes("NEW_INFORMATION")) return "NEW";
  return "DUPLICATE";
}

// Stable identity fingerprint of the factual payload the preference layer must
// never touch. Identity is per claim: normalized claim text, its verification
// status, the owning signal's reliability, and the sorted evidence identities
// (canonical URL preferred). Entries are sorted so reordering never creates a
// false difference; attention decisions and timestamps are excluded.
function normalizeIdentityText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function factFingerprint(signals) {
  const list = Array.isArray(signals) ? signals : [];
  const claims = list.flatMap((signal) => (Array.isArray(signal?.claims) ? signal.claims : []).map((claim) => {
    const reliability = Number(signal?.reliabilityScore);
    return {
      claim: normalizeIdentityText(claim?.canonicalClaimFingerprint || claim?.claimText),
      verification: claim?.verificationStatus || null,
      reliability: Number.isFinite(reliability) ? reliability : null,
      evidence: (Array.isArray(claim?.evidenceSources) ? claim.evidenceSources : [])
        .map((source) => normalizeIdentityText(source?.canonicalUrl || source?.sourceUrl))
        .filter(Boolean)
        .sort(),
    };
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return { claims };
}

function factStateUnchanged(left, right) {
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasHighAttention(value) {
  return /MUST_READ|WORTH_WATCHING/i.test(String(value || ""));
}

function hasLowAttention(value) {
  return /LIBRARY_ONLY|IGNORE/i.test(String(value || ""));
}

// Duplicate acceptance closes only when all levels agree:
// 1. comparison level — the reconciled result identified the same fact
//    (an empty second round classifies as NO_RUN and never as DUPLICATE)
// 2. fact identity level — the two rounds carry the same fact fingerprint
// 3. persistence level — knowledge count did not grow
// 4. attention level — the duplicate was not surfaced as high attention
function evaluateDuplicateCase({ baseline, duplicate }) {
  const baselineBound = Boolean(baseline?.bound);
  const duplicateBound = Boolean(duplicate?.bound);
  const duplicateIdentified = duplicate?.classification === "DUPLICATE";
  const sameFact = factStateUnchanged(baseline?.fact, duplicate?.fact);
  const noNewKnowledge = duplicate?.knowledgeUnchanged === true;
  const noUnreasonableAttention = !hasHighAttention(duplicate?.attention);
  const closed = baselineBound && duplicateBound && duplicateIdentified && sameFact && noNewKnowledge && noUnreasonableAttention;
  return { closed, baselineBound, duplicateBound, duplicateIdentified, sameFact, noNewKnowledge, noUnreasonableAttention };
}

// A replay material is independently re-derivable proof. It must carry BOTH
// arms' evidence inputs and knowledge initial state, the preference condition,
// and the declared outputs; the validator recomputes both arms with the real
// applyAttentionPreferences and rejects the material when the declared outputs
// contradict the recomputed ones, when the arms' inputs differ, or when the
// knowledge initial states differ. CAPTURED_REPLAY additionally requires
// capture provenance (commit, request id, run id, source material reference).
// FIXTURE_REPLAY proves only the function contract and can never close a
// real-data acceptance.
function replayEvidenceMaterialValid(material) {
  const invalid = (reason) => ({ valid: false, reason });
  if (!material || typeof material !== "object" || Array.isArray(material)) return invalid("not-an-object");
  if (material.mode !== "FIXTURE_REPLAY" && material.mode !== "CAPTURED_REPLAY") return invalid("unknown-mode");
  if (material.mode === "CAPTURED_REPLAY") {
    const capture = material.capture || {};
    if (!capture.commitSha || !capture.requestId || !capture.runId || !capture.sourceMaterial) {
      return invalid("capture-provenance-missing");
    }
  }
  const arms = material.arms;
  if (!arms?.withoutPreference || !arms?.withPreference) return invalid("arm-inputs-missing");
  // Knowledge initial state must be EXPLICITLY present on both arms. An absent
  // state is not the same as an empty state: missing → rejected, while an
  // explicit { knownFacts: [] } is a valid empty initial state.
  if (!arms.withoutPreference.signals || !("knowledgeState" in arms.withoutPreference)
    || !arms.withPreference.signals || !("knowledgeState" in arms.withPreference)) {
    return invalid("knowledge-state-missing");
  }
  const withoutSignals = arms.withoutPreference.signals;
  const withSignals = arms.withPreference.signals;
  if (!Array.isArray(withoutSignals) || !Array.isArray(withSignals)) return invalid("arm-inputs-missing");
  if (!factStateUnchanged(factFingerprint(withoutSignals), factFingerprint(withSignals))) {
    return invalid("arm-inputs-differ");
  }
  if (JSON.stringify(arms.withoutPreference.knowledgeState ?? null) !== JSON.stringify(arms.withPreference.knowledgeState ?? null)) {
    return invalid("knowledge-initial-state-differs");
  }
  const preference = material.preference;
  if (!preference?.scopeType || !preference?.scopeValue || preference.feedbackType !== "LOWER_ATTENTION") {
    return invalid("preference-condition-missing");
  }
  const withoutArm = { signals: structuredClone(withoutSignals) };
  const withArm = { signals: structuredClone(withSignals) };
  applyAttentionPreferences(withoutArm, []);
  applyAttentionPreferences(withArm, [preference]);
  const recomputedWithout = (withoutArm.signals || []).map((signal) => signal.attentionDecision).join(",");
  const recomputedWith = (withArm.signals || []).map((signal) => signal.attentionDecision).join(",");
  const declaredWithout = material.outputs?.withoutPreferenceAttention;
  const declaredWith = material.outputs?.withPreferenceAttention;
  if (declaredWithout !== recomputedWithout || declaredWith !== recomputedWith) {
    return invalid("declared-outputs-mismatch-recomputed");
  }
  if (!factStateUnchanged(factFingerprint(withArm.signals || []), factFingerprint(withoutArm.signals || []))) {
    return invalid("replay-changed-fact");
  }
  if (!hasHighAttention(recomputedWithout) || !hasLowAttention(recomputedWith)) {
    return invalid("attention-outcome-not-demonstrated");
  }
  return {
    valid: true,
    mode: material.mode,
    withoutPreferenceAttention: recomputedWithout,
    withPreferenceAttention: recomputedWith,
  };
}

// Preference attribution. Causality closes ONLY through a valid CAPTURED_REPLAY
// material (FIXTURE_REPLAY proves the function contract and is reported but can
// never close real-data acceptance). The pre-preference arm must have been
// explicitly high attention and the post-preference arm explicitly lowered; the
// control must be a bound run with real evidence AND an explicit high decision.
// Preference isolation (owner scope, sibling filter, other user, unmatched
// entity) is verified directly by evaluatePreferenceIsolation and reported
// separately from generic auth/tenant isolation; it must be observed for closure.
function evaluatePreferenceAttribution({
  baseline,
  preference,
  control,
  preferencePersisted,
  replayEvidence,
  preferenceIsolationObserved,
}) {
  const baselineBound = Boolean(baseline?.bound);
  const prefBound = Boolean(preference?.bound);
  const nonDuplicateGain = preference?.classification === "NEW" || preference?.classification === "UPDATED";
  const baselineWasHigh = hasHighAttention(baseline?.attention);
  const attentionLowered = hasLowAttention(preference?.attention) && !hasHighAttention(preference?.attention);
  const controlPresent = Boolean(control);
  const controlValid = controlPresent && Boolean(control?.bound)
    && (Number(control?.evidenceCount) > 0 || Number(control?.accepted) > 0);
  const isolationHeld = controlValid && hasHighAttention(control?.attention);
  const material = replayEvidenceMaterialValid(replayEvidence);
  const replayMaterialValid = material.valid;
  const causalityProven = replayMaterialValid && material.mode === "CAPTURED_REPLAY";
  const closed = preferencePersisted === true
    && baselineBound
    && prefBound
    && nonDuplicateGain
    && baselineWasHigh
    && attentionLowered
    && controlValid
    && isolationHeld
    && causalityProven
    && preferenceIsolationObserved === true;
  return {
    closed,
    baselineBound,
    prefBound,
    nonDuplicateGain,
    baselineWasHigh,
    attentionLowered,
    controlPresent,
    controlValid,
    isolationHeld,
    replayMaterialValid,
    replayMaterialReason: material.reason,
    replayMaterialMode: material.mode,
    causalityProven,
    preferenceIsolationObserved: preferenceIsolationObserved === true,
  };
}

// Direct preference-isolation scenario over a scoped persistence store (the
// real InMemorySignalRepository serves as the test double). Verifies, separately
// from generic auth/tenant isolation:
// - the owner sees the saved preference
// - a sibling filter of the same user has none
// - another user's own filter has none
// - consumption downgrades a matching entity ONLY inside the saved scope
// - an unmatched entity inside the scope is not downgraded
// - an empty result set can never count as isolation success
const PREFERENCE = { scopeType: "entity", scopeValue: "Palmier Pro", feedbackType: "LOWER_ATTENTION" };

function evaluatePreferenceIsolation({ store, signals, now = "2026-09-27T00:00:00.000Z" }) {
  const ownerScope = { authenticatedUserId: "user-a", filterId: "filter-a" };
  const siblingScope = { authenticatedUserId: "user-a", filterId: "filter-b" };
  const otherUserScope = { authenticatedUserId: "user-b", filterId: "filter-b-user-b" };
  store.savePreference(ownerScope, PREFERENCE, now);
  const savedVisibleToOwner = store.listPreferences(ownerScope).some((pref) =>
    pref.scopeValue === PREFERENCE.scopeValue && pref.feedbackType === PREFERENCE.feedbackType);
  const siblingFilterUnaffected = store.listPreferences(siblingScope).length === 0;
  const otherUserUnaffected = store.listPreferences(otherUserScope).length === 0;

  const armSignals = signals ?? [
    signalTemplateFor("Palmier Pro"),
    signalTemplateFor("Acme"),
  ];
  const inScope = { signals: structuredClone(armSignals) };
  applyAttentionPreferences(inScope, store.listPreferences(ownerScope));
  const siblingArm = { signals: structuredClone(armSignals) };
  applyAttentionPreferences(siblingArm, store.listPreferences(siblingScope));
  const otherUserArm = { signals: structuredClone(armSignals) };
  applyAttentionPreferences(otherUserArm, store.listPreferences(otherUserScope));

  const decisions = (response) => (response.signals || []).map((signal) => signal.attentionDecision);
  // Control validity: the arms must actually contain an explicit high decision
  // to lower; an empty result can never demonstrate isolation.
  const hasExplicitHigh = decisions(inScope).some((decision) => hasHighAttention(decision));
  const matchedEntityLowered = (inScope.signals || []).every((signal) =>
    signal.entityMatches?.includes(PREFERENCE.scopeValue)
      ? signal.attentionDecision === "LIBRARY_ONLY"
      : true);
  const unmatchedEntityUnaffected = (inScope.signals || []).every((signal) =>
    signal.entityMatches?.includes(PREFERENCE.scopeValue)
      ? true
      : hasHighAttention(signal.attentionDecision));
  const siblingFilterConsumptionUnaffected = decisions(siblingArm).every((decision) => hasHighAttention(decision));
  const otherUserConsumptionUnaffected = decisions(otherUserArm).every((decision) => hasHighAttention(decision));

  const passed = Boolean(armSignals.length)
    && savedVisibleToOwner
    && siblingFilterUnaffected
    && otherUserUnaffected
    && hasExplicitHigh
    && matchedEntityLowered
    && unmatchedEntityUnaffected
    && siblingFilterConsumptionUnaffected
    && otherUserConsumptionUnaffected;
  return {
    passed,
    savedVisibleToOwner,
    siblingFilterUnaffected,
    otherUserUnaffected,
    hasExplicitHigh,
    matchedEntityLowered,
    unmatchedEntityUnaffected,
    siblingFilterConsumptionUnaffected,
    otherUserConsumptionUnaffected,
  };
}

function signalTemplateFor(entity) {
  return {
    id: `signal-${entity}`,
    title: `${entity} ships a new capability`,
    summary: `${entity} ships a new capability`,
    entityMatches: [entity],
    attentionDecision: "MUST_READ",
    informationGainStatus: "NEW_INFORMATION",
    verificationStatus: "verified",
    reliabilityScore: 92,
    claims: [{
      claimText: `${entity} ships a new capability`,
      sourceUrl: `https://example.com/${entity.toLowerCase()}`,
      verificationStatus: "verified",
      evidenceSources: [{ sourceUrl: `https://example.com/${entity.toLowerCase()}` }],
    }],
    sources: [{ sourceUrl: `https://example.com/${entity.toLowerCase()}` }],
  };
}

// ---------------------------------------------------------------------------
// P1-A unit 1: capture file contract, loader, association and replay building
// ---------------------------------------------------------------------------

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256Canonical(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

// Digest over the captured evidence inputs; recomputed by the loader to detect
// any post-capture tampering of the recorded response.
// Digest over the FULL acceptance-relevant capture state: the evidence inputs
// plus the knowledge initial state and the association fields. The recomputed
// digest proves internal consistency of the artifact; it does not authenticate
// the real-network origin — that rests on the controlled capture process, the
// run records and the artifact itself.
function computeCaptureDigest({ requestId, runId, entity, commitSha, response, knowledgeState }) {
  return sha256Canonical({ requestId, runId, entity, commitSha, response, knowledgeState });
}

// Live capture: persist a sanitized research response plus the EXPLICIT
// knowledge initial state for later offline replay. The input digest lets the
// loader detect any post-capture tampering of the recorded evidence.
// Deep sanitization for capture payloads: every string in the research content
// is passed through the redaction filter so a hostile page cannot plant
// credential-looking material inside a capture artifact.
function sanitizeCaptureStrings(value) {
  if (typeof value === "string") return sanitize(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeCaptureStrings(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeCaptureStrings(item)]));
  }
  return value;
}

async function writeRunCapture({ captureDir, requestId, runId, commitSha, entity, response, knowledgeState }) {
  const signals = Array.isArray(response?.signals) ? response.signals : [];
  const payload = sanitizeCaptureStrings({
    captureVersion: 1,
    kind: "SIGNAL_RUN_CAPTURE",
    commitSha: commitSha || "unknown",
    requestId,
    runId,
    entity: entity || null,
    capturedAt: new Date().toISOString(),
    response: { signals, evidenceAccounting: response?.evidenceAccounting || null },
    // available:false is preserved on purpose: an unknown knowledge state is
    // NEVER rewritten into an empty one.
    knowledgeState: knowledgeState || { knownFacts: [], available: false },
  });
  payload.inputDigest = computeCaptureDigest(payload);
  await mkdir(captureDir, { recursive: true });
  const path = join(captureDir, `${requestId}.capture.json`);
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { path, payload };
}

async function loadCaptureMaterial(capturePath) {
  let raw;
  try {
    raw = await readFile(capturePath, "utf8");
  } catch {
    return { ok: false, reason: "capture-file-missing" };
  }
  let material;
  try {
    material = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "capture-parse-failed" };
  }
  if (material?.kind !== "SIGNAL_RUN_CAPTURE" || material.captureVersion !== 1) {
    return { ok: false, reason: "unsupported-capture-kind" };
  }
  if (!material.requestId || !material.runId || !material.commitSha || !material.entity) {
    return { ok: false, reason: "capture-identity-missing" };
  }
  if (!Array.isArray(material.response?.signals)) return { ok: false, reason: "capture-response-shape" };
  if (!material.knowledgeState || typeof material.knowledgeState !== "object") {
    return { ok: false, reason: "knowledge-state-missing" };
  }
  if (material.inputDigest && material.inputDigest !== computeCaptureDigest(material)) {
    return { ok: false, reason: "capture-input-tampered" };
  }
  if (!material.inputDigest) return { ok: false, reason: "capture-digest-missing" };
  return { ok: true, material, digest: material.inputDigest };
}

function captureAssociatesWithQuery(material, { requestId, runId, entity } = {}) {
  if (!material) return false;
  if (requestId && material.requestId !== requestId) return false;
  if (runId && material.runId !== runId) return false;
  if (entity && material.entity !== entity) return false;
  return true;
}

// Build replay evidence from a LOADED capture artifact: both arms clone the
// same captured input and the same knowledge initial state, differing only by
// the preference condition; outputs are recomputed with the real production
// modifier and re-validated by replayEvidenceMaterialValid.
function buildReplayEvidenceFromCapture(capture, { preference = PREFERENCE, sourceMaterial, entity } = {}) {
  if (!capture?.ok) return { ok: false, reason: capture?.reason || "capture-not-loaded" };
  const captured = capture.material;
  if (entity && captured.entity !== entity) return { ok: false, reason: "unrelated-capture" };
  // An unknown knowledge initial state (read failure) can never prove that
  // both arms started from the same state.
  if (captured.knowledgeState?.available === false) {
    return { ok: false, reason: "knowledge-state-unavailable" };
  }
  const capturedSignals = structuredClone(captured.response.signals);
  const capturedKnowledgeState = structuredClone(captured.knowledgeState);
  const arms = {
    withoutPreference: { signals: structuredClone(capturedSignals), knowledgeState: structuredClone(capturedKnowledgeState) },
    withPreference: { signals: structuredClone(capturedSignals), knowledgeState: structuredClone(capturedKnowledgeState) },
  };
  const withoutArm = { signals: structuredClone(arms.withoutPreference.signals) };
  const withArm = { signals: structuredClone(arms.withPreference.signals) };
  applyAttentionPreferences(withoutArm, []);
  applyAttentionPreferences(withArm, [preference]);
  const replayEvidence = {
    mode: "CAPTURED_REPLAY",
    capture: {
      commitSha: captured.commitSha,
      requestId: captured.requestId,
      runId: captured.runId,
      sourceMaterial: sourceMaterial || `capture:${captured.requestId}`,
    },
    arms,
    preference,
    outputs: {
      withoutPreferenceAttention: (withoutArm.signals || []).map((signal) => signal.attentionDecision).join(","),
      withPreferenceAttention: (withArm.signals || []).map((signal) => signal.attentionDecision).join(","),
    },
  };
  const validation = replayEvidenceMaterialValid(replayEvidence);
  return { ok: validation.valid, replayEvidence, validation, reason: validation.reason };
}

// The ONE validation path for acceptance replay, shared by LIVE and offline:
// re-load the capture artifact from disk (integrity + provenance), verify it
// is associated with the run being evaluated, then build and validate the
// replay material. No caller may construct a capture-looking object by hand.
async function buildReplayEvidenceForAcceptance({ capturePath, expected = {}, preference = PREFERENCE }) {
  const capture = await loadCaptureMaterial(capturePath);
  if (!capture.ok) return { ok: false, reason: capture.reason };
  if (!captureAssociatesWithQuery(capture.material, expected)) {
    return { ok: false, reason: "unrelated-capture" };
  }
  return buildReplayEvidenceFromCapture(capture, { preference, sourceMaterial: capturePath, entity: expected.entity });
}

// Offline replay entry: load a capture artifact from disk, verify association
// and integrity, re-derive both arms, and report whether the acceptance
// causality closes. Pure file operations — no providers, no database.
async function runOfflineReplay({ capturePath, preference = PREFERENCE, entity, sourceMaterial } = {}) {
  const capture = await loadCaptureMaterial(capturePath);
  if (!capture.ok) return { closed: false, materialValid: false, mode: null, reason: capture.reason };
  if (entity && !captureAssociatesWithQuery(capture.material, { entity })) {
    return { closed: false, materialValid: false, mode: null, reason: "unrelated-capture" };
  }
  const built = buildReplayEvidenceFromCapture(capture, { preference, entity, sourceMaterial: sourceMaterial || capturePath });
  if (!built.ok) return { closed: false, materialValid: false, mode: null, reason: built.reason };
  return { closed: true, materialValid: true, mode: built.validation.mode, validation: built.validation };
}

// Four-scenario configuration for the acceptance sequence. Entities, queries
// and candidate sources are operator inputs; the example entities are never
// assumed to produce new facts. `candidateSources` is surfaced for the P1-B
// operator and the report — it does not alter the research contract.
const SCENARIO_KEYS = ["newFact", "duplicate", "preferenceRestart", "isolation"];

async function loadScenarioConfig(path) {
  if (!path) return { ok: true, config: null };
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { ok: false, reason: "scenario-config-missing" };
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "scenario-config-parse-failed" };
  }
  const missing = SCENARIO_KEYS.filter((key) => !config?.[key]?.entity || typeof config?.[key]?.queries !== "object");
  if (missing.length) return { ok: false, reason: `scenario-config-invalid: ${missing.join(",")}` };
  return { ok: true, config };
}

function buildQuerySequence(config) {
  if (!config) return TEN_QUERY_SEQUENCE;
  const defaults = TEN_QUERY_SEQUENCE;
  const override = (phase, scenario) => {
    const entry = defaults.find((item) => item.phase === phase);
    const query = scenario?.queries?.[phase] ?? entry.q;
    return { phase, entity: scenario?.entity ?? entry.entity, q: query };
  };
  return [
    override("NEW_BASELINE", config.newFact),
    override("DUPLICATE_SAME_FACT", config.duplicate),
    override("UPDATE_PROBE", config.newFact),
    override("RELIABILITY_DIFF", config.newFact),
    override("NEW_ENTITY_B", config.isolation),
    override("DUPLICATE_ENTITY_B", config.isolation),
    override("SAVE_PREFERENCE_RESTART", config.preferenceRestart),
    override("PREFERENCE_ATTRIBUTION", config.preferenceRestart),
    override("ISOLATION_CONTROL", config.isolation),
    override("PREFERENCE_STABILITY", config.preferenceRestart),
  ];
}

// Real preference-isolation execution entry (HTTP). Storage isolation and auth
// rejection are observed through the actual preference API; consumption
// isolation is computed by the caller from the live acceptance rows. The
// returned `observed` is always computed from these results — never hardcoded.
// Empty reads and empty controls can never constitute isolation success.
async function runPreferenceIsolationScenarios({
  ownerSession,
  ownerFilterId,
  siblingFilterId,
  otherUserSession,
  otherUserFilterId,
  preference = PREFERENCE,
  consumptionIsolation = { matchedLowered: false, unmatchedHigh: false },
}) {
  const readPreferences = async (session, filterId) => {
    const response = await session.request(`/api/preferences?filterId=${encodeURIComponent(filterId)}`);
    const list = Array.isArray(response.data?.preferences) ? response.data.preferences : [];
    return { response, list };
  };

  // 1. Owner saves and reads back the preference in its own scope.
  const save = await ownerSession.request(`/api/preferences?filterId=${encodeURIComponent(ownerFilterId)}`, {
    method: "POST",
    body: { filterId: ownerFilterId, ...preference },
  });
  const ownerRead = await readPreferences(ownerSession, ownerFilterId);
  const ownerReadBack = save.status === 200 && ownerRead.response.status === 200
    && ownerRead.list.some((pref) => pref.scopeValue === preference.scopeValue && pref.feedbackType === preference.feedbackType);

  // 2. A sibling filter of the same user must hold no preference.
  const siblingRead = await readPreferences(ownerSession, siblingFilterId);
  const siblingFilterEmpty = siblingRead.response.status === 200 && siblingRead.list.length === 0;

  // 3. Another user's own filter must hold no preference. A 401 here means the
  // other-user session is invalid — distinct from "logged in, own scope,
  // simply no preference" (200 + empty list).
  const otherRead = await readPreferences(otherUserSession, otherUserFilterId);
  const otherUserEmpty = otherRead.response.status === 200 && otherRead.list.length === 0;

  // 4. Cross-user access to the other user's scope must be rejected.
  const cross = await ownerSession.request(`/api/preferences?filterId=${encodeURIComponent(otherUserFilterId)}`);
  const authRejected = [401, 403].includes(cross.status);

  const otherUserSessionValid = otherRead.response.status === 200;
  const storageIsolation = { ownerReadBack, siblingFilterEmpty, otherUserEmpty, otherUserSessionValid };
  const authRejection = { attempted: true, rejected: authRejected, httpStatus: cross.status };
  const isolationStatus = !otherUserSessionValid ? "OTHER_USER_SESSION_INVALID" : "EXECUTED";
  const observed = isolationStatus === "EXECUTED"
    && storageIsolation.ownerReadBack
    && storageIsolation.siblingFilterEmpty
    && storageIsolation.otherUserEmpty
    && authRejected
    && consumptionIsolation.matchedLowered === true
    && consumptionIsolation.unmatchedHigh === true;
  return {
    observed,
    isolationStatus,
    storageIsolation,
    authRejection,
    consumptionIsolation,
    details: [
      `save HTTP ${save.status}`,
      `owner read HTTP ${ownerRead.response.status} preferences=${ownerRead.list.length}`,
      `sibling read HTTP ${siblingRead.response.status} preferences=${siblingRead.list.length}`,
      `other-user read HTTP ${otherRead.response.status} preferences=${otherRead.list.length}`,
      `cross-user HTTP ${cross.status}`,
    ],
  };
}

async function scopedKnowledgeState(session, filterId) {
  const response = await session.request(`/api/control/knowledge?filterId=${encodeURIComponent(filterId)}`);
  if (response.status !== 200) return { knownFacts: [], available: false };
  const list = Array.isArray(response.data?.knowledge) ? response.data.knowledge : [];
  return { knownFacts: list.map((record) => record?.text).filter(Boolean), available: true };
}

async function scopedKnowledgeCount(session, filterId) {
  const response = await session.request(`/api/control/knowledge?filterId=${encodeURIComponent(filterId)}`);
  if (response.status !== 200) return null;
  const list = Array.isArray(response.data?.knowledge) ? response.data.knowledge : [];
  return list.length;
}

// Session lifecycle for the acceptance phase: BOTH accounts log in before any
// isolation scenario runs, and logout happens only after every session-bound
// scenario has completed. This keeps "B not logged in" from being confused
// with "B logged in but holds no preference".
async function prepareAcceptanceSessions({ createSession, login, accountAEmail, accountAPassword, accountBEmail, accountBPassword }) {
  const harnessSession = createSession("Account A (ten-query)");
  await login(harnessSession, accountAEmail, accountAPassword);
  const otherUserSession = createSession("Account B (ten-query)");
  await login(otherUserSession, accountBEmail, accountBPassword);
  return { harnessSession, otherUserSession };
}

// Real acceptance orchestration used by main: both accounts must be
// authenticated before the ten-query sequence and the preference-isolation
// scenario run. Lazy re-login is NOT performed here; main guarantees login
// before calling this, and logout is handled once in main's final cleanup.
async function runAuthenticatedAcceptance({ ownerSession, otherUserSession, runDependent }) {
  if (!ownerSession?.user) throw new Error("owner session not authenticated before acceptance");
  if (!otherUserSession?.user) throw new Error("other-user session not authenticated before acceptance");
  await runDependent({ ownerSession, otherUserSession });
}

// Log every session out, tolerating an individual failure so one backend error
// cannot stop the remaining sessions from being cleaned up. Never throws, so
// it can never mask a preceding business error. The caller reports the
// returned failures in its own phase/evidence record.
async function logoutAllSessions(sessions, { logout }) {
  const loggedOut = [];
  const failures = [];
  for (const session of sessions) {
    try {
      const response = await logout(session);
      loggedOut.push({ label: session?.label ?? "session", httpStatus: response?.status ?? null });
    } catch {
      failures.push(session?.label ?? "session");
    }
  }
  return { loggedOut, failures };
}

// Distinguishing the three knowledge-read outcomes: a successful read with a
// real empty list (available: true), a failed read (available: false → count
// is null and can never participate in an unchanged-knowledge claim).
function knowledgeCountFromState(state) {
  if (!state || state.available !== true || !Array.isArray(state.knownFacts)) return null;
  return state.knownFacts.length;
}

// Budget accounting for the acceptance run. Research HTTP requests are the
// unit that maps to provider fan-out and model calls downstream; provider
// requests per research run are multiple and NOT hard-capped here (provider
// side quota on the test accounts is the external cost control).
const ACCEPTANCE_SEQUENCE_LENGTH = TEN_QUERY_SEQUENCE.length;
const ACCEPTANCE_RESEARCH_REQUEST_COUNT = 2 + ACCEPTANCE_SEQUENCE_LENGTH;
const ACCEPTANCE_QUALITY_REQUEST_COUNT = 1;

async function runTenQuerySequence(session, filterId, {
  captureDir = join("captures", runId),
  commitSha = gitInfo().commitSha,
  siblingFilterId = null,
  otherUserSession = null,
  otherUserFilterId = null,
  scenarioConfig = null,
} = {}) {
  const report = phaseReports.tenQuery;
  const rows = [];
  let preferenceSavedStatus = null;
  let restartEvidence = null;
  let baselineCapture = null;
  const sequence = buildQuerySequence(scenarioConfig);

  const seenRunIds = new Set();
  for (let i = 0; i < sequence.length; i += 1) {
    const item = sequence[i];
    const requestId = `${runId}-tq-${i + 1}`;
    const knowledgeStateBefore = await scopedKnowledgeState(session, filterId);
    const knowledgeBefore = knowledgeCountFromState(knowledgeStateBefore);
    const bound = await executeAndBindQuery(session, filterId, requestId, {
      filterId,
      identity: "Signal Map E2E ten-query",
      industry: item.q,
      focusAreas: item.q,
      currentQuestions: item.q,
      knownInformation: "Use only the authenticated test account state and live public evidence. Do not use fixtures.",
      informationGaps: "What evidence-backed changes or opportunities should a user pay attention to?",
      trackedEntities: "",
      trackedEvents: "",
      userJudgements: "",
      evidenceHistory: "",
      freshnessWindow: "30d",
      sourceScope: "hybrid",
    }, [...seenRunIds]);
    if (!bound.ok) {
      rows.push({
        index: i + 1,
        phase: item.phase,
        entity: item.entity,
        query: item.q,
        mode: "LIVE",
        httpStatus: null,
        requestId,
        failureClass: "BUSINESS_FAILURE",
        runBound: false,
        runBinding: bound.bindingStatus,
        bindingCandidates: [],
        selectedRunId: null,
        classification: "NO_RUN_FOR_REQUEST",
        gainStatuses: "none",
        fact: { claims: [] },
        discovered: 0,
        produced: 0,
        accepted: 0,
        rejectionReasons: null,
        evidenceCount: 0,
        attention: "none",
        knowledgeChanges: "none",
        knowledgeBefore,
        knowledgeAfter: null,
        knowledgeUnchanged: false,
        runAgentStates: "none",
        runAgentPath: false,
      });
      fail(report, `${bound.bindingStatus} at Q${i + 1}: ${bound.reason || "run universe could not be verified"}`, {
        requestId,
        rows,
        underTest: gitInfo(),
      });
      return;
    }
    const requestStartedAt = bound.requestStartedAt;
    const requestCompletedAt = bound.requestCompletedAt;
    const response = bound.response;
    await delay(200);

    const binding = bound.binding;
    seenRunIds.add(binding.run?.id ?? `${requestId}-unbound`);
    const latest = binding.run;
    const runBound = binding.status === "BOUND";
    const attention = Array.isArray(latest?.finalAttention) ? latest.finalAttention
      : Array.isArray(latest?.attentionResult) ? latest.attentionResult : [];
    const attentionText = attention.join(",") || "none";
    const agentPath = runAgentStatesFromTrace(latest?.trace);
    const accounting = response.data?.evidenceAccounting || null;
    const responseSignals = Array.isArray(response.data?.signals) ? response.data.signals : [];
    const gainStatuses = [...new Set(responseSignals.map((signal) => signal?.informationGainStatus).filter(Boolean))];
    const classification = !runBound ? "NO_RUN_FOR_REQUEST" : deriveGainClassification(gainStatuses);
    const fact = factFingerprint(responseSignals);
    const knowledgeAfterState = await scopedKnowledgeState(session, filterId);
    const knowledgeAfter = knowledgeCountFromState(knowledgeAfterState);

    // LIVE capture: persist the sanitized response and the explicit knowledge
    // initial state for later offline replay. Best-effort — a capture failure
    // keeps the run going but leaves the replay causality open (PARTIAL).
    let capturePath = null;
    try {
      const written = await writeRunCapture({
        captureDir,
        requestId,
        runId: latest?.id ?? requestId,
        commitSha,
        entity: item.entity,
        response: response.data,
        knowledgeState: knowledgeStateBefore,
      });
      capturePath = written.path;
      if (item.phase === "NEW_BASELINE") {
        baselineCapture = {
          path: written.path,
          requestId,
          runId: latest?.id ?? null,
          entity: item.entity,
        };
      }
      addEvidence(report, `Q${i + 1} captured -> ${capturePath}`);
    } catch (error) {
      addEvidence(report, `Q${i + 1} capture failed: ${sanitize(error instanceof Error ? error.message : error)}`);
    }

    // After the Q6 duplicate probe, persist a LOWER_ATTENTION preference for the
    // Palmier Pro entity, then restart the server to prove the preference is
    // durable (Postgres-backed, not process memory) before preference-sensitive queries.
    if (item.phase === "SAVE_PREFERENCE_RESTART" && preferenceSavedStatus === null) {
      const saved = await session.request(`/api/preferences?filterId=${encodeURIComponent(filterId)}`, {
        method: "POST",
        body: { filterId, scopeType: "entity", scopeValue: "Palmier Pro", feedbackType: "LOWER_ATTENTION" },
      });
      preferenceSavedStatus = saved.status;
      const stopResult = await stopServer();
      const started = startServer();
      await waitForHealth();
      const identity = await confirmServerIdentity({ baseUrl, expectedInstanceId: started.instanceId });
      const newServerAlive = identity.confirmed && isProcessAlive(serverProcess) && serverInstance?.instanceId === started.instanceId;
      const persisted = await session.request(`/api/preferences?filterId=${encodeURIComponent(filterId)}`);
      const list = Array.isArray(persisted.data?.preferences) ? persisted.data.preferences : [];
      const match = list.find((pref) => pref.scopeValue === "Palmier Pro" && pref.feedbackType === "LOWER_ATTENTION");
      restartEvidence = {
        preferenceSaveHttp: saved.status,
        oldExit: stopResult,
        newServer: started,
        newServerAlive,
        identityConfirmation: identity,
        persistedReadHttp: persisted.status,
        preferenceDurable: Boolean(match),
      };
      addEvidence(report, `Q${i + 1} preference save HTTP ${saved.status}; oldExit stopped=${stopResult.stopped} reason=${stopResult.reason || "exit"}; newServer pid=${started.pid} identityConfirmed=${identity.confirmed} alive=${newServerAlive}; persisted HTTP ${persisted.status} matches=${Boolean(match)}`);
      if (!stopResult.stopped) {
        fail(report, "old server process exit could not be confirmed; restart acceptance aborted", { requestId, oldExit: stopResult });
        return;
      }
      if (!identity.confirmed) {
        fail(report, `health identity not confirmed for the new server process: ${identity.reason}`, { requestId, identityConfirmation: identity });
        return;
      }
      if (!newServerAlive) {
        fail(report, "new server process did not stay alive after health check; restart acceptance aborted", { requestId, newServer: started });
        return;
      }
      if (!match) {
        fail(report, "LOWER_ATTENTION preference for Palmier Pro was not durable across restart", { requestId });
        return;
      }
    }

    const row = {
      index: i + 1,
      phase: item.phase,
      entity: item.entity,
      query: item.q,
      mode: "LIVE",
      httpStatus: response.status,
      requestId,
      requestStartedAt: new Date(requestStartedAt).toISOString(),
      requestCompletedAt: new Date(requestCompletedAt).toISOString(),
      failureClass: classifyQueryOutcome(response.status, response.data),
      runBound,
      runBinding: binding.status,
      bindingCandidates: binding.candidateIds,
      snapshotSize: bound.snapshotSize,
      selectedRunId: latest?.id ?? null,
      classification,
      gainStatuses: gainStatuses.join("|") || "none",
      fact,
      discovered: Number(accounting?.discoveredCandidateCount ?? 0),
      produced: Number(accounting?.producedEvidenceCount ?? 0),
      accepted: Number(accounting?.acceptedEvidenceCount ?? 0),
      rejectionReasons: accounting?.rejectionReasons || null,
      evidenceCount: latest?.evidenceCount ?? 0,
      attention: attentionText,
      knowledgeChanges: Array.isArray(latest?.knowledgeChanges)
        ? latest.knowledgeChanges.map((change) => change?.classification).filter(Boolean).join("|") || "none"
        : "none",
      knowledgeBefore,
      knowledgeAfter,
      knowledgeUnchanged: knowledgeBefore !== null && knowledgeAfter !== null && knowledgeBefore === knowledgeAfter,
      runAgentStates: agentPath.present.join("|") || "none",
      runAgentPath: agentPath.proven,
    };
    rows.push(row);
    addEvidence(report, `Q${row.index} [${item.phase}] ${row.entity} http=${row.httpStatus} fail=${row.failureClass} bound=${row.runBound} class=${row.classification} attn=${row.attention} kb:${row.knowledgeBefore}->${row.knowledgeAfter} evidence=${row.evidenceCount} agent=${row.runAgentPath}`);
  }

  const hardFailures = rows.filter((row) =>
    row.failureClass === "BUSINESS_FAILURE"
    || row.failureClass === "AUTH_FAILURE"
    || row.failureClass === "INVALID_RESPONSE");
  if (hardFailures.length) {
    fail(report, `${hardFailures.map((row) => `Q${row.index}(${row.failureClass}:http${row.httpStatus})`).join(", ")}`, {
      requestId: hardFailures[0].requestId,
      rows,
      underTest: gitInfo(),
    });
    return;
  }

  const unboundRows = rows.filter((row) => !row.runBound);
  const rateLimitedRows = rows.filter((row) => row.failureClass === "RATE_LIMITED");
  const agentPathProven = rows.some((row) => row.runAgentPath);
  const baseline = rows.find((row) => row.phase === "NEW_BASELINE");
  const duplicateRow = rows.find((row) => row.phase === "DUPLICATE_SAME_FACT");
  const preferenceRow = rows.find((row) => row.phase === "PREFERENCE_ATTRIBUTION");
  const isolationRow = rows.find((row) => row.phase === "ISOLATION_CONTROL");

  const toEvaluationRow = (row) => row ? { ...row, bound: row.runBound } : row;
  const duplicateEvaluation = evaluateDuplicateCase({
    baseline: toEvaluationRow(baseline),
    duplicate: toEvaluationRow(duplicateRow),
  });
  const duplicateCaseClosed = duplicateEvaluation.closed;

  // Replay causality: re-load the real Q1 baseline capture through the ONE
  // shared loader-based path (integrity, provenance, association), then build
  // CAPTURED_REPLAY evidence whose outputs are recomputed with the real
  // modifier. Without a usable capture the causality stays explicitly open.
  let replayEvidence = null;
  let replayReason = "no-captured-baseline";
  if (baselineCapture) {
    const built = await buildReplayEvidenceForAcceptance({
      capturePath: baselineCapture.path,
      expected: {
        requestId: baselineCapture.requestId,
        runId: baselineCapture.runId,
        entity: preferenceRow?.entity ?? baselineCapture.entity,
      },
    });
    if (built.ok) replayEvidence = built.replayEvidence;
    else replayReason = built.reason;
  }

  // Preference isolation is computed from the actual scenario execution over
  // HTTP (storage + auth) plus the live rows (consumption). It is never
  // hardcoded, and generic auth/tenant isolation is reported separately.
  let isolationScenario = {
    observed: false,
    status: "NOT_EXECUTED",
    storageIsolation: null,
    authRejection: null,
    consumptionIsolation: null,
  };
  if (siblingFilterId && otherUserSession && otherUserFilterId) {
    try {
      isolationScenario = {
        ...await runPreferenceIsolationScenarios({
          ownerSession: session,
          ownerFilterId: filterId,
          siblingFilterId,
          otherUserSession,
          otherUserFilterId,
          consumptionIsolation: {
            matchedLowered: Boolean(preferenceRow) && hasLowAttention(preferenceRow.attention) && !hasHighAttention(preferenceRow.attention),
            unmatchedHigh: Boolean(isolationRow) && hasHighAttention(isolationRow.attention),
          },
        }),
        status: "EXECUTED_LIVE",
      };
    } catch (error) {
      isolationScenario = {
        observed: false,
        status: "EXECUTION_FAILED",
        reason: sanitize(error instanceof Error ? error.message : error),
      };
    }
  }

  const preferenceEvaluation = evaluatePreferenceAttribution({
    baseline: toEvaluationRow(baseline),
    preference: toEvaluationRow(preferenceRow),
    control: toEvaluationRow(isolationRow),
    preferencePersisted: restartEvidence?.preferenceDurable === true,
    replayEvidence,
    preferenceIsolationObserved: isolationScenario.observed === true,
  });
  const preferenceCaseClosed = preferenceEvaluation.closed;

  if (!unboundRows.length && agentPathProven && duplicateCaseClosed && preferenceCaseClosed) {
    pass(report, {
      requestId: `${runId}-tq`,
      underTest: gitInfo(),
      restartEvidence,
      rows,
      duplicateCase: duplicateEvaluation,
      preferenceCase: {
        ...preferenceEvaluation,
        attributionBasis: `causality via ${preferenceEvaluation.replayMaterialMode || "no replay material"}`,
        preferenceIsolation: isolationScenario,
      },
      verificationLayers: {
        fixture: "asserted by tests/e2e-acceptance-logic.test.mjs (function contract only)",
        capturedReplay: preferenceEvaluation.causalityProven ? "CLOSED" : `OPEN (${replayReason})`,
        live: "OBSERVED (rows above)",
        realDatabase: "NOT EXECUTED in this run (npm test real-DB suite; see skipped tests)",
      },
      agentPathProven,
    });
    return;
  }

  const missing = [];
  if (unboundRows.length) missing.push(`${unboundRows.length} query(ies) without a run record bound to their request: Q${unboundRows.map((row) => row.index).join(",Q")}`);
  if (!agentPathProven) missing.push("runAgent trace chain not observed");
  if (!duplicateCaseClosed) missing.push(`duplicate case: ${JSON.stringify(duplicateEvaluation)}`);
  if (!preferenceCaseClosed) missing.push(`preference case: ${JSON.stringify(preferenceEvaluation)}; replay: ${replayReason}; isolation: ${isolationScenario.status}`);
  if (rateLimitedRows.length) missing.push(`rate limited: Q${rateLimitedRows.map((row) => row.index).join(",Q")}`);
  partial(report, `real provider sequence completed with ${rows.length} queries; acceptance not fully closed: ${missing.join("; ")}`, {
    requestId: `${runId}-tq`,
    underTest: gitInfo(),
    restartEvidence,
    rows,
    duplicateCase: duplicateEvaluation,
    preferenceCase: preferenceEvaluation,
    agentPathProven,
  });
}

function includesResearchChain(phases) {
  const required = [
    "research_started",
    "agent_started",
    "source_selection_started",
    "search_started",
    "evidence_started",
    "knowledge_started",
    "persistence_started",
    "response_finished",
  ];
  return required.every((phase) => phases.includes(phase));
}

function runShowsKnowledgeUse(run) {
  const retrieve = (run?.trace || []).find((entry) => entry.state === "RETRIEVE");
  const result = typeof retrieve?.result === "string" ? retrieve.result : JSON.stringify(retrieve?.result ?? "");
  return Boolean(retrieve && result && result !== "none" && result.includes("Signal Map e2e seed knowledge"));
}

async function cleanup() {
  if (!dbClient) return;
  const filterIds = [...created.filterIds];
  const userIds = [...created.userIds];
  if (!filterIds.length || !userIds.length) return;
  try {
    const runRows = await query(
      `SELECT id, evidence_ids FROM research_run_metadata
       WHERE user_id = ANY($1::text[]) AND filter_id = ANY($2::text[])`,
      [userIds, filterIds],
    );
    const evidenceIds = [...new Set(runRows.rows.flatMap((row) => Array.isArray(row.evidence_ids) ? row.evidence_ids : []))];
    const claimRows = evidenceIds.length
      ? await query(
          `SELECT e.id AS evidence_id, e.claim_id, c.event_id
           FROM evidence e
           LEFT JOIN claims c ON c.id = e.claim_id
           WHERE e.id = ANY($1::text[])`,
          [evidenceIds],
        )
      : { rows: [] };
    const claimIds = [...new Set(claimRows.rows.map((row) => row.claim_id).filter(Boolean))];
    const eventIds = [...new Set(claimRows.rows.map((row) => row.event_id).filter(Boolean))];
    await query("DELETE FROM notifications WHERE user_id = ANY($1::text[]) AND filter_id = ANY($2::text[])", [userIds, filterIds]);
    await query("DELETE FROM goals WHERE user_id = ANY($1::text[]) AND filter_id = ANY($2::text[])", [userIds, filterIds]);
    await query("DELETE FROM user_preferences WHERE user_id = ANY($1::text[]) AND filter_id = ANY($2::text[])", [userIds, filterIds]);
    await query("DELETE FROM personal_knowledge WHERE user_id = ANY($1::text[]) AND filter_id = ANY($2::text[])", [userIds, filterIds]);
    await query("DELETE FROM research_context_revisions WHERE user_id = ANY($1::text[]) AND filter_id = ANY($2::text[])", [userIds, filterIds]);
    await query("DELETE FROM research_run_metadata WHERE user_id = ANY($1::text[]) AND filter_id = ANY($2::text[])", [userIds, filterIds]);
    await query("DELETE FROM filters WHERE user_id = ANY($1::text[]) AND id = ANY($2::text[])", [userIds, filterIds]);
    if (evidenceIds.length) {
      await query(
        `DELETE FROM evidence e
         WHERE e.id = ANY($1::text[])
           AND NOT EXISTS (
             SELECT 1 FROM research_run_metadata r
             WHERE r.evidence_ids ? e.id
           )`,
        [evidenceIds],
      );
    }
    if (claimIds.length) {
      await query(
        `DELETE FROM claims c
         WHERE c.id = ANY($1::text[])
           AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.claim_id = c.id)`,
        [claimIds],
      );
    }
    if (eventIds.length) {
      await query(
        `DELETE FROM events ev
         WHERE ev.id = ANY($1::text[])
           AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.event_id = ev.id)`,
        [eventIds],
      );
    }
    addEvidence(phaseReports.persistence, `Cleanup completed for run-owned filters=${filterIds.length}, users=${userIds.length}`);
  } catch (error) {
    addEvidence(phaseReports.persistence, `Cleanup failed; manual scoped cleanup may be needed for runId=${runId}: ${sanitize(error instanceof Error ? error.message : error)}`);
  }
}

// Traceability for the acceptance report: which commit was under test and
// whether the working tree carried uncommitted changes when the run executed.
function gitInfo() {
  const silent = { stdio: ["ignore", "pipe", "ignore"] };
  try {
    const commitSha = (process.env.GITHUB_SHA
      || execSync("git rev-parse HEAD", silent).toString().trim()
      || "unknown").slice(0, 40);
    const workingTreeDirty = execSync("git status --porcelain", silent).toString().trim().length > 0;
    return { commitSha, workingTreeDirty };
  } catch {
    return { commitSha: process.env.GITHUB_SHA || "unknown", workingTreeDirty: null };
  }
}

async function writeReport() {
  const all = Object.values(phaseReports);
  const failed = all.some((item) => item.status === statuses.fail);
  const blocked = all.some((item) => item.status === statuses.blocked);
  const partialResult = all.some((item) => item.status === statuses.partial || item.status === statuses.notRun);
  const totalStatus = blocked
    ? statuses.blocked
    : failed
      ? statuses.fail
      : partialResult
        ? statuses.partial
        : statuses.pass;
  const report = {
    runId,
    totalStatus,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    underTest: gitInfo(),
    qualityMode: qualityQuery
      ? { enabled: true, query: qualityQuery, modelRequestTimeoutMs: qualityModelRequestTimeoutMs }
      : { enabled: false },
    phases: phaseReports,
  };
  const markdown = [
    `# Signal Map Agent Loop E2E`,
    ``,
    `- Run ID: \`${runId}\``,
    `- Total: \`${totalStatus}\``,
    `- Duration: \`${report.durationMs}ms\``,
    ``,
    ...Object.values(phaseReports).flatMap((item) => [
      `## ${item.name}: ${item.status}`,
      ``,
      `- requestId: \`${item.requestId || "n/a"}\``,
      `- HTTP: \`${item.httpStatus ?? "n/a"}\``,
      `- lastPhase: \`${item.lastPhase || "n/a"}\``,
      `- failure: ${item.failureReason || "none"}`,
      `- evidence:`,
      ...item.evidence.map((entry) => `  - ${entry}`),
      ``,
    ]),
  ].join("\n");
  await writeFile(reportPathJson, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(reportPathMd, markdown);
  let stepSummary = markdown;
  if (qualityQuery && !qualityReport) {
    qualityReport = emptyQualityReport(
      statuses.blocked,
      "quality_query was provided, but quality research did not run before the E2E harness stopped",
      { lastPhase: "quality_not_started" },
    );
  }
  if (qualityReport) {
    const qualityMd = qualityMarkdown(qualityReport);
    await writeFile(qualityReportPathJson, `${JSON.stringify(qualityReport, null, 2)}\n`);
    await writeFile(qualityReportPathMd, qualityMd);
    stepSummary = `${markdown}\n${qualityMd}`;
    console.log(qualityMd);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, stepSummary);
  }
  console.log(markdown);
  if (totalStatus !== statuses.pass) process.exitCode = 1;
}

async function main() {
  try {
    if (!await phase0SafetyCheck()) return;

    try {
      const db = await connectDb();
      await db.query("SELECT 1 AS ok");
      const appliedMigrations = await applyMigrations();
      addEvidence(phaseReports.runtimeDb, `Idempotent migrations applied after safety gate: ${appliedMigrations.join(", ")}`);
      await verifySchemaReady();
      startServer();
      const health = await waitForHealth();
      pass(phaseReports.runtimeDb, {
        httpStatus: health.status,
        lastPhase: "server_started",
      });
      addEvidence(phaseReports.runtimeDb, "Node server start PASS; PostgreSQL connect PASS; SELECT 1 PASS");
    } catch (error) {
      fail(phaseReports.runtimeDb, sanitize(error instanceof Error ? error.message : error), { lastPhase: "runtime_db" });
      return;
    }

    const accountA = new HttpSession("Account A");
    const accountB = new HttpSession("Account B");
    try {
      const userA = await login(accountA, process.env.TEST_ACCOUNT_A_EMAIL, process.env.TEST_ACCOUNT_A_PASSWORD);
      const userB = await login(accountB, process.env.TEST_ACCOUNT_B_EMAIL, process.env.TEST_ACCOUNT_B_PASSWORD);
      created.userIds.add(userA.id);
      created.userIds.add(userB.id);
      if (userA.id === userB.id) throw new Error("Account A and B resolved to the same Supabase user id");
      acceptanceSessions = [accountA, accountB];
      await readControl(accountA, "/api/control/knowledge?summary=1", phaseReports.authTenant);
      await readControl(accountA, "/api/control/goals", phaseReports.authTenant);
      await readControl(accountA, "/api/control/follows", phaseReports.authTenant);
      const forbidden = await accountA.request(`/api/control/knowledge?filterId=${encodeURIComponent(`account-${userB.id}`)}&user_id=${encodeURIComponent(userB.id)}`);
      if (![401, 403].includes(forbidden.status)) {
        throw new Error(`client user_id escalation was not rejected: HTTP ${forbidden.status}`);
      }
      pass(phaseReports.authTenant, { httpStatus: 200, lastPhase: "tenant_isolation_checked" });
      addEvidence(phaseReports.authTenant, `client user_id escalation rejected with HTTP ${forbidden.status}`);
    } catch (error) {
      fail(phaseReports.authTenant, sanitize(error instanceof Error ? error.message : error), { lastPhase: "auth_tenant" });
      return;
    }

    const filterA = `filter-${runId}-a`;
    const filterB = `filter-${runId}-b`;
    try {
      const followA = await createFollow(accountA, filterA, `OpenAI video capability watch ${runId}`);
      const followB = await createFollow(accountB, filterB, `Anthropic agent capability watch ${runId}`);
      addEvidence(phaseReports.persistence, `Created Account A follow ${followA.data.follow.id}`);
      addEvidence(phaseReports.persistence, `Created Account B follow ${followB.data.follow.id}`);
      await seedKnowledge(accountA.user.id, filterA);
      const beforeRestartKnowledge = await readControl(accountA, `/api/control/knowledge?summary=1&filterId=${encodeURIComponent(filterA)}`, phaseReports.persistence);
      if (!JSON.stringify(beforeRestartKnowledge.data).includes(runId)) throw new Error("Seeded knowledge was not readable before restart");
      const stopResult = await stopServer();
      if (!stopResult.stopped) throw new Error(`Old server process exit could not be confirmed: ${JSON.stringify(stopResult)}`);
      startServer();
      await waitForHealth();
      const afterRestartKnowledge = await readControl(accountA, `/api/control/knowledge?summary=1&filterId=${encodeURIComponent(filterA)}`, phaseReports.persistence);
      const afterRestartFollows = await readControl(accountA, `/api/control/follows?filterId=${encodeURIComponent(filterA)}`, phaseReports.persistence);
      if (!JSON.stringify(afterRestartKnowledge.data).includes(runId)) throw new Error("Seeded knowledge was not readable after restart");
      if (!JSON.stringify(afterRestartFollows.data).includes(runId)) throw new Error("Follow was not readable after restart");
      const bFollows = await readControl(accountB, `/api/control/follows?filterId=${encodeURIComponent(filterB)}`, phaseReports.persistence);
      const aSeesB = await accountA.request(`/api/control/follows?filterId=${encodeURIComponent(filterB)}`);
      if (aSeesB.status !== 403) throw new Error(`Account A could access Account B filter: HTTP ${aSeesB.status}`);
      if (!JSON.stringify(bFollows.data).includes(runId)) throw new Error("Account B follow was not readable by Account B");
      pass(phaseReports.persistence, { httpStatus: 200, lastPhase: "restart_readback" });
      addEvidence(phaseReports.persistence, "Persistence survived Node restart and tenant filter isolation held");
    } catch (error) {
      fail(phaseReports.persistence, sanitize(error instanceof Error ? error.message : error), { lastPhase: "persistence" });
      return;
    }


    await runQualityAcceptance(accountA);

    let firstRun = null;
    try {
      firstRun = await runSignals(accountA, filterA, "first");
      record(phaseReports.realResearch, {
        requestId: firstRun.summary.requestId,
        httpStatus: firstRun.summary.status,
        lastPhase: firstRun.lastPhase,
      });
      addEvidence(phaseReports.realResearch, `Signals response: ${JSON.stringify(firstRun.summary)}`);
      addEvidence(phaseReports.realResearch, `Trace phases: ${firstRun.phases.join(" -> ")}`);
      const runs = await latestAgentRuns(accountA, filterA);
      const latest = runs[0];
      addEvidence(phaseReports.realResearch, `Persisted agent runs after first research: ${runs.length}`);
      if (firstRun.summary.status !== 200) {
        fail(phaseReports.realResearch, `Research HTTP ${firstRun.summary.status}: ${firstRun.summary.errorCode || firstRun.summary.error || "unknown"}`);
        return;
      }
      if (!includesResearchChain(firstRun.phases)) {
        partial(phaseReports.realResearch, "Research returned but trace does not prove the complete required chain");
      } else if (!latest) {
        partial(phaseReports.realResearch, "Research returned but no persisted run metadata was readable");
      } else {
        pass(phaseReports.realResearch);
      }
    } catch (error) {
      fail(phaseReports.realResearch, sanitize(error instanceof Error ? error.message : error), {
        requestId: firstRun?.summary?.requestId ?? null,
        httpStatus: firstRun?.summary?.status ?? null,
        lastPhase: firstRun?.lastPhase ?? "real_research",
      });
      return;
    }

    try {
      const secondRun = await runSignals(accountA, filterA, "second");
      record(phaseReports.statefulSecondRun, {
        requestId: secondRun.summary.requestId,
        httpStatus: secondRun.summary.status,
        lastPhase: secondRun.lastPhase,
      });
      addEvidence(phaseReports.statefulSecondRun, `Signals response: ${JSON.stringify(secondRun.summary)}`);
      addEvidence(phaseReports.statefulSecondRun, `Trace phases: ${secondRun.phases.join(" -> ")}`);
      const runs = await latestAgentRuns(accountA, filterA);
      const latest = runs[0];
      addEvidence(phaseReports.statefulSecondRun, `Readable persisted run count after second research: ${runs.length}`);
      addEvidence(phaseReports.statefulSecondRun, `Latest run status=${latest?.status || "missing"} evidenceCount=${latest?.evidenceCount ?? "n/a"} knowledgeChanges=${Array.isArray(latest?.knowledgeChanges) ? latest.knowledgeChanges.length : "n/a"}`);
      const lastTraceEntry = Array.isArray(latest?.trace) ? latest.trace.at(-1) : null;
      statefulSecondRunForQuality = {
        requestId: secondRun.summary.requestId,
        httpStatus: secondRun.summary.status,
        lastPhase: secondRun.lastPhase,
        latestStatus: latest?.status || "missing",
        evidenceCount: latest?.evidenceCount,
        knowledgeChanges: Array.isArray(latest?.knowledgeChanges) ? latest.knowledgeChanges.length : undefined,
        traceStates: Array.isArray(latest?.trace) ? latest.trace.map((entry) => entry.state) : undefined,
        reason: lastTraceEntry?.reason || lastTraceEntry?.result || latest?.status || secondRun.summary.errorCode || secondRun.summary.error,
      };
      if (qualityReport?.state) {
        qualityReport.state.statefulSecondRun = statefulSecondRunDiagnostics(statefulSecondRunForQuality);
      }
      if (secondRun.summary.status !== 200) {
        fail(phaseReports.statefulSecondRun, `Second research HTTP ${secondRun.summary.status}: ${secondRun.summary.errorCode || secondRun.summary.error || "unknown"}`);
        return;
      }
      if (!runShowsKnowledgeUse(latest)) {
        partial(phaseReports.statefulSecondRun, "Second run completed but trace does not prove old Knowledge was used");
      } else if (!Array.isArray(latest?.knowledgeChanges)) {
        partial(phaseReports.statefulSecondRun, "Second run completed but readable comparison output was missing");
      } else {
        pass(phaseReports.statefulSecondRun);
      }
    } catch (error) {
      fail(phaseReports.statefulSecondRun, sanitize(error instanceof Error ? error.message : error), { lastPhase: "stateful_second_run" });
    }

    try {
      const harnessSession = new HttpSession("Account A (ten-query)");
      await login(harnessSession, process.env.TEST_ACCOUNT_A_EMAIL, process.env.TEST_ACCOUNT_A_PASSWORD);
      acceptanceSessions.push(harnessSession);
      await runAuthenticatedAcceptance({
        ownerSession: harnessSession,
        otherUserSession: accountB,
        runDependent: async ({ ownerSession, otherUserSession }) => {
          const siblingFilterId = `filter-${runId}-a2`;
          const followA2 = await createFollow(ownerSession, siblingFilterId, `Sibling isolation filter ${runId}`);
          created.filterIds.add(siblingFilterId);
          addEvidence(phaseReports.tenQuery, `Created sibling isolation filter ${followA2.data.follow.id}`);
          const scenarioConfigResult = await loadScenarioConfig(scenarioConfigPath);
          if (scenarioConfigResult.config) {
            addEvidence(phaseReports.tenQuery, `Scenario config loaded: ${scenarioConfigPath}`);
          } else if (scenarioConfigPath) {
            addEvidence(phaseReports.tenQuery, `Scenario config unavailable (${scenarioConfigResult.reason}); built-in sequence in use`);
          }
          await runTenQuerySequence(ownerSession, filterA, {
            captureDir: captureDir,
            commitSha: gitInfo().commitSha,
            siblingFilterId,
            otherUserSession,
            otherUserFilterId: filterB,
            scenarioConfig: scenarioConfigResult.config,
          });
        },
      });
    } catch (error) {
      fail(phaseReports.tenQuery, sanitize(error instanceof Error ? error.message : error), { lastPhase: "ten_query_sequence" });
    }
  } finally {
    // Convention: log out every created acceptance session AFTER the last
    // dependent scenario. logoutAllSessions is tolerant and never throws, so a
    // single logout failure cannot block the remaining cleanup or overwrite the
    // original business failure. Runs before cleanup/stopServer so the server
    // is still up to answer the logout HTTP calls.
    const logoutResult = await logoutAllSessions(acceptanceSessions, {
      logout: (session) => session.request("/api/auth/logout", { method: "POST" }),
    });
    for (const entry of logoutResult.loggedOut) {
      addEvidence(phaseReports.authTenant, `Finalize logout ${entry.label} HTTP ${entry.httpStatus}`);
    }
    for (const label of logoutResult.failures) {
      addEvidence(phaseReports.authTenant, `Finalize logout ${label} FAILED`);
    }
    await cleanup();
    await stopServer();
    if (dbClient) {
      await dbClient.end().catch(() => undefined);
      dbClient = null;
    }
    await writeReport();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const replayIndex = argv.indexOf("--offline-replay");
  if (replayIndex !== -1) {
    // Offline replay entry: pure file operations against a capture artifact.
    // No providers, no database, no server. Writes a standalone replay report.
    const capturePath = argv[replayIndex + 1];
    const entityIndex = argv.indexOf("--entity");
    const entity = entityIndex !== -1 ? argv[entityIndex + 1] : undefined;
    runOfflineReplay({ capturePath, entity, sourceMaterial: capturePath })
      .then(async (result) => {
        const report = {
          kind: "OFFLINE_REPLAY_REPORT",
          generatedAt: new Date().toISOString(),
          capturePath,
          entity: entity ?? null,
          ...result,
        };
        await writeFile("signal-map-replay-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
        console.log(JSON.stringify(report));
        process.exitCode = result.closed ? 0 : 1;
      })
      .catch((error) => {
        console.error(sanitize(error instanceof Error ? error.message : error));
        process.exitCode = 1;
      });
  } else {
    main().catch(async (error) => {
      fail(phaseReports.runtimeDb, sanitize(error instanceof Error ? error.message : error), { lastPhase: "uncaught" });
      await writeReport();
      process.exitCode = 1;
    });
  }
}

export {
  ACCEPTANCE_QUALITY_REQUEST_COUNT,
  ACCEPTANCE_RESEARCH_REQUEST_COUNT,
  ACCEPTANCE_SEQUENCE_LENGTH,
  attemptDiagnostics,
  attemptTraceGroups,
  buildReplayEvidenceForAcceptance,
  classifyQueryOutcome,
  computeCaptureDigest,
  deriveGainClassification,
  evaluateDuplicateCase,
  evaluatePreferenceAttribution,
  evaluatePreferenceIsolation,
  runAuthenticatedAcceptance,
  factFingerprint,
  factStateUnchanged,
  hasHighAttention,
  hasLowAttention,
  isProcessAlive,
  knowledgeCountFromState,
  loadCaptureMaterial,
  loadScenarioConfig,
  buildReplayEvidenceFromCapture,
  logoutAllSessions,
  prepareAcceptanceSessions,
  runOfflineReplay,
  qualityAcceptance,
  qualityMarkdown,
  producedEvidenceCountFromResponseData,
  rejectionAccounting,
  runCumulativeDiagnostics,
  actionabilityDiagnostics,
  scopedKnowledgeState,
  selectRunForRequest,
  stopProcessLike,
  confirmServerIdentity,
  executeAndBindQuery,
  replayEvidenceMaterialValid,
  runPreferenceIsolationScenarios,
  writeRunCapture,
};
