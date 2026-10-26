// Session control decisions for the home header.
//
// Keeping the decision here (instead of inline in the component) means the
// logout controls are exercised by tests as behaviour, not as a string match
// against JSX. The server remains the only place a session is really ended:
// performLogout never reports success unless /api/auth/logout answered OK.

export type SessionKind = "checking" | "anonymous" | "authenticated" | "error";

export type SessionControlState = {
  status: "checking" | "ready" | "error";
  userId: string | null;
};

export function describeSessionControl(state: SessionControlState): SessionKind {
  if (state.status === "checking") return "checking";
  if (state.status === "error") return "error";
  return state.userId ? "authenticated" : "anonymous";
}

export type LogoutResult =
  | { status: "signed_out" }
  | { status: "failed"; message: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Ends the session through the existing server endpoint.
 *
 * - Only a successful response counts as signed out; a 4xx/5xx or a transport
 *   failure stays "failed" so the UI can keep showing the signed-in state.
 * - The request never touches /api/signals or /api/research: logging out must
 *   not spend a paid research run.
 * - No cookie is read, written or reconstructed here; the server and its
 *   Set-Cookie headers own the credentials.
 */
export async function performLogout(options: { request?: FetchLike } = {}): Promise<LogoutResult> {
  const request = options.request ?? ((input: string, init?: RequestInit) => fetch(input, init));
  try {
    const response = await request("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      return { status: "failed", message: `退出失败（HTTP ${response.status}），仍保持登录状态。` };
    }
    return { status: "signed_out" };
  } catch {
    return { status: "failed", message: "退出请求未送达，仍保持登录状态，请重试。" };
  }
}
