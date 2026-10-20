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

/**
 * Browser-facing origin gate for the web service.
 *
 * The product deploys the web app and the Node API as separate services. The
 * Node backend's own gate (auth/session.ts withSession) trusts only its
 * configured origin, so forwarding the browser's web-domain Origin made every
 * browser POST (research submit, saves, control writes) fail with 403 while
 * GETs kept working — research could complete on the server while the page
 * only reported failure.
 *
 * Origin enforcement now lives at the layer that actually talks to the
 * browser: a POST is first-party when it is same-origin with the web service
 * or carries the web service's configured origin. The upstream hop itself is
 * server-to-server and carries no Origin at all.
 */
function webOriginCheck(request: Request): Response | null {
  if (request.method !== "POST") return null;
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const requestOrigin = new URL(request.url).origin;
  const configured = (globalThis.process as { env?: Record<string, string | undefined> } | undefined)
    ?.env?.SIGNAL_MAP_ALLOWED_ORIGIN;
  const trusted = new Set([requestOrigin, ...(configured ? [configured] : [])]);
  if (!trusted.has(origin)) {
    return Response.json(
      { error: "Forbidden origin" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  return null;
}

export async function proxyApiRequest(
  request: Request,
  options: { upstream?: string; fetchFn?: ApiUpstreamFetch } = {},
): Promise<Response> {
  try {
    const upstream = resolveApiUpstream(options.upstream);
    const url = new URL(request.url);
    if (upstream === url.origin) throw new Error("API upstream loop");
    const upstreamUrl = new URL(upstream);
    upstreamUrl.pathname = url.pathname;
    upstreamUrl.search = url.search;

    const forbidden = webOriginCheck(request);
    if (forbidden) return forbidden;

    const headers = new Headers(request.headers);
    // fetch() sets host and content-length itself; forwarding the originals can
    // cause undici to reject the request or produce a mismatched body length.
    headers.delete("host");
    headers.delete("content-length");
    // The upstream hop is server-to-server: never present the browser's Origin
    // to the Node runtime, whose origin gate would reject a first-party web
    // origin it does not know. Browser-origin enforcement happens in
    // webOriginCheck above this hop.
    headers.delete("origin");

    const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
    const init: RequestInit = { method: request.method, headers, redirect: "manual" };
    if (hasBody) init.body = await request.arrayBuffer();

    const doFetch = options.fetchFn ?? fetch;
    const upstreamResponse = await doFetch(upstreamUrl, init);
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
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch {
    // Do not surface a pg/transport error as a research failure; the upstream
    // (Node backend) being unreachable is a runtime concern for the operator.
    return Response.json(
      { error: "API backend unavailable", code: "API_UPSTREAM_UNAVAILABLE" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
