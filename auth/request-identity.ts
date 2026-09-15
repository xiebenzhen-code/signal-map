import { parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { resolveAuthContext } from "./session.ts";

export type ResearchIdentity =
  | { mode: "authenticated"; id: string }
  | { mode: "anonymous"; id: string; setCookie?: string };

const guestCookie = "signal_map_guest";

function signingSecret() {
  return process.env.SIGNAL_MAP_GUEST_SECRET || process.env.DATABASE_URL || "";
}

async function signature(id: string) {
  const secret = signingSecret();
  if (!secret) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verifiedGuestId(request: Request) {
  const value = parseCookieHeader(request.headers.get("cookie") || "")
    .find(({ name }) => name === guestCookie)?.value;
  if (!value) return null;
  const [id, supplied, extra] = value.split(".");
  if (!id || !supplied || extra || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return supplied === await signature(id) ? id : null;
}

export async function resolveResearchIdentity(request: Request): Promise<ResearchIdentity> {
  const auth = await resolveAuthContext(request);
  if (auth) return { mode: "authenticated", id: auth.userId };
  // Research remains available when optional guest-cookie signing is not configured.
  // The ephemeral identity is intentionally not usable for tenant persistence.
  if (!signingSecret()) return { mode: "anonymous", id: crypto.randomUUID() };
  const existing = await verifiedGuestId(request);
  if (existing) return { mode: "anonymous", id: existing };
  const id = crypto.randomUUID();
  const value = `${id}.${await signature(id)}`;
  return {
    mode: "anonymous",
    id,
    setCookie: serializeCookieHeader(guestCookie, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    }),
  };
}
