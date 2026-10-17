import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompanySourceProfile } from "./types.ts";

export type SourceExtensionEntity = {
  company: string;
  aliases: string[];
  domains: string[];
  changelogUrls: string[];
  newsroomUrls: string[];
  docsUrls: string[];
  githubOrgs: string[];
  githubRepos?: string[];
};

export type LoadedSourceExtensions = {
  ok: boolean;
  reason?: string;
  entities: SourceExtensionEntity[];
};

const CONFIG_DIR = join(process.cwd(), "source-registry");
const CONFIG_FILE = join(CONFIG_DIR, "sources.json");

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function validateEntity(raw: unknown): SourceExtensionEntity | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "not-an-object" };
  const e = raw as Record<string, unknown>;
  if (typeof e.company !== "string" || !e.company.trim()) return { error: "company-missing" };
  if (!isNonEmptyStringArray(e.aliases) || !e.aliases.length) return { error: "aliases-missing" };
  const result: SourceExtensionEntity = {
    company: e.company.trim(),
    aliases: e.aliases.map((a) => a.trim().toLowerCase()),
    domains: isNonEmptyStringArray(e.domains) ? e.domains : [],
    changelogUrls: isNonEmptyStringArray(e.changelogUrls) ? e.changelogUrls : [],
    newsroomUrls: isNonEmptyStringArray(e.newsroomUrls) ? e.newsroomUrls : [],
    docsUrls: isNonEmptyStringArray(e.docsUrls) ? e.docsUrls : [],
    githubOrgs: isNonEmptyStringArray(e.githubOrgs) ? e.githubOrgs : [],
  };
  if (isNonEmptyStringArray(e.githubRepos)) result.githubRepos = e.githubRepos;
  return result;
}

export function loadSourceExtensionsFromRaw(raw: unknown): LoadedSourceExtensions {
  return loadFromRaw(raw);
}

export function loadSourceExtensions(path = CONFIG_FILE): LoadedSourceExtensions {
  if (!existsSync(path)) return { ok: true, entities: [] };
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { return { ok: false, reason: "read-error", entities: [] }; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: "parse-error", entities: [] }; }
  return loadFromRaw(parsed);
}

function loadFromRaw(parsed: unknown): LoadedSourceExtensions {
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).entities)) {
    return { ok: false, reason: "invalid-shape", entities: [] };
  }
  const entities: SourceExtensionEntity[] = [];
  const rawList = (parsed as { entities: unknown[] }).entities;
  for (const item of rawList) {
    const result = validateEntity(item);
    if ("error" in result) return { ok: false, reason: `invalid-entry: ${result.error}`, entities: [] };
    entities.push(result);
  }
  return { ok: true, entities };
}

export function mergeCompanyRegistry(
  defaults: CompanySourceProfile[],
  extensions: SourceExtensionEntity[],
): (CompanySourceProfile & { githubRepos?: string[] })[] {
  const seenCompanies = new Set(defaults.map((e) => e.company.toLowerCase()));
  const seenAliases = new Set(defaults.flatMap((e) => e.aliases.map((a) => a.toLowerCase())));
  const additions = extensions.filter((e) => {
    if (seenCompanies.has(e.company.toLowerCase())) return false;
    if (e.aliases.some((a) => seenAliases.has(a.toLowerCase()))) return false;
    seenCompanies.add(e.company.toLowerCase());
    e.aliases.forEach((a) => seenAliases.add(a.toLowerCase()));
    return true;
  });
  return [...defaults, ...additions];
}

export type GithubTarget = {
  aliases: string[];
  githubRepos?: string[];
  updatePages?: Array<{ url: string; publisher: string }>;
};

export function mergeGithubTargets(
  existingTargets: GithubTarget[],
  extensions: SourceExtensionEntity[],
): GithubTarget[] {
  const seen = new Set<string>();
  for (const t of existingTargets) {
    seen.add([...t.aliases].sort().join("|"));
  }
  const additions: GithubTarget[] = [];
  for (const e of extensions) {
    const aliases = [e.company.toLowerCase(), ...e.aliases];
    const key = [...aliases].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const repos = e.githubRepos?.length
      ? e.githubRepos
      : e.githubOrgs?.map((org) => `${org}/${e.company.toLowerCase().replace(/\s+/g, "-")}`) ?? [];
    if (!repos.length) continue;
    additions.push({ aliases, githubRepos: repos });
  }
  return [...existingTargets, ...additions];
}
