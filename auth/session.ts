import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "./types.ts";
function createRequestSession(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  const cookies = new Map(parseCookieHeader(request.headers.get("cookie") ?? "").map(({ name, value }) => [name, value]));
  const client: SupabaseClient | null = url && key ? createServerClient(url, key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:", path: "/" },
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (changes, cacheHeaders) => {
        for (const { name, value, options } of changes) {
          cookies.set(name, value);
          headers.append("Set-Cookie", serializeCookieHeader(name, value, options));
        }
        for (const [name, value] of Object.entries(cacheHeaders)) headers.set(name, value);
      },
    },
  }) : null;
  return { client, headers };
}

const requestSessions = new WeakMap<Request, ReturnType<typeof createRequestSession>>();

export function requestSession(request: Request) {
  let session = requestSessions.get(request);
  if (!session) {
    session = createRequestSession(request);
    requestSessions.set(request, session);
  }
  return session;
}

export async function resolveAuthContext(request: Request): Promise<AuthContext | null> {
  const { client } = requestSession(request);
  if (!client) return null;
  const authorization = request.headers.get("authorization");
  if (authorization && !/^Bearer\s+\S+$/i.test(authorization)) return null;
  const token = authorization?.replace(/^Bearer\s+/i, "");
  try {
    // Never trust cookie user objects, a client userId, or a synthetic Guest session.
    const { data, error } = await client.auth.getUser(token);
    return !error && data.user && !data.user.is_anonymous
      ? { userId: data.user.id, mode: "authenticated" }
      : null;
  } catch {
    return null;
  }
}

export function withSession<Args extends unknown[]>(handler: (request: Request, ...args: Args) => Promise<Response>) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    const origin = request.headers.get("origin");
    const expectedOrigin = process.env.SIGNAL_MAP_ALLOWED_ORIGIN || new URL(request.url).origin;
    if (request.method === "POST" && origin && origin !== expectedOrigin) {
      return Response.json({ error: "Forbidden origin" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    let response: Response;
    try {
      response = await handler(request, ...args);
    } catch {
      // Never expose provider errors, credentials or database connection strings.
      response = Response.json({ error: "Service temporarily unavailable" }, { status: 503 });
    }
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-store");
    const sessionHeaders = requestSessions.get(request)?.headers;
    sessionHeaders?.forEach((value, key) => { if (key !== "set-cookie") headers.set(key, value); });
    for (const cookie of sessionHeaders?.getSetCookie() ?? []) headers.append("Set-Cookie", cookie);
    return new Response(response.body, { status: response.status, headers });
  };
}
