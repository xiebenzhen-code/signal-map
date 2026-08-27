export type LiveItem = {
  id?: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt: string;
  channel: "官方" | "社区" | "混合";
  authority: number;
  origin: "official" | "news" | "community" | "github" | "hn" | "x" | "xhs" | "reddit";
};

export type SocialProfile = {
  id: string;
  name: string;
  handle?: string;
  url?: string;
  description?: string;
  source: "x" | "xhs";
};

export type ConnectionState =
  | "connected"
  | "login_required"
  | "not_configured"
  | "unavailable"
  | "error";

export type ConnectionPart = {
  state: ConnectionState;
  detail: string;
};

export type SocialProviderStatus = {
  id: "x" | "xiaohongshu";
  label: string;
  adapter: "official-api" | "official-oauth" | "local-browser";
  state: ConnectionState;
  detail: string;
  service?: ConnectionPart;
  account?: ConnectionPart;
};

export type SocialSearchContext = {
  query: string;
  industry: string;
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
