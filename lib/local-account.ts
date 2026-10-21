export type LocalAccount = { id: string; mode: "authenticated" } | null;

/** Authentication errors must not unlock a different, anonymous local store. */
export async function resolveLocalAccount(request: typeof fetch = fetch): Promise<LocalAccount> {
  const response = await request("/api/auth/me", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("账户状态暂时无法确认，请重试。");
  const body = await response.json() as { user?: LocalAccount };
  if (body.user === null) return null;
  if (!body.user || typeof body.user.id !== "string" || !body.user.id.trim() || body.user.mode !== "authenticated") {
    throw new Error("账户状态无效，请重新登录。");
  }
  return body.user;
}
