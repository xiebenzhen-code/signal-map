import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import pg from "pg";

const { Client } = pg;

const startedAt = Date.now();
const runId = `gha-agent-loop-${randomUUID()}`;
const port = Number.parseInt(process.env.PORT || "18080", 10);
const baseUrl = `http://127.0.0.1:${port}`;
const origin = process.env.SIGNAL_MAP_ALLOWED_ORIGIN || baseUrl;
const reportPathJson = "signal-map-agent-loop-e2e-report.json";
const reportPathMd = "signal-map-agent-loop-e2e-report.md";

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

const serverLogs = [];
const created = {
  runId,
  filterIds: new Set(),
  userIds: new Set(),
};

let serverProcess = null;
let dbClient = null;

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

function startServer() {
  if (serverProcess) throw new Error("Server already running");
  serverLogs.length = 0;
  serverProcess = spawn(process.execPath, ["dist-api/server.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      SIGNAL_MAP_ALLOWED_ORIGIN: origin,
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

function summarizeSignalResponse(response) {
  const data = response.data || {};
  return {
    requestId: response.requestId || data.requestId || null,
    status: response.status,
    durationMs: response.durationMs,
    signalCount: Array.isArray(data.signals) ? data.signals.length : 0,
    dataMode: data.dataMode || null,
    evidenceCount: Array.isArray(data.signals)
      ? data.signals.reduce((count, signal) => count + (Array.isArray(signal.claims) ? signal.claims.length : 0), 0)
      : 0,
    errorCode: data.errorCode || null,
    error: data.error || null,
  };
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
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown);
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

main().catch(async (error) => {
  fail(phaseReports.runtimeDb, sanitize(error instanceof Error ? error.message : error), { lastPhase: "uncaught" });
  await writeReport();
  process.exitCode = 1;
});
