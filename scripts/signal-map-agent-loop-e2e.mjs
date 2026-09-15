import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import pg from "pg";

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
};

let qualityReport = null;

const serverLogs = [];
const created = {
  runId,
  filterIds: new Set(),
  userIds: new Set(),
};

let serverProcess = null;
let dbClient = null;
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

async function verifySchemaReady() {
  const expectedTables = [
    "filters",
    "personal_knowledge",
    "research_context_revisions",
    "research_run_metadata",
    "goals",
    "notifications",
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
  serverProcess = spawn(process.execPath, ["dist-api/server.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      SIGNAL_MAP_ALLOWED_ORIGIN: origin,
      ...envOverrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
}

async function stopServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
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
          }];
        }
        return sources.slice(0, 3).map((source) => ({
          signal: signal.title,
          claim: claim.claimText,
          source: source.sourceUrl,
          publisher: source.publisher,
          snippet: source.evidenceSnippet,
          verificationStatus: source.verificationStatus,
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
  const latestPreservation = hasPreservation ? preservation.perRound.at(-1) : {};
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
  const observedReasons = hasPreservation ? latestPreservation.rejectionReason : accounting.rejectionReasons;
  const rejectionReasonOccurrences = observedReasons && typeof observedReasons === "object"
    ? Object.values(observedReasons).reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0)
    : undefined;
  const classifiedRejectedEvidenceCount = Number.isFinite(rejectedEvidenceCount) && Number.isFinite(rejectionReasonOccurrences)
    ? Math.min(rejectedEvidenceCount, rejectionReasonOccurrences)
    : undefined;
  const unclassifiedRejectedEvidenceCount = Number.isFinite(rejectedEvidenceCount) && Number.isFinite(classifiedRejectedEvidenceCount)
    ? Math.max(0, rejectedEvidenceCount - classifiedRejectedEvidenceCount)
    : undefined;
  const rejectionAccountingComplete = Number.isFinite(rejectedEvidenceCount)
    && Number.isFinite(rejectionReasonOccurrences)
    && rejectionReasonOccurrences === rejectedEvidenceCount
    && unclassifiedRejectedEvidenceCount === 0;
  return {
    candidateCount: unavailable(summary.clusteredCount ?? summary.filteringDetails?.length ?? data.overview?.events),
    discoveredCandidateCount: unavailable(accounting.discoveredCandidateCount ?? summary.retrievedCount ?? data.overview?.scanned),
    producedEvidenceCount: unavailable(producedEvidenceCount),
    producedEvidenceDataSource: Array.isArray(data.evidenceRecords) ? "ResearchResponse.evidenceRecords" : "unavailable",
    cumulativeEvidenceCount: unavailable(hasPreservation ? preservation.cumulativeEvidenceCount : accounting.cumulativeEvidenceCount),
    evaluatedEvidenceCount: unavailable(hasPreservation ? latestPreservation.evaluatedEvidenceCount : accounting.evaluatedEvidenceCount),
    acceptedEvidenceCount: unavailable(acceptedEvidenceCount ?? (preservation.acceptedEvidenceCount === "unavailable" ? latestRun?.evidenceCount ?? accepted.length : preservation.acceptedEvidenceCount)),
    rejectedEvidenceCount: unavailable(rejectedEvidenceCount),
    finalEvidenceCount: unavailable(hasPreservation ? preservation.finalEvidenceCount : (accounting.finalEvidenceCount ?? preservation.finalEvidenceCount)),
    rejectedReason: rejectionAccountingComplete ? observedReasons : "unavailable",
    rejectionReasonObserved: unavailable(observedReasons),
    primaryRejectionReasonCounts: unavailable(observedReasons),
    rejectionReasonOccurrences: unavailable(rejectionReasonOccurrences),
    classifiedRejectedEvidenceCount: unavailable(classifiedRejectedEvidenceCount),
    unclassifiedRejectedEvidenceCount: unavailable(unclassifiedRejectedEvidenceCount),
    rejectionAccountingComplete,
    run: {
      cumulativeEvidenceCount: unavailable(hasPreservation ? preservation.cumulativeEvidenceCount : accounting.cumulativeEvidenceCount),
      carriedForwardEvidenceCount: unavailable(hasPreservation ? preservation.carriedForwardEvidenceCount : undefined),
    },
    final: {
      acceptedEvidenceCount: unavailable(hasPreservation ? latestPreservation.acceptedEvidenceCount : accounting.acceptedEvidenceCount),
      finalEvidenceCount: unavailable(hasPreservation ? preservation.finalEvidenceCount : accounting.finalEvidenceCount),
    },
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
    run: { cumulativeEvidenceCount: "unavailable", carriedForwardEvidenceCount: "unavailable" },
    final: { acceptedEvidenceCount: "unavailable", finalEvidenceCount: "unavailable" },
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
      cumulativeEvidenceCount: "unavailable",
      evaluatedEvidenceCount: "unavailable",
      acceptedEvidenceCount: "unavailable",
      rejectedEvidenceCount: "unavailable",
      finalEvidenceCount: "unavailable",
      rejectedReason: "unavailable",
      run: {
        cumulativeEvidenceCount: "unavailable",
        carriedForwardEvidenceCount: "unavailable",
      },
      final: {
        acceptedEvidenceCount: "unavailable",
        finalEvidenceCount: "unavailable",
      },
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
  return {
    generatedAt: new Date().toISOString(),
    reportSchemaVersion: 2,
    buildCommitSha: process.env.GITHUB_SHA || "unavailable",
    sourceTraceRequestId: signalRun.summary.requestId || "unavailable",
    attempts: search.attempts,
    run: { ...runCumulative, ...evidence.run },
    final: {
      ...evidence.final,
      displayedCount: signals.length,
      signalCount: signals.length,
    },
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
      snippet: unavailable(item.snippet),
    })),
    result: {
      finalNaturalLanguageConclusion: unavailable(data.finalConclusion || data.summary || data.answer),
      recommendedUserTests: unavailable(signals.map((signal) => signal.action).filter(Boolean)),
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
    `- runCumulative: ${compact(report.run, 1400)}`,
    `- finalResponse: ${compact(report.final, 800)}`,
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
    `- cumulativeEvidenceCount: ${compact(report.evidenceDiagnostics.preservation?.cumulativeEvidenceCount)}`,
    `- carriedForwardEvidenceCount: ${compact(report.evidenceDiagnostics.preservation?.carriedForwardEvidenceCount)}`,
    `- acceptedEvidenceCount: ${compact(report.evidenceDiagnostics.acceptedEvidenceCount)}`,
    `- rejectedEvidenceCount: ${compact(report.evidenceDiagnostics.rejectedEvidenceCount)}`,
    `- primaryRejectionReasonCounts: ${compact(report.evidenceDiagnostics.primaryRejectionReasonCounts)}`,
    `- rejectionReasonOccurrences: ${compact(report.evidenceDiagnostics.rejectionReasonOccurrences)}`,
    `- classifiedRejectedEvidenceCount: ${compact(report.evidenceDiagnostics.classifiedRejectedEvidenceCount)}`,
    `- unclassifiedRejectedEvidenceCount: ${compact(report.evidenceDiagnostics.unclassifiedRejectedEvidenceCount)}`,
    `- rejectionAccountingComplete: ${compact(report.evidenceDiagnostics.rejectionAccountingComplete)}`,
    `- rejectionAccountingComplete: ${compact(report.evidenceDiagnostics.rejectionAccountingComplete)}`,
    `- verificationOutcome: ${compact(report.evidenceDiagnostics.preservation?.verificationOutcome)}`,
    `- finalEvidenceCount: ${compact(report.evidenceDiagnostics.finalEvidenceCount)}`,
    `- rejectionReason: ${compact(report.evidenceDiagnostics.preservation?.rejectionReason, 1000)}`,
    `- rejected reason: ${compact(report.evidenceDiagnostics.rejectedReason, 1000)}`,
    `- observed rejection reason: ${compact(report.evidenceDiagnostics.rejectionReasonObserved, 1000)}`,
    `- run cumulative: ${compact(report.evidenceDiagnostics.run)}`,
    `- final: ${compact(report.evidenceDiagnostics.final)}`,
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
      await stopServer();
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
      const logoutA = await accountA.request("/api/auth/logout", { method: "POST" });
      const logoutB = await accountB.request("/api/auth/logout", { method: "POST" });
      addEvidence(phaseReports.authTenant, `Logout A HTTP ${logoutA.status}; Logout B HTTP ${logoutB.status}`);
    } catch (error) {
      fail(phaseReports.statefulSecondRun, sanitize(error instanceof Error ? error.message : error), { lastPhase: "stateful_second_run" });
    }
  } finally {
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
  main().catch(async (error) => {
    fail(phaseReports.runtimeDb, sanitize(error instanceof Error ? error.message : error), { lastPhase: "uncaught" });
    await writeReport();
    process.exitCode = 1;
  });
}

export { attemptDiagnostics, attemptTraceGroups, qualityAcceptance, qualityMarkdown, producedEvidenceCountFromResponseData };
