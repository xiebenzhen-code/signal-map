import type {
  LiveItem,
  SocialProfile,
  SocialProvider,
  SocialProviderStatus,
  SocialSearchContext,
} from "./types";

function serverToken() {
  return process.env.X_BEARER_TOKEN?.trim() || "";
}

async function xRequest(path: string) {
  const token = serverToken();
  if (!token) return null;
  const response = await fetch(`https://api.x.com/2/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`X API ${response.status}`);
  return response;
}

function xPost(
  post: {
    id: string;
    text: string;
    created_at?: string;
    author_id?: string;
    public_metrics?: { like_count?: number; retweet_count?: number };
  },
  user?: { username: string; name: string },
): LiveItem {
  return {
    id: post.id,
    title: post.text.replace(/\s+/g, " ").slice(0, 90),
    url: `https://x.com/${user?.username || "i"}/status/${post.id}`,
    snippet: `${user?.name || "X user"} @${user?.username || "unknown"} · ${post.public_metrics?.like_count || 0} likes · ${post.public_metrics?.retweet_count || 0} reposts`,
    source: `X · @${user?.username || "unknown"}`,
    publishedAt: post.created_at || new Date().toISOString(),
    channel: "社区",
    authority: 60,
    origin: "x",
  };
}

export const xProvider: SocialProvider = {
  id: "x",
  label: "X",

  async getConnectionStatus(): Promise<SocialProviderStatus> {
    const configured = Boolean(serverToken());
    return {
      id: "x",
      label: "X",
      adapter: "official-api",
      state: configured ? "connected" : "not_configured",
      detail: configured
        ? "Official X API · server runtime"
        : "Set X_BEARER_TOKEN in the server runtime",
      service: configured
        ? { state: "connected", detail: "Connected" }
        : { state: "not_configured", detail: "Not configured" },
    };
  },

  async search({ query }: SocialSearchContext): Promise<LiveItem[]> {
    const params = new URLSearchParams({
      query: `${query} -is:retweet`,
      max_results: "10",
      "tweet.fields": "created_at,public_metrics,author_id",
      expansions: "author_id",
      "user.fields": "username,name,verified",
    });
    const response = await xRequest(`tweets/search/recent?${params.toString()}`);
    if (!response) return [];
    const payload = (await response.json()) as {
      data?: Array<{
        id: string;
        text: string;
        created_at: string;
        author_id: string;
        public_metrics?: { like_count?: number; retweet_count?: number };
      }>;
      includes?: { users?: Array<{ id: string; username: string; name: string }> };
    };
    const users = new Map((payload.includes?.users || []).map((user) => [user.id, user]));
    return (payload.data || []).map((post) => xPost(post, users.get(post.author_id)));
  },

  async getPost(id: string): Promise<LiveItem | null> {
    const params = new URLSearchParams({
      "tweet.fields": "created_at,public_metrics,author_id",
      expansions: "author_id",
      "user.fields": "username,name",
    });
    const response = await xRequest(`tweets/${encodeURIComponent(id)}?${params}`);
    if (!response) return null;
    const payload = (await response.json()) as {
      data?: { id: string; text: string; created_at?: string; author_id?: string };
      includes?: { users?: Array<{ id: string; username: string; name: string }> };
    };
    if (!payload.data) return null;
    return xPost(payload.data, payload.includes?.users?.[0]);
  },

  async getProfile(id: string): Promise<SocialProfile | null> {
    const clean = id.replace(/^@/, "");
    const path = /^\d+$/.test(clean)
      ? `users/${encodeURIComponent(clean)}`
      : `users/by/username/${encodeURIComponent(clean)}`;
    const response = await xRequest(`${path}?user.fields=description,username`);
    if (!response) return null;
    const payload = (await response.json()) as {
      data?: { id: string; name: string; username: string; description?: string };
    };
    if (!payload.data) return null;
    return {
      id: payload.data.id,
      name: payload.data.name,
      handle: payload.data.username,
      description: payload.data.description,
      url: `https://x.com/${payload.data.username}`,
      source: "x",
    };
  },
};
