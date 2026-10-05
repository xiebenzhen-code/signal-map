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
// Edge-safe routes (/api/auth/*, /api/connections, social, research/plan,
// research/stream) never touch pg and keep running locally in workerd.

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
  return fallback ?? configured ?? "http://127.0.0.1:8080";
}

export async function proxyApiRequest(
  request: Request,
  options: { upstream?: string; fetchFn?: ApiUpstreamFetch } = {},
): Promise<Response> {
  const upstream = resolveApiUpstream(options.upstream);
  const url = new URL(request.url);
  const upstreamUrl = new URL(url.pathname + url.search, upstream);

  const headers = new Headers(request.headers);
  // fetch() sets host and content-length itself; forwarding the originals can
  // cause undici to reject the request or produce a mismatched body length.
  headers.delete("host");
  headers.delete("content-length");

  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
  const init: RequestInit = { method: request.method, headers };
  if (hasBody) init.body = await request.arrayBuffer();

  const doFetch = options.fetchFn ?? fetch;
  try {
    const upstreamResponse = await doFetch(upstreamUrl, init);
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: upstreamResponse.headers,
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