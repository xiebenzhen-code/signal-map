import { companySourceRegistry } from "./company-registry.ts";
import type { CompanySourceProfile } from "./types.ts";

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
