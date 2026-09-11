import "./server-runtime.ts";
import type {
  LiveItem,
  SocialProfile,
  SocialProvider,
  SocialProviderStatus,
  SocialSearchContext,
} from "./types.ts";
import { ProviderSearchError } from "./types.ts";
import { discardResponseBody } from "../../lib/http-response.ts";

const SUCCESS_CACHE_MS = 60_000;
const ZERO_RESULT_CACHE_MS = 45_000;
const MAX_QUERY_LENGTH = 350;
const MAX_OR_OPERATORS = 2;

type XProviderDependencies = {
  getToken?: () => string;
  fetcher?: typeof fetch;
  now?: () => Date;
};

type CachedSearch = {
  expiresAt: number;
  items?: LiveItem[];
  error?: ProviderSearchError;
};

function serverToken() {
  return process.env.X_BEARER_TOKEN?.trim() || "";
}

function normalizeQuery(value: string) {
  const query = value.replace(/\s+/g, " ").trim().replace(/\s+-is:retweet\b/gi, "");
  if (!query) throw new ProviderSearchError("invalid_query", "X search query is empty");
  if ((query.match(/\bOR\b/gi) || []).length > MAX_OR_OPERATORS) {
    throw new ProviderSearchError("invalid_query", "X search query is too complex");
  }
  const normalized = `${query} -is:retweet`;
  if (normalized.length > MAX_QUERY_LENGTH) {
    throw new ProviderSearchError("invalid_query", "X search query is too long");
  }
  return normalized;
}

function retryAfterSeconds(response: Response) {
  const raw = response.headers.get("Retry-After");
  const seconds = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60;
}

async function xRequest(path: string, dependencies: Required<XProviderDependencies>) {
  const token = dependencies.getToken();
  if (!token) return null;
  let response: Response;
  try {
    response = await dependencies.fetcher(`https://api.x.com/2/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    const timeout = error instanceof Error && /abort|timeout/i.test(error.name + error.message);
    throw new ProviderSearchError(
      timeout ? "timeout" : "upstream_error",
      timeout ? "X request timed out" : "X request failed",
      { diagnostic: error instanceof Error ? error.message : String(error) },
    );
  }
  if (response.status === 429) {
    await discardResponseBody(response);
    throw new ProviderSearchError("rate_limited", "X request is temporarily rate limited", {
      retryAfterSeconds: retryAfterSeconds(response),
      diagnostic: "X API returned 429",
    });
  }
  if (!response.ok) {
    await discardResponseBody(response);
    throw new ProviderSearchError("upstream_error", "X API request failed", {
      diagnostic: `X API ${response.status}`,
    });
  }
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
  const retrievedAt = new Date().toISOString();
  return {
    id: post.id,
    title: post.text.replace(/\s+/g, " ").slice(0, 90),
    url: `https://x.com/${user?.username || "i"}/status/${post.id}`,
    snippet: `${user?.name || "X user"} @${user?.username || "unknown"} · ${post.public_metrics?.like_count || 0} likes · ${post.public_metrics?.retweet_count || 0} reposts`,
    source: `X · @${user?.username || "unknown"}`,
    publishedAt: post.created_at || undefined,
    firstSeenAt: retrievedAt,
    retrievedAt,
    dataOrigin: "live",
    channel: "社区",
    authority: 60,
    origin: "x",
  };
}

export function createXProvider(overrides: XProviderDependencies = {}): SocialProvider {
  const dependencies: Required<XProviderDependencies> = {
    getToken: overrides.getToken || serverToken,
    fetcher: overrides.fetcher || fetch,
    now: overrides.now || (() => new Date()),
  };
  const cache = new Map<string, CachedSearch>();
  const inFlight = new Map<string, Promise<LiveItem[]>>();

  const search = async ({ query }: SocialSearchContext): Promise<LiveItem[]> => {
    const normalizedQuery = normalizeQuery(query);
    const now = dependencies.now().getTime();
    const cached = cache.get(normalizedQuery);
    if (cached && cached.expiresAt > now) {
      if (cached.error) throw cached.error;
      return cached.items || [];
    }
    cache.delete(normalizedQuery);
    const existing = inFlight.get(normalizedQuery);
    if (existing) return existing;

    const request = (async () => {
      try {
        const params = new URLSearchParams({
          query: normalizedQuery,
          max_results: "10",
          "tweet.fields": "created_at,public_metrics,author_id",
          expansions: "author_id",
          "user.fields": "username,name,verified",
        });
        const response = await xRequest(`tweets/search/recent?${params.toString()}`, dependencies);
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
        const items = (payload.data || []).map((post) => xPost(post, users.get(post.author_id)));
        cache.set(normalizedQuery, {
          items,
          expiresAt: dependencies.now().getTime() + (items.length ? SUCCESS_CACHE_MS : ZERO_RESULT_CACHE_MS),
        });
        return items;
      } catch (error) {
        if (error instanceof ProviderSearchError && error.code === "rate_limited") {
          cache.set(normalizedQuery, {
            error,
            expiresAt: dependencies.now().getTime() + (error.retryAfterSeconds || 60) * 1000,
          });
        }
        throw error;
      } finally {
        inFlight.delete(normalizedQuery);
      }
    })();
    inFlight.set(normalizedQuery, request);
    return request;
  };

  return {
    id: "x",
    label: "X",

  async getConnectionStatus(): Promise<SocialProviderStatus> {
    const configured = Boolean(dependencies.getToken());
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

  search,

  async getPost(id: string): Promise<LiveItem | null> {
    const params = new URLSearchParams({
      "tweet.fields": "created_at,public_metrics,author_id",
      expansions: "author_id",
      "user.fields": "username,name",
    });
    const response = await xRequest(`tweets/${encodeURIComponent(id)}?${params}`, dependencies);
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
    const response = await xRequest(`${path}?user.fields=description,username`, dependencies);
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
}

export const xProvider = createXProvider();
