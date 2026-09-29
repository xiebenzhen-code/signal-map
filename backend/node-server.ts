import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import {
  handleAuthLogin,
  handleAuthLogout,
  handleAuthMe,
  handleAuthPasswordReset,
  handleAuthPasswordRecovery,
  handleAuthPasswordUpdate,
  handleConnections,
  handleControlAgentRuns,
  handleControlFollows,
  handleControlGoalAction,
  handleControlGoals,
  handleControlKnowledge,
  handleControlNotificationRead,
  handleControlNotifications,
  handlePreference,
  handleResearchAgent,
  handleResearchPlan,
  handleResearchStream,
  handleSignals,
  handleSocialPost,
  handleSocialProfile,
} from "./handlers.ts";
import { handlePostgresTransportProbe } from "./postgres-transport-probe.ts";

const port = Number.parseInt(process.env.PORT || "8080", 10);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const allowedOrigin = process.env.SIGNAL_MAP_ALLOWED_ORIGIN || "*";
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : origin === allowedOrigin ? origin : allowedOrigin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return headers;
}

function withCors(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  corsHeaders(request).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleBackendRequest(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (!["GET", "POST"].includes(request.method)) {
    return withCors(Response.json({ error: "Method not allowed" }, { status: 405 }), request);
  }

  const url = new URL(request.url);
  let response: Response;

  if (url.pathname === "/health") {
    response = Response.json({
      status: "ok",
      instanceId: process.env.SIGNAL_MAP_SERVER_INSTANCE_ID ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  } else if (url.pathname === "/api/signals") {
    response = await handleSignals(request);
  } else if (url.pathname === "/api/auth/login") {
    response = await handleAuthLogin(request);
  } else if (url.pathname === "/api/auth/logout") {
    response = await handleAuthLogout(request);
  } else if (url.pathname === "/api/auth/me") {
    response = await handleAuthMe(request);
  } else if (url.pathname === "/api/auth/password-reset") {
    response = await handleAuthPasswordReset(request);
  } else if (url.pathname === "/api/auth/password-update") {
    response = await handleAuthPasswordUpdate(request);
  } else if (url.pathname === "/api/auth/password-recovery") {
    response = await handleAuthPasswordRecovery(request);
  } else if (url.pathname === "/api/connections") {
    response = await handleConnections();
  } else if (url.pathname === "/api/diagnostics/postgres-transport") {
    response = await handlePostgresTransportProbe(request);
  } else if (url.pathname === "/api/research/plan") {
    response = await handleResearchPlan(request);
  } else if (url.pathname === "/api/research/agent") {
    response = await handleResearchAgent(request);
  } else if (url.pathname === "/api/research/stream") {
    response = await handleResearchStream(request);
  } else if (url.pathname === "/api/control/goals") {
    response = await handleControlGoals(request);
  } else if (url.pathname === "/api/control/follows") {
    response = await handleControlFollows(request);
  } else if (url.pathname === "/api/control/notifications") {
    response = await handleControlNotifications(request);
  } else if (url.pathname === "/api/control/knowledge") {
    response = await handleControlKnowledge(request);
  } else if (url.pathname === "/api/preferences") {
    response = await handlePreference(request);
  } else if (url.pathname === "/api/control/agent-runs") {
    response = await handleControlAgentRuns(request);
  } else {
    const controlGoalMatch = url.pathname.match(/^\/api\/control\/goals\/([^/]+)$/);
    const controlActionMatch = url.pathname.match(/^\/api\/control\/goals\/([^/]+)\/(resume|pause|abandon)$/);
    const notificationReadMatch = url.pathname.match(/^\/api\/control\/notifications\/([^/]+)\/read$/);
    const postMatch = url.pathname.match(/^\/api\/social\/([^/]+)\/posts\/([^/]+)$/);
    const profileMatch = url.pathname.match(/^\/api\/social\/([^/]+)\/profiles\/([^/]+)$/);
    if (controlGoalMatch) {
      response = await handleControlGoals(request, decodeURIComponent(controlGoalMatch[1]));
    } else if (controlActionMatch) {
      response = await handleControlGoalAction(
        request,
        decodeURIComponent(controlActionMatch[1]),
        controlActionMatch[2] as "resume" | "pause" | "abandon",
      );
    } else if (notificationReadMatch) {
      response = await handleControlNotificationRead(request, decodeURIComponent(notificationReadMatch[1]));
    } else if (postMatch) {
      response = await handleSocialPost(decodeURIComponent(postMatch[1]), decodeURIComponent(postMatch[2]));
    } else if (profileMatch) {
      response = await handleSocialProfile(decodeURIComponent(profileMatch[1]), decodeURIComponent(profileMatch[2]));
    } else {
      response = Response.json({ error: "Not found" }, { status: 404 });
    }
  }

  return withCors(response, request);
}

async function writeResponse(response: Response, target: ServerResponse) {
  target.statusCode = response.status;
  response.headers.forEach((value, key) => { if (key !== "set-cookie") target.setHeader(key, value); });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) target.setHeader("Set-Cookie", cookies);

  if (!response.body) {
    target.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      target.write(value);
    }
  } finally {
    target.end();
  }
}

function requestUrl(request: IncomingMessage) {
  const host = request.headers.host || `127.0.0.1:${port}`;
  return `http://${host}${request.url || "/"}`;
}

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export function startBackendServer() {
  return createServer(async (request, response) => {
    try {
      const body = request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await requestBody(request);
      const webRequest = new Request(requestUrl(request), {
        method: request.method,
        headers: request.headers as HeadersInit,
        body,
      });
      await writeResponse(await handleBackendRequest(webRequest), response);
    } catch {
      await writeResponse(Response.json({ error: "Internal server error" }, { status: 500 }), response);
    }
  }).listen(port, () => {
    console.log(`Signal Map API listening on http://0.0.0.0:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startBackendServer();
}
