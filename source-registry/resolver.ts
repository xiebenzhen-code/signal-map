import { companySourceRegistry } from "./company-registry.ts";
import type { CompanySourceProfile } from "./types.ts";
import { selectRegisteredFeeds } from "./feed-catalog.ts";

function normalizedValues(values: string[]) {
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

export function resolveCompanySources(input: {
  entities: string[];
  query: string;
}): CompanySourceProfile[] {
  const entities = new Set(normalizedValues(input.entities));
  const query = input.query.toLowerCase();
  return companySourceRegistry.filter((profile) =>
    profile.aliases.some((alias) => entities.has(alias) || query.includes(alias)),
  );
}

/**
 * Which of the given entities actually have a dedicated official source adapter
 * that can execute for them.
 *
 * Recognizing an entity is not coverage. A resolved entity that is absent from
 * the company registry has no changelog/newsroom/docs page to fetch, so routing
 * it into the OFFICIAL source group can only produce `not_searched` outcomes —
 * the exact shape observed in the zero-candidate run for Shopify. Callers use
 * this to keep general web discovery reachable instead of assuming the official
 * adapters will cover the entity.
 */
export function officiallyCoveredEntities(input: {
  entities: string[];
  query: string;
}): string[] {
  const covered = new Set<string>();
  for (const profile of resolveCompanySources(input)) covered.add(profile.company);
  for (const feed of selectRegisteredFeeds({...input, selectedSourceType: "OFFICIAL"})) {
    for (const entity of input.entities) {
      if (selectRegisteredFeeds({entities: [entity], query: "", selectedSourceType: "OFFICIAL"}).some(candidate => candidate.id === feed.id)) covered.add(entity);
    }
  }
  return [...covered];
}
