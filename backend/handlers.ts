import { planQuery } from "../research/query-planner.ts";
import type { CandidateSelectionAudit } from "../research/candidate-selection.ts";
import type { EligibilityAuditFunnel } from "../research/research-pipeline.ts";
import { runTaskPlannedAgent } from "../agent/task-runner.ts";
import { createEnvironmentModelAdapter } from "../agent/model-adapter.ts";
import { createSignalTracer, createSignalsRequestId, type SignalTracePhase } from "./signals-trace.ts";
import { requestSession, resolveAuthContext, withSession } from "../auth/session.ts";
import { resolveResearchIdentity } from "../auth/request-identity.ts";
import { mapAuthError } from "../auth/auth-error.ts";
import { executeResearch } from "../research/research-service.ts";
import {
  getControlAgentRuns,
  getControlGoals,
  getControlKnowledge,
  getControlNotifications,
  markControlNotificationRead,
  runGoalControlAction,
  type ControlRepository,
} from "./control-plane.ts";
import { createPostgresRepository, databaseConfigured } from "./postgres.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import type { AgentRunOptions } from "../agent/types.ts";
import { socialAccessLayer, type SocialProvider } from "../social/providers/index.ts";
import { toPublicConnectionStatus } from "../social/access/public-connection.ts";

type ProviderId = SocialProvider["id"];

const guestAgentRepository = new InMemorySignalRepository();
const SIGNALS_PERSISTENCE_TIMEOUT_MS = 4000;

export function operationTimeoutError(code: string) {
  return Object.assign(new Error(code), { code });
}

export async function withOperationTimeout<T>(operation: Promise<T>, timeoutMs: number, code: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(operationTimeoutError(code)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function agentRepository(): NonNullable<AgentRunOptions["repository"]> & ControlRepository {
  if (process.env.NODE_ENV === "production" && !databaseConfigured()) throw new Error("PostgreSQL is required for authenticated persistence");
  return databaseConfigured() ? createPostgresRepository() : guestAgentRepository;
}

function filterIdFromRequest(request: Request, userId: string, body?: Record<string, unknown>) {
  const params = new URL(request.url).searchParams;
  const bodyFilter = typeof body?.filterId === "string" ? body.filterId.trim() : "";
  return bodyFilter || params.get("filterId")?.trim() || `account-${userId}`;
}

async function ensureFilter(
  repository: ControlRepository,
  context: { authenticatedUserId: string; filterId: string },
  options: { createIfMissing: boolean },
) {
  if (await Promise.resolve(repository.filterBelongsTo(context))) return true;
  if (!options.createIfMissing) return false;
  await Promise.resolve(repository.saveFilter(context, {
    id: context.filterId,
    userId: context.authenticatedUserId,
    name: context.filterId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  return true;
}

async function authorizedContext(request: Request, repository: ControlRepository, options: { createFilterIfMissing?: boolean } = {}) {
  const auth = await resolveAuthContext(request);
  if (!auth) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const context = { authenticatedUserId: auth.userId, filterId: filterIdFromRequest(request, auth.userId) };
  const allowed = await ensureFilter(repository, context, { createIfMissing: options.createFilterIfMissing === true || context.filterId === `account-${auth.userId}` });
  if (!allowed) return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  return { context, auth };
}

function fieldValue(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join("\n").trim();
  return typeof value === "string" ? value.trim() : "";
}

function inputFromRecord(input: Record<string, unknown>) {
  return {
    identity: fieldValue(input.identity ?? input.role),
    industry: fieldValue(input.industry),
    focusAreas: fieldValue(input.focusAreas ?? input.interests),
    currentQuestions: fieldValue(input.currentQuestions),
    knownInformation: fieldValue(input.knownInformation ?? input.projects),
    informationGaps: fieldValue(input.informationGaps ?? input.gaps),
    trackedEntities: fieldValue(input.trackedEntities),
    trackedEvents: fieldValue(input.trackedEvents),
    userJudgements: fieldValue(input.userJudgements),
    evidenceHistory: fieldValue(input.evidenceHistory),
    freshnessWindow: fieldValue(input.freshnessWindow) || "7d",
    sourceScope: fieldValue(input.sourceScope) || "hybrid",
    customSources: fieldValue(input.customSources),
  };
}

async function bodyInput(request: Request) {
  if (request.method !== "POST") return null;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return null;
  return inputFromRecord(body as Record<string, unknown>);
}

async function bodyRecord(request: Request) {
  if (request.method !== "POST") return {};
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return {};
  const body = await request.clone().json().catch(() => null);
  return body && typeof body === "object" ? body as Record<string, unknown> : {};
}

async function researchInput(request: Request) {
  return await bodyInput(request) ?? inputFromRecord({});
}

function providerId(value: string): ProviderId | null {
  if (value === "x") return "x";
  if (value === "xiaohongshu") return "xiaohongshu";
  return null;
}

export const handleSignals = withSession(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const requestId = createSignalsRequestId(request.headers.get("X-Signal-Map-Request-Id"));
  const tracer = createSignalTracer(requestId);
  const deadlineAt = Date.now() + 25000;
  const markPhase = (event: { phase: string; success?: boolean; itemCount?: number; errorCode?: string }) => {
    const allowed = [
      "source_selection_started",
      "source_selection_finished",
      "search_started",
      "search_finished",
      "detail_fetch_started",
      "detail_fetch_finished",
      "aggregation_started",
      "aggregation_finished",
      "evidence_started",
      "evidence_finished",
      "agent_started",
      "agent_finished",
      "knowledge_started",
      "knowledge_finished",
      "persistence_started",
      "persistence_finished",
    ];
    if (allowed.includes(event.phase)) {
      tracer.mark({ phase: event.phase as SignalTracePhase, success: event.success, itemCount: event.itemCount, errorCode: event.errorCode });
    }
  };
  tracer.mark({ phase: "request_received" });
  const identity = await resolveResearchIdentity(request);
  tracer.mark({ phase: "auth_resolved", itemCount: identity.mode === "authenticated" ? 1 : 0 });
  const body = await bodyRecord(request);
  const input = inputFromRecord(body);
  tracer.mark({ phase: "request_parsed", success: Boolean(input.industry) });
  if (!input.industry) {
    const response = Response.json(
      { error: "Query Planner 缺少行业或自然语言需求。", requestId },
      { status: 400, headers: { "X-Signal-Map-Request-Id": requestId } },
    );
    return response;
  }

  try {
    const params = new URL(request.url).searchParams;
    const includeEligibilityAudit =
      process.env.NODE_ENV !== "production" &&
      ["candidate-selection", "eligibility"].includes(params.get("audit") || "");
    const auditOnly = includeEligibilityAudit && params.get("auditOnly") === "1";
    const auditEventId = includeEligibilityAudit ? (params.get("auditEventId") || "").trim() : "";
    let candidateSelectionAudit: CandidateSelectionAudit[] = [];
    let eligibilityFunnel: EligibilityAuditFunnel | undefined;

    let context: AgentRunOptions["context"];
    let repository: AgentRunOptions["repository"];
    if (identity.mode === "authenticated") {
      const persistentRepository = agentRepository();
      context = {
        authenticatedUserId: identity.id,
        filterId: filterIdFromRequest(request, identity.id, body),
      };
      tracer.mark({ phase: "persistence_started" });
      const persistenceTimeoutMs = Math.max(500, Math.min(SIGNALS_PERSISTENCE_TIMEOUT_MS, deadlineAt - Date.now() - 1000));
      const filterAllowed = await withOperationTimeout(ensureFilter(persistentRepository, context, {
        createIfMissing: context.filterId === `account-${identity.id}`,
      }), persistenceTimeoutMs, "DB_TIMEOUT");
      tracer.mark({ phase: "persistence_finished", success: filterAllowed, errorCode: filterAllowed ? undefined : "FORBIDDEN" });
      if (!filterAllowed) return Response.json({ error: "Forbidden" }, { status: 403, headers: { "X-Signal-Map-Request-Id": requestId } });
      repository = persistentRepository;
    }

    tracer.mark({ phase: "research_started" });
    const result = await executeResearch({ identity, input, context, repository,
      onPhase: markPhase,
      deadlineAt,
      modelAdapter: createEnvironmentModelAdapter(), debug: includeEligibilityAudit
      ? {
          onPhase: markPhase,
          deadlineAt,
          onCandidateSelectionAudit: (audit) => { candidateSelectionAudit = audit; },
          onEligibilityAudit: (audit) => { eligibilityFunnel = audit; },
        }
      : { onPhase: markPhase, deadlineAt } });
    tracer.mark({ phase: "research_finished" as SignalTracePhase, itemCount: result.signals.length });

    tracer.mark({ phase: "response_started" });
    const response = Response.json(auditOnly
      ? {
          overview: result.overview,
          requestId,
          debug: {
            candidateSelectionAudit: auditEventId
              ? candidateSelectionAudit.filter((audit) => audit.id === auditEventId)
              : candidateSelectionAudit,
            eligibilityFunnel,
          },
        }
      : includeEligibilityAudit
        ? { ...result, requestId, debug: { candidateSelectionAudit, eligibilityFunnel } }
        : { ...result, requestId }, {
      headers: { "Cache-Control": "no-store", "X-Signal-Map-Request-Id": requestId },
    });
    if (identity.mode === "anonymous" && identity.setCookie) response.headers.append("Set-Cookie", identity.setCookie);
    tracer.mark({ phase: "response_finished", itemCount: result.signals.length });
    return response;
  } catch (error) {
    const errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN_RESEARCH_FAILURE";
    tracer.mark({ phase: "response_started", success: false, errorCode });
    if (error && typeof error === "object" && "status" in error && Number(error.status) === 429) {
      const response = Response.json({ error: "查询过于频繁，请稍后再试。", requestId, errorCode: "RATE_LIMIT" }, { status: 429, headers: { "X-Signal-Map-Request-Id": requestId } });
      tracer.mark({ phase: "response_finished", success: false, errorCode: "RATE_LIMIT" });
      return response;
    }
    const response = Response.json(
      {
        error: "Research Pipeline 未能完成。",
        reason: "本轮来源检索暂时不可用，请稍后再试。",
        requestId,
        errorCode,
      },
      { status: 502, headers: { "X-Signal-Map-Request-Id": requestId } },
    );
    tracer.mark({ phase: "response_finished", success: false, errorCode });
    return response;
  }
});

export async function handleConnections() {
  const connections = (await socialAccessLayer.getConnectionStatuses())
    .map(toPublicConnectionStatus);
  return Response.json(
    { connections },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const handleResearchPlan = withSession(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (!await resolveAuthContext(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const input = await researchInput(request);
  if (!input.industry) {
    return Response.json({ error: "缺少自然语言需求" }, { status: 400 });
  }
  return Response.json(
    { queryPlan: planQuery(input) },
    { headers: { "Cache-Control": "no-store" } },
  );
});

export const handleResearchAgent = withSession(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const body = await bodyRecord(request);
  const input = inputFromRecord(body);
  if (!input.industry) {
    return Response.json({ error: "缺少自然语言需求" }, { status: 400 });
  }
  const auth = await resolveAuthContext(request);
  if (!auth) {
    return Response.json({ error: "请先使用测试账号登录" }, { status: 401 });
  }
  const filterId = filterIdFromRequest(request, auth.userId, body);
  const repository = agentRepository();
  const context = { authenticatedUserId: auth.userId, filterId };
  if (!await ensureFilter(repository, context, { createIfMissing: filterId === `account-${auth.userId}` })) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await runTaskPlannedAgent({
    input,
    context,
    repository,
    userQuery: input.currentQuestions || input.industry,
    modelAdapter: createEnvironmentModelAdapter(),
  });
  return Response.json(result.singleResult ?? result, {
    headers: { "Cache-Control": "no-store" },
  });
});

export const handleControlGoals = withSession(async (request: Request, goalId?: string) => {
  const repository = agentRepository();
  const auth = await authorizedContext(request, repository);
  if (auth.response) return auth.response;
  const result = await getControlGoals({ context: auth.context, repository, goalId });
  if (goalId && !result.goal) return Response.json({ error: "Goal not found" }, { status: 404 });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
});

export const handleControlGoalAction = withSession(async (request: Request, goalId: string, action: "resume" | "pause" | "abandon") => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const repository = agentRepository();
  const auth = await authorizedContext(request, repository);
  if (auth.response) return auth.response;
  const body = await bodyRecord(request);
  const result = await runGoalControlAction({
    context: auth.context,
    repository,
    goalId,
    action,
    requestInput: inputFromRecord(body),
  });
  if (result.status === "not_found") return Response.json({ error: result.reason }, { status: 404 });
  if (result.status === "rejected") return Response.json({ error: result.reason, goal: result.goal }, { status: 409 });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
});

export const handleControlNotifications = withSession(async (request: Request) => {
  const repository = agentRepository();
  const auth = await authorizedContext(request, repository);
  if (auth.response) return auth.response;
  return Response.json(await getControlNotifications({
    context: auth.context,
    repository,
  }), { headers: { "Cache-Control": "no-store" } });
});

export const handleControlKnowledge = withSession(async (request: Request) => {
  const repository = agentRepository();
  const auth = await authorizedContext(request, repository);
  if (auth.response) return auth.response;
  return Response.json(await getControlKnowledge({
    context: auth.context,
    repository,
  }), { headers: { "Cache-Control": "no-store" } });
});

export const handleControlAgentRuns = withSession(async (request: Request) => {
  const repository = agentRepository();
  const auth = await authorizedContext(request, repository);
  if (auth.response) return auth.response;
  return Response.json(await getControlAgentRuns({
    context: auth.context,
    repository,
  }), { headers: { "Cache-Control": "no-store" } });
});

export const handleControlNotificationRead = withSession(async (request: Request, notificationId: string) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const repository = agentRepository();
  const auth = await authorizedContext(request, repository);
  if (auth.response) return auth.response;
  const result = await markControlNotificationRead({ context: auth.context, repository, notificationId });
  if (!result.notification) return Response.json({ error: "Notification not found" }, { status: 404 });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
});

export const handleAuthLogin = withSession(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const body = await bodyRecord(request);
  const action = body.action === "signup" ? "signup" : "login";
  if (body.action && !["login", "signup"].includes(String(body.action))) return Response.json({ error: "不支持的认证操作" }, { status: 400 });
  const email = fieldValue(body.email ?? body.loginName);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !email.includes("@") || password.length < 6) return Response.json({ error: "请输入邮箱和至少 6 位密码" }, { status: 400 });
  const { client } = requestSession(request);
  if (!client) return Response.json({ error: "Supabase Auth 尚未配置" }, { status: 503 });
  const { data, error } = action === "signup"
    ? await client.auth.signUp({ email, password })
    : await client.auth.signInWithPassword({ email, password });
  if (error) {
    const mapped = mapAuthError(error, action);
    return Response.json({ error: mapped.error, code: mapped.code }, { status: mapped.status });
  }
  if (action === "signup" && data.user && !data.session) {
    return Response.json({ user: null, status: "verification_required" }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!data.session || !data.user || data.user.is_anonymous) return Response.json({ error: "无法建立账号会话" }, { status: 401 });
  return Response.json({ user: { id: data.user.id, mode: "authenticated" } }, { headers: { "Cache-Control": "no-store" } });
});

export const handleAuthMe = withSession(async (request: Request) => {
  const auth = await resolveAuthContext(request);
  return Response.json({ user: auth ? { id: auth.userId, mode: auth.mode } : null }, { headers: { "Cache-Control": "no-store" } });
});

export const handleAuthLogout = withSession(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const { client } = requestSession(request);
  if (!client) return Response.json({ error: "Supabase Auth 尚未配置" }, { status: 503 });
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) return Response.json({ error: "退出失败，请重试" }, { status: 503 });
  return Response.json({ ok: true }, { headers: { "Set-Cookie": "signal_map_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0" } });
});

export const handleAuthPasswordReset = withSession(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const body = await bodyRecord(request);
  const email = fieldValue(body.email ?? body.loginName);
  if (!email || !email.includes("@")) return Response.json({ error: "请输入有效邮箱" }, { status: 400 });
  const { client } = requestSession(request);
  if (!client) return Response.json({ error: "Supabase Auth 尚未配置" }, { status: 503 });
  const origin = new URL(request.url).origin;
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/reset-password` });
  if (error) {
    const mapped = mapAuthError(error, "login");
    return Response.json({ error: mapped.error, code: mapped.code }, { status: mapped.status });
  }
  // Keep account existence private: a valid request has the same success shape either way.
  return Response.json({ ok: true, status: "reset_requested" }, { headers: { "Cache-Control": "no-store" } });
});

export const handleAuthPasswordUpdate = withSession(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const body = await bodyRecord(request);
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 6) return Response.json({ error: "请输入至少 6 位新密码" }, { status: 400 });
  const { client } = requestSession(request);
  if (!client) return Response.json({ error: "Supabase Auth 尚未配置" }, { status: 503 });
  const auth = await resolveAuthContext(request);
  if (!auth) return Response.json({ error: "重置链接已失效，请重新请求密码重置" }, { status: 401 });
  const { error } = await client.auth.updateUser({ password });
  if (error) return Response.json({ error: "新密码未更新，请重新请求密码重置", code: "password_update_failed" }, { status: 400 });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});

function mapRecoveryError(error: { code?: string; message?: string; status?: number }) {
  const detail = `${String(error.code || "").toLowerCase()} ${String(error.message || "").toLowerCase()}`;
  if (/expired/.test(detail)) {
    return { status: 401, code: "recovery_token_expired", error: "重置链接已过期，请重新请求密码重置。" };
  }
  if (/invalid|not found|otp|token/.test(detail)) {
    return { status: 401, code: "invalid_recovery_token", error: "重置链接无效，请重新请求密码重置。" };
  }
  if ((error.status || 0) >= 500) {
    return { status: 503, code: "recovery_session_failed", error: "认证服务暂时不可用，请稍后重试。" };
  }
  return { status: 401, code: "recovery_session_failed", error: "无法建立密码重置会话，请重新请求。" };
}

export const handleAuthPasswordRecovery = withSession(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const body = await bodyRecord(request);
  const tokenHash = typeof body.token_hash === "string" ? body.token_hash.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim() : "";
  if (type !== "recovery") {
    return Response.json({ error: "重置链接类型无效，请重新请求密码重置。", code: "invalid_recovery_token" }, { status: 400 });
  }
  if (!tokenHash) {
    return Response.json({ error: "重置链接缺少验证信息，请重新请求密码重置。", code: "invalid_recovery_token" }, { status: 400 });
  }
  const { client } = requestSession(request);
  if (!client) return Response.json({ error: "Supabase Auth 尚未配置" }, { status: 503 });
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
  if (error) {
    const mapped = mapRecoveryError(error);
    return Response.json({ error: mapped.error, code: mapped.code }, { status: mapped.status });
  }
  if (!data.session || !data.user || data.user.is_anonymous) {
    return Response.json({ error: "无法建立密码重置会话，请重新请求。", code: "recovery_session_failed" }, { status: 401 });
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});

export const handleResearchStream = withSession(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (!await resolveAuthContext(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const input = await researchInput(request);
  if (!input.industry) {
    return Response.json(
      { error: "Query Planner 缺少行业或自然语言需求。" },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        const { runResearchPipeline } = await import("../research/research-pipeline.ts");
        const result = await runResearchPipeline(input, (progress) => send("progress", progress));
        send("result", result);
      } catch {
        send("pipeline_error", {
          error: "Research Pipeline 未能完成。",
          reason: "本轮来源检索暂时不可用，请稍后再试。",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});

export async function handleSocialPost(providerValue: string, id: string) {
  const provider = providerId(providerValue);
  if (!provider) return Response.json({ error: "Unknown provider" }, { status: 404 });

  try {
    const post = await socialAccessLayer.getPost(provider, id);
    return post
      ? Response.json({ post }, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: "Post not found or provider unavailable" }, { status: 404 });
  } catch {
    return Response.json({ error: "Provider temporarily unavailable" }, { status: 502 });
  }
}

export async function handleSocialProfile(providerValue: string, id: string) {
  const provider = providerId(providerValue);
  if (!provider) return Response.json({ error: "Unknown provider" }, { status: 404 });

  try {
    const profile = await socialAccessLayer.getProfile(provider, id);
    return profile
      ? Response.json({ profile }, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: "Profile not found or provider unavailable" }, { status: 404 });
  } catch {
    return Response.json({ error: "Provider temporarily unavailable" }, { status: 502 });
  }
}
