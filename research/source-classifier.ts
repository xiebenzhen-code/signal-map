import type { SourceType } from "./types.ts";

export function classifySource(publisher: string, url: string): SourceType | "other" {
  const value = `${publisher} ${url}`;
  if (
    /SEC(?:\.gov)?|Securities and Exchange Commission|Nasdaq|NYSE|Investor Relations|official|官网|政府|委员会|交易所|教育部|药监局|卫健委|OpenAI|Anthropic|Google Developers|Microsoft|Runway|ByteDance Seed/i.test(
      value,
    )
  ) {
    return "primary";
  }
  if (/Reuters|Bloomberg|Financial Times|\bFT\b|Wall Street Journal|\bWSJ\b|CNBC/i.test(value)) {
    return "trusted_media";
  }
  if (
    /TechCrunch|The Verge|Ars Technica|VentureBeat|TechNode|36Kr|36氪|机器之心|量子位|InfoQ|极客公园/i.test(
      value,
    )
  ) {
    return "industry_media";
  }
  if (/\bX\b|Twitter|Xiaohongshu|小红书|Reddit/i.test(value)) return "social";
  return "other";
}
