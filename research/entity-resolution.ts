import { companySourceRegistry } from "../source-registry/company-registry.ts";

export type ResolvedEntity = {
  canonicalEntity: string;
  aliasesConsidered: string[];
};

function key(value: string) {
  return value.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "").trim();
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function resolveResearchEntities(input: { entities: string[]; query?: string }): ResolvedEntity[] {
  return unique(input.entities).map((candidate) => {
    const profile = companySourceRegistry.find((entry) => entry.aliases.some((alias) => key(alias) === key(candidate)));
    if (!profile) return { canonicalEntity: candidate, aliasesConsidered: [candidate] };
    return { canonicalEntity: profile.company, aliasesConsidered: unique([profile.company, ...profile.aliases]) };
  });
}

export function normalizeQueryForDedup(query: string, entities: ResolvedEntity[] = []) {
  let normalized = query.toLocaleLowerCase()
    .replace(/[“”「」『』]/g, "")
    .replace(/[，。！？：；、（）()\[\]{}]/g, " ")
    .replace(/\s+/g, " ").trim();
  for (const entity of entities) {
    for (const alias of [...entity.aliasesConsidered].sort((a, b) => b.length - a.length)) {
      const escaped = alias.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
      normalized = normalized.replace(new RegExp(escaped, "gi"), entity.canonicalEntity.toLocaleLowerCase());
    }
  }
  normalized = normalized
    .replace(/\b(latest\s+update|recent\s+update)\b/gi, " update ")
    .replace(/最新更新|最近更新|近期更新/g, " update ")
    .replace(/\b(latest|recently?|today|newest)\b/gi, " update ")
    .replace(/最新|最近|近期/g, " update ")
    .replace(/更新/g, " update ")
    .replace(/\s+/g, " ").trim();
  return normalized;
}

export function deduplicateQueries(queries: string[], entities: ResolvedEntity[], limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const query of queries) {
    const trimmed = query.trim();
    if (!trimmed) continue;
    const normalized = normalizeQueryForDedup(trimmed, entities);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
}
