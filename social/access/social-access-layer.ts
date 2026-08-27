import { xProvider } from "../providers/x";
import { xiaohongshuProvider } from "../providers/xiaohongshu";
import type {
  LiveItem,
  SocialProfile,
  SocialProvider,
  SocialProviderStatus,
  SocialSearchContext,
} from "../providers/types";

export class SocialAccessLayer {
  constructor(private readonly providers: SocialProvider[]) {}

  async search(context: SocialSearchContext): Promise<{
    items: LiveItem[];
    statuses: SocialProviderStatus[];
  }> {
    const statuses = await this.getConnectionStatuses();
    const enabled = this.providers.filter(
      (provider) =>
        statuses.find((status) => status.id === provider.id)?.state === "connected",
    );
    const settled = await Promise.allSettled(
      enabled.map((provider) => provider.search(context)),
    );
    return {
      items: settled.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      ),
      statuses,
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
        } catch (error) {
          return {
            id: provider.id,
            label: provider.label,
            adapter: provider.id === "x" ? "official-api" : "local-browser",
            state: "error",
            detail: error instanceof Error ? error.message : "Connection check failed",
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

export const socialAccessLayer = new SocialAccessLayer([
  xProvider,
  xiaohongshuProvider,
]);
