import { planQuery } from "../research/query-planner.ts";
import type { CandidateSelectionAudit } from "../research/candidate-selection.ts";
import type { EligibilityAuditFunnel } from "../research/research-pipeline.ts";
import { runTaskPlannedAgent } from "../agent/task-runner.ts";
import { createEnvironmentModelAdapter } from "../agent/model-adapter.ts";
import { requestSession, resolveAuthContext, withSession } from "../auth/session.ts";
import {
  getControlAgentRuns,
  getControlGoals,
  getControlKnowledge,
  getControlNotifications,
  markControlNotificationRead,
  runGoalControlAction,
  type ControlRepository,
} from "./control-plane.ts";
import { createPostgresRepository, databaseConfigured, getPostgresPool } from "./postgres.ts";
import { InMemorySignalRepository } from "../information/repositories/in-memory.ts";
import type { AgentRunOptions } from "../agent/types.ts";
import { socialAccessLayer, type SocialProvider } from "../social/providers/index.ts";
import { toPublicConnectionStatus } from "../social/access/public-connection.ts";

type ProviderId = SocialProvider["id"];

const guestAgentRepository = new InMemorySignalRepository();

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
  if (!await resolveAuthContext(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const input = await researchInput(request);
  if (!input.industry) {
    return Response.json(
      { error: "Query Planner 缺少行业或自然语言需求。" },
      { status: 400 },
    );
  }

  try {
    const { runResearchPipeline } = await import("../research/research-pipeline.ts");
    const params = new URL(request.url).searchParams;
    const includeEligibilityAudit =
      process.env.NODE_ENV !== "production" &&
      ["candidate-selection", "eligibility"].includes(params.get("audit") || "");
    const auditOnly = includeEligibilityAudit && params.get("auditOnly") === "1";
    const auditEventId = includeEligibilityAudit ? (params.get("auditEventId") || "").trim() : "";
    let candidateSelectionAudit: CandidateSelectionAudit[] = [];
    let eligibilityFunnel: EligibilityAuditFunnel | undefined;

    const result = await runResearchPipeline(input, undefined, includeEligibilityAudit
      ? {
          onCandidateSelectionAudit: (audit) => { candidateSelectionAudit = audit; },
          onEligibilityAudit: (audit) => { eligibilityFunnel = audit; },
        }
      : undefined);

    return Response.json(auditOnly
      ? {
          overview: result.overview,
          debug: {
            candidateSelectionAudit: auditEventId
              ? candidateSelectionAudit.filter((audit) => audit.id === auditEventId)
              : candidateSelectionAudit,
            eligibilityFunnel,
          },
        }
      : includeEligibilityAudit
        ? { ...result, debug: { candidateSelectionAudit, eligibilityFunnel } }
        : result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        error: "Research Pipeline 未能完成。",
        reason: "本轮来源检索暂时不可用，请稍后再试。",
      },
      { status: 502 },
    );
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

async function pingConfiguredDatabase() {
  if (!databaseConfigured()) return false;
  try {
    await getPostgresPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function handleRuntimeStatus(databasePing = pingConfiguredDatabase) {
  return Response.json({
    databaseUrlPresent: Boolean(process.env.DATABASE_URL),
    deepseekApiKeyPresent: Boolean(process.env.DEEPSEEK_API_KEY),
    databaseConnectionOk: await databasePing(),
  }, { headers: { "Cache-Control": "no-store" } });
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
  if (body.action && body.action !== "login") return Response.json({ error: "Alpha 不开放注册" }, { status: 403 });
  const email = fieldValue(body.email ?? body.loginName);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !email.includes("@") || password.length < 6) return Response.json({ error: "请输入邮箱和至少 6 位密码" }, { status: 400 });
  const { client } = requestSession(request);
  if (!client) return Response.json({ error: "Supabase Auth 尚未配置" }, { status: 503 });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    return Response.json({ error: "登录失败，请检查邮箱和密码" }, { status: 401 });
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
