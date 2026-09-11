import type {
  LiveItem,
  SocialProfile,
  SocialProviderStatus,
  XiaohongshuConnectionAdapter,
} from "../../providers/types.ts";
import { isLoggedIn, xhsItems, xhsProfile } from "./normalize.ts";
import { discardResponseBody, throwAfterDiscardingBody } from "../../../lib/http-response.ts";

function serviceBase() {
  const parsed = new URL(
    process.env.XHS_SERVICE_URL?.trim() || "http://127.0.0.1:18080",
  );
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("XHS_SERVICE_URL must use a loopback address");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("XHS_SERVICE_URL must use HTTP or HTTPS");
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
}

async function firstResponse(paths: string[], init?: RequestInit) {
  const base = serviceBase();
  for (const path of paths) {
    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(3500),
      });
      if (response.ok) return response;
      await discardResponseBody(response);
    } catch {}
  }
  return null;
}

async function connectionStatus(): Promise<SocialProviderStatus> {
  let base: string;
  try {
    base = serviceBase();
  } catch (error) {
    return {
      id: "xiaohongshu",
      label: "Xiaohongshu",
      adapter: "local-browser",
      state: "error",
      detail: error instanceof Error ? error.message : "Invalid local service URL",
      service: { state: "error", detail: "Invalid XHS_SERVICE_URL" },
      account: { state: "login_required", detail: "Login required" },
    };
  }

  const health = await firstResponse([
    "/health",
    "/api/v1/health",
    "/api/v1/login/status",
  ]);
  if (!health) {
    return {
      id: "xiaohongshu",
      label: "Xiaohongshu",
      adapter: "local-browser",
      state: "unavailable",
      detail: `${base} is offline`,
      service: { state: "unavailable", detail: "Offline" },
      account: { state: "login_required", detail: "Login required" },
    };
  }

  const login = await firstResponse([
    "/api/v1/login/status",
    "/api/v1/login/check",
  ]);
  const authenticated = login ? isLoggedIn(await login.json()) : false;
  return {
    id: "xiaohongshu",
    label: "Xiaohongshu",
    adapter: "local-browser",
    state: authenticated ? "connected" : "login_required",
    detail: authenticated ? "Local service and account are ready" : "Complete local QR login",
    service: { state: "connected", detail: "Connected" },
    account: authenticated
      ? { state: "connected", detail: "Logged in" }
      : { state: "login_required", detail: "Login required" },
  };
}

export const localBrowserAdapter: XiaohongshuConnectionAdapter = {
  kind: "local-browser",
  getConnectionStatus: connectionStatus,

  async search(query: string): Promise<LiveItem[]> {
    const status = await connectionStatus();
    if (status.state !== "connected") return [];
    const response = await fetch(`${serviceBase()}/api/v1/feeds/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: query,
        filters: { sort_by: "最新", publish_time: "一周内" },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) await throwAfterDiscardingBody(response, new Error(`Xiaohongshu local service ${response.status}`));
    return xhsItems(await response.json());
  },

  async getPost(id: string): Promise<LiveItem | null> {
    const response = await firstResponse([
      `/api/v1/feeds/${encodeURIComponent(id)}`,
      `/api/v1/feed/${encodeURIComponent(id)}`,
    ]);
    if (!response) return null;
    return xhsItems(await response.json())[0] || null;
  },

  async getProfile(id: string): Promise<SocialProfile | null> {
    const response = await firstResponse([
      `/api/v1/users/${encodeURIComponent(id)}`,
      `/api/v1/user/${encodeURIComponent(id)}`,
    ]);
    if (!response) return null;
    return xhsProfile(await response.json());
  },
};
