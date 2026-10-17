import type {
  LiveItem,
  SocialProfile,
  SocialProvider,
  SocialProviderStatus,
  SocialSearchContext,
  ProviderSearchOutcome,
} from "../providers/types.ts";
import { isProviderSearchError } from "../providers/types.ts";

export class SocialAccessLayer {
  private readonly providers: SocialProvider[];

  constructor(providers: SocialProvider[]) {
    this.providers = providers;
  }

  async search(context: SocialSearchContext): Promise<{
    items: LiveItem[];
    statuses: SocialProviderStatus[];
    outcomes: ProviderSearchOutcome[];
  }> {
    const statuses = await this.getConnectionStatuses();
    const budget = Math.max(0, Math.floor(context.maxSearchesPerProvider ?? 1));
    const enabled = budget > 0 ? this.providers.filter(
      (provider) => statuses.find((status) => status.id === provider.id)?.state === "connected",
    ) : [];
    const settled = await Promise.allSettled(
      enabled.map(async (provider) => ({
        provider,
        startedAt: new Date().toISOString(),
        items: await provider.search(context),
        completedAt: new Date().toISOString(),
      })),
    );
    const completed = new Map(
      settled.flatMap((result) => result.status === "fulfilled" ? [[result.value.provider.id, result.value] as const] : []),
    );
    const failed = new Map(
      settled.flatMap((result, index) => result.status === "rejected" ? [[enabled[index].id, result.reason] as const] : []),
    );
    const outcomes = this.providers.map((provider) => {
      const status = statuses.find((candidate) => candidate.id === provider.id);
      const connectionStatus = status?.state || "error";
      const success = completed.get(provider.id);
      if (success) {
        return {
          provider: provider.id,
          connectionStatus,
          execution: success.items.length ? "searched_with_results" : "searched_no_results",
          searched: true,
          resultCount: success.items.length,
          requestCount: 1,
          startedAt: success.startedAt,
          completedAt: success.completedAt,
        } satisfies ProviderSearchOutcome;
      }
      if (connectionStatus === "not_configured" || connectionStatus === "unavailable") {
        return {
          provider: provider.id,
          connectionStatus,
          execution: connectionStatus,
          searched: false,
          resultCount: 0,
        } satisfies ProviderSearchOutcome;
      }
      const reason = failed.get(provider.id);
      if (reason) {
        return {
          provider: provider.id,
          connectionStatus,
          execution: "failed",
          searched: true,
          resultCount: 0,
          requestCount: 1,
          failureCode: isProviderSearchError(reason) ? reason.code : "upstream_error",
          retryAfterSeconds: isProviderSearchError(reason) ? reason.retryAfterSeconds : undefined,
        } satisfies ProviderSearchOutcome;
      }
      return {
        provider: provider.id,
        connectionStatus,
        execution: connectionStatus === "connected" ? "not_searched" : "failed",
        searched: false,
        resultCount: 0,
        requestCount: 0,
      } satisfies ProviderSearchOutcome;
    });
    return {
      items: settled.flatMap((result) =>
        result.status === "fulfilled" ? result.value.items : [],
      ),
      statuses,
      outcomes,
    };
  }

  async getPost(providerId: SocialProvider["id"], id: string) {
    return this.provider(providerId).getPost(id);
  }

  async getProfile(
    providerId: SocialProvider["id"],
    id: string,
  ): Promise<SocialProfile | null> {
    return this.provider(providerId).getProfile(id);
  }

  async getConnectionStatuses() {
    return Promise.all(
      this.providers.map(async (provider) => {
        try {
          return await provider.getConnectionStatus();
        } catch {
          return {
            id: provider.id,
            label: provider.label,
            adapter: provider.id === "x" ? "official-api" : "local-browser",
            state: "error",
            detail: "Connection check failed",
          } satisfies SocialProviderStatus;
        }
      }),
    );
  }

  private provider(id: SocialProvider["id"]) {
    const provider = this.providers.find((candidate) => candidate.id === id);
    if (!provider) throw new Error(`Unknown social provider: ${id}`);
    return provider;
  }
}
