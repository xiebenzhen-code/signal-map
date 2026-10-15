// Proxy layer that keeps node-postgres out of the workerd RSC runtime.
//
// The Vinext dev server and the app's /api/* route handlers run on workerd,
// which cannot create raw outbound TCP sockets. node-postgres (pg) needs
// node:net/tls sockets to reach PostgreSQL, so DB-backed routes must be
// forwarded over HTTP to the standalone Node backend (dist-api/server.mjs),
// which executes the existing handlers and repositories in real Node.
//
//           workerd (route.ts) --HTTP--> Node /api -> pg
//
// Auth route wrappers also use this transport to keep authentication in the
// standalone Node API. Connections, social, research/plan and research/stream
// retain their existing local wrappers. isDbBackedApiPath is a historical
// classification helper, not the route dispatch table.

export type ApiUpstreamFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// Temporary, opt-in metadata only. Never log bodies, header values, messages or stacks.
function proxyDiagnostics(request: Request) {
  const started = Date.now();
  let enabled = false;
  let requestId = "unavailable";
  try {
    enabled = globalThis.process?.env?.SIGNAL_MAP_PROXY_DIAGNOSTICS === "1" &&
      request.method === "POST" && new URL(request.url).pathname === "/api/auth/login";
    const incoming = request.headers.get("x-cloudbase-request-id") || "";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(incoming)) requestId = incoming;
  } catch { /* Observability must not affect the request. */ }
  return (stage: string, details: () => Record<string, unknown> = () => ({})) => {
    if (!enabled) return;
    try {
      console.info(JSON.stringify({ event: "signal_proxy_diagnostic", schemaVersion: 1,
        requestId, stage, elapsedMs: Date.now() - started, ...details() }));
    } catch { /* Even failed metadata extraction/logging must preserve proxy behavior. */ }
  };
}

function proxyErrorMetadata(error: unknown) {
  const value = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  const names = ["Error", "TypeError", "RangeError", "DOMException", "AbortError", "TimeoutError"];
  const codes = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
    "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
    "ERR_INVALID_CHAR", "ERR_HTTP_INVALID_HEADER_VALUE", "ERR_INVALID_ARG_TYPE", "ERR_HTTP_HEADERS_SENT",
    "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT"];
  return { errorClass: typeof value?.name === "string" && names.includes(value.name) ? value.name : "OTHER",
    errorCode: typeof value?.code === "string" && codes.includes(value.code) ? value.code : "OTHER",
    causeCode: typeof value?.cause?.code === "string" && codes.includes(value.cause.code) ? value.cause.code : "OTHER" };
}

export function isDbBackedApiPath(pathname: string): boolean {
  return (
    pathname === "/api/signals" ||
    pathname === "/api/research/agent" ||
    pathname.startsWith("/api/control/") ||
    pathname === "/api/diagnostics/postgres-transport" ||
    pathname === "/api/diagnostics/supabase-auth-transport"
  );
}

export function resolveApiUpstream(fallback?: string): string {
  const configured = (globalThis.process as { env?: Record<string, string | undefined> } | undefined)
    ?.env?.API_UPSTREAM_URL;
  const production = globalThis.process?.env?.NODE_ENV === "production";
  const value = fallback ?? configured ?? (production ? undefined : "http://127.0.0.1:8080");
  if (!value?.trim()) throw new Error("API upstream configuration required");
  const url = new URL(value);
  // Only an origin is supported. Silently discarding a configured prefix
  // would route a valid request to a different API.
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid API upstream configuration");
  return url.origin;
}

export async function proxyApiRequest(
  request: Request,
  options: { upstream?: string; fetchFn?: ApiUpstreamFetch } = {},
): Promise<Response> {
  const diagnostic = proxyDiagnostics(request);
  let stage = "configuration";
  diagnostic("start");
  try {
    const upstream = resolveApiUpstream(options.upstream);
    const url = new URL(request.url);
    if (upstream === url.origin) throw new Error("API upstream loop");
    const upstreamUrl = new URL(upstream);
    upstreamUrl.pathname = url.pathname;
    upstreamUrl.search = url.search;

    const headers = new Headers(request.headers);
    // fetch() sets host and content-length itself; forwarding the originals can
    // cause undici to reject the request or produce a mismatched body length.
    headers.delete("host");
    headers.delete("content-length");

    const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
    const init: RequestInit = { method: request.method, headers, redirect: "manual" };
    stage = "request_body";
    if (hasBody) init.body = await request.arrayBuffer();
    diagnostic("request_body_ready");

    const doFetch = options.fetchFn ?? fetch;
    stage = "fetch";
    const upstreamResponse = await doFetch(upstreamUrl, init);
    diagnostic("upstream_headers", () => ({ status: upstreamResponse.status,
      cookieCount: typeof upstreamResponse.headers.getSetCookie === "function"
        ? upstreamResponse.headers.getSetCookie().length : null,
      hasContentEncoding: upstreamResponse.headers.has("content-encoding"),
      hasContentLength: upstreamResponse.headers.has("content-length"),
      hasTransferEncoding: upstreamResponse.headers.has("transfer-encoding") }));
    stage = "response_headers";
    const responseHeaders = new Headers(upstreamResponse.headers);
    // Node fetch decodes these bodies but retains the compressed wire headers.
    // Injected fetch implementations may instead return raw encoded bytes.
    const encoding = responseHeaders.get("content-encoding")?.trim();
    if (!options.fetchFn && globalThis.process?.versions?.node &&
      request.method !== "HEAD" && upstreamResponse.body !== null &&
      encoding && /^(gzip|br|deflate)$/i.test(encoding)) {
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
    }
    const location = responseHeaders.get("location");
    if (upstreamResponse.status >= 300 && upstreamResponse.status < 400 && location) {
      const target = new URL(location, upstreamUrl);
      if (!["http:", "https:"].includes(target.protocol) || target.username || target.password ||
        (target.origin !== upstream && target.origin !== url.origin)) {
        await upstreamResponse.body?.cancel();
        throw new Error("Invalid upstream redirect");
      }
      if (target.origin === upstream && !location.startsWith("/") && !location.startsWith("?") && !location.startsWith("#")) {
        responseHeaders.set("location", url.origin + target.pathname + target.search + target.hash);
      } else if (location.startsWith("//")) {
        responseHeaders.set("location", url.origin + target.pathname + target.search + target.hash);
      }
    }
    stage = "response_construct";
    const response = new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
    // This is NOT proof of downstream delivery or stream consumption by the framework.
    diagnostic("response_constructed", () => ({ status: response.status }));
    return response;
  } catch (error) {
    diagnostic("failure", () => ({ failedStage: stage, ...proxyErrorMetadata(error) }));
    // Do not surface a pg/transport error as a research failure; the upstream
    // (Node backend) being unreachable is a runtime concern for the operator.
    return Response.json(
      { error: "API backend unavailable", code: "API_UPSTREAM_UNAVAILABLE" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
