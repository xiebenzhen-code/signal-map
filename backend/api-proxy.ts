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

    const headers = new Headers(request.headers);
    // fetch() sets host and content-length itself; forwarding the originals can
    // cause undici to reject the request or produce a mismatched body length.
    headers.delete("host");
    headers.delete("content-length");

    const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
    const init: RequestInit = { method: request.method, headers, redirect: "manual" };
    if (hasBody) init.body = await request.arrayBuffer();

    const doFetch = options.fetchFn ?? fetch;
    const upstreamResponse = await doFetch(upstreamUrl, init);
    const responseHeaders = new Headers(upstreamResponse.headers);
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
