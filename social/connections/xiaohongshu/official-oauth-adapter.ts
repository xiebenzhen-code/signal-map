import type {
  LiveItem,
  SocialProfile,
  SocialProviderStatus,
  XiaohongshuConnectionAdapter,
} from "../../providers/types";
import { xhsItems, xhsProfile } from "./normalize";

function token() {
  return process.env.XHS_ACCESS_TOKEN?.trim() || "";
}

function configured() {
  return Boolean(
    process.env.XHS_CLIENT_ID?.trim() &&
      process.env.XHS_CLIENT_SECRET?.trim() &&
      token() &&
      process.env.XHS_OAUTH_API_BASE_URL?.trim(),
  );
}

function endpoint(path: string) {
  const base = new URL(process.env.XHS_OAUTH_API_BASE_URL!);
  if (base.protocol !== "https:") throw new Error("Xiaohongshu OAuth API must use HTTPS");
  return new URL(path, `${base.toString().replace(/\/$/, "")}/`).toString();
}

async function request(path: string, init?: RequestInit) {
  if (!configured()) return null;
  const response = await fetch(endpoint(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Xiaohongshu OAuth API ${response.status}`);
  return response;
}

export const officialOAuthAdapter: XiaohongshuConnectionAdapter = {
  kind: "official-oauth",

  async getConnectionStatus(): Promise<SocialProviderStatus> {
    const ready = configured();
    return {
      id: "xiaohongshu",
      label: "Xiaohongshu",
      adapter: "official-oauth",
      state: ready ? "connected" : "not_configured",
      detail: ready ? "Official Open Platform OAuth" : "OAuth runtime credentials are missing",
      service: ready
        ? { state: "connected", detail: "Connected" }
        : { state: "not_configured", detail: "Not configured" },
      account: ready
        ? { state: "connected", detail: "Logged in" }
        : { state: "login_required", detail: "Login required" },
    };
  },

  async search(query: string): Promise<LiveItem[]> {
    const response = await request("search", {
      method: "POST",
      body: JSON.stringify({ keyword: query }),
    });
    return response ? xhsItems(await response.json()) : [];
  },

  async getPost(id: string): Promise<LiveItem | null> {
    const response = await request(`posts/${encodeURIComponent(id)}`);
    return response ? xhsItems(await response.json())[0] || null : null;
  },

  async getProfile(id: string): Promise<SocialProfile | null> {
    const response = await request(`profiles/${encodeURIComponent(id)}`);
    return response ? xhsProfile(await response.json()) : null;
  },
};
