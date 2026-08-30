export type LiveItem = {
  id?: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt?: string;
  eventOccurredAt?: string;
  firstSeenAt?: string;
  lastUpdatedAt?: string;
  retrievedAt: string;
  dataOrigin: "live" | "imported";
  channel: "官方" | "社区" | "混合";
  authority: number;
  origin: "official" | "news" | "community" | "github" | "hn" | "x" | "xhs" | "reddit";
  socialEvidenceChain?: SocialEvidenceChain;
};

export type SocialEvidenceChain = {
  evidenceChainId: string;
  canonicalClaimFingerprint: string;
  canonicalSourceUrl?: string;
  representativeSourceUrl: string;
  propagationCount: number;
};

export type SocialProfile = {
  id: string;
  name: string;
  handle?: string;
  url?: string;
  description?: string;
  source: "x" | "xhs";
};

type SocialProviderId = "x" | "xiaohongshu";

export type ConnectionState =
  | "connected"
  | "login_required"
  | "not_configured"
  | "unavailable"
  | "error";

type ConnectionPart = {
  state: ConnectionState;
  detail: string;
};

export type SocialProviderStatus = {
  id: SocialProviderId;
  label: string;
  adapter: "official-api" | "official-oauth" | "local-browser";
  state: ConnectionState;
  detail: string;
  service?: ConnectionPart;
  account?: ConnectionPart;
};

export type ProviderSearchFailureCode =
  | "invalid_query"
  | "timeout"
  | "rate_limited"
  | "upstream_error";

export type ProviderSearchOutcome = {
  provider: string;
  connectionStatus: ConnectionState;
  execution:
    | "searched_with_results"
    | "searched_no_results"
    | "not_searched"
    | "not_configured"
    | "unavailable"
    | "failed";
  searched: boolean;
  resultCount: number;
  startedAt?: string;
  completedAt?: string;
  failureCode?: ProviderSearchFailureCode;
  retryAfterSeconds?: number;
};

export class ProviderSearchError extends Error {
  readonly code: ProviderSearchFailureCode;
  readonly retryAfterSeconds?: number;
  readonly diagnostic?: string;

  constructor(
    code: ProviderSearchFailureCode,
    message: string,
    options: { retryAfterSeconds?: number; diagnostic?: string } = {},
  ) {
    super(message);
    this.name = "ProviderSearchError";
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.diagnostic = options.diagnostic;
  }
}

export function isProviderSearchError(error: unknown): error is ProviderSearchError {
  return error instanceof ProviderSearchError;
}

export type SocialSearchContext = {
  query: string;
  industry: string;
  maxSearchesPerProvider?: number;
};

export interface SocialProvider {
  id: SocialProviderStatus["id"];
  label: string;
  search(context: SocialSearchContext): Promise<LiveItem[]>;
  getPost(id: string): Promise<LiveItem | null>;
  getProfile(id: string): Promise<SocialProfile | null>;
  getConnectionStatus(): Promise<SocialProviderStatus>;
}

export interface XiaohongshuConnectionAdapter {
  kind: "official-oauth" | "local-browser";
  search(query: string): Promise<LiveItem[]>;
  getPost(id: string): Promise<LiveItem | null>;
  getProfile(id: string): Promise<SocialProfile | null>;
  getConnectionStatus(): Promise<SocialProviderStatus>;
}
