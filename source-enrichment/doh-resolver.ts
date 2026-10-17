// Shared DoH resolver for source fetching (check endpoint + research pipeline).
// Design contract:
// - SOURCE_DOH_URL unset → system DNS (unchanged behavior).
// - SOURCE_DOH_URL set (https://… JSON DoH endpoint) → all source-fetch A/AAAA
//   lookups go through that resolver; failures are honest (no silent fallback
//   to system DNS).
// - Results are validated: public addresses only; mixed public+private answer
//   sets are rejected as a whole (anti-DNS-rebinding).
// - Errors are redacted: never include credentials or full sensitive URLs.
import { isIP } from "node:net";
import { isPublicSourceAddress } from "../lib/custom-sources.ts";

export type ResolvedAddress = { address: string; family: number };

export type DoHResolver = {
  /** Resolve a hostname to validated public addresses (throws on failure). */
  resolve: (hostname: string) => Promise<ResolvedAddress[]>;
  /** True when a DoH endpoint is configured. */
  configured: boolean;
};

const REDACT = (value: string) =>
  value
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]")
    .replace(/\b(token|password|apikey|api_key|authorization|cookie)=[^&\s]+/gi, "$1=[redacted]")
    .replace(/([?&])(oc|hl|gl|ceid)=[^&\s]+/gi, "$1[redacted]")
    .slice(0, 160);

function validateAnswers(hostname: string, answers: ResolvedAddress[]): ResolvedAddress[] {
  const unique = answers.filter((answer, index) =>
    answers.findIndex((other) => other.address === answer.address) === index,
  );
  if (!unique.length) {
    throw new Error(`DoH 解析无结果：${hostname}（未返回任何地址）`);
  }
  for (const answer of unique) {
    if (isIP(answer.address) === 0) {
      throw new Error(`DoH 返回无效地址（解析失败）：${hostname}`);
    }
  }
  // Mixed public + private sets are rejected as a whole: picking only the public
  // entries would defeat DNS-rebinding protection.
  const allPublic = unique.every((answer) => isPublicSourceAddress(answer.address));
  if (!allPublic) {
    throw new Error(`来源解析到非公开地址，已整体拒绝：${hostname}`);
  }
  return unique;
}

function extractAnswers(hostname: string, payload: unknown): ResolvedAddress[] {
  const answers = (payload as { Answer?: Array<{ data?: string; type?: number }> })?.Answer;
  if (!Array.isArray(answers)) {
    throw new Error(`DoH 响应畸形（解析失败）：${hostname}`);
  }
  const result: ResolvedAddress[] = [];
  for (const answer of answers) {
    const data = typeof answer?.data === "string" ? answer.data.trim() : "";
    // A/AAAA records only (1 / 28); CNAME chains are followed by the resolver itself.
    if (answer?.type !== 1 && answer?.type !== 28) continue;
    const family = isIP(data);
    if (family === 0) continue;
    result.push({ address: data, family });
  }
  return result;
}

export function createDoHLookup(dohUrl: string): (hostname: string) => Promise<Array<{ address: string; family: number }>> {
  const endpoint = new URL(dohUrl);
  if (endpoint.protocol !== "https:") {
    throw new Error("SOURCE_DOH_URL 必须是 https:// 的 DoH JSON 端点");
  }
  return async (hostname: string) => {
    const url = new URL(dohUrl);
    url.searchParams.set("name", hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(url, {
        headers: { accept: "application/dns-json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`DoH 查询失败（HTTP ${response.status}）：${hostname}`);
      }
      const payload: unknown = await response.json();
      return validateAnswers(hostname, extractAnswers(hostname, payload));
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`DoH 解析超时：${hostname}`);
      }
      if (error instanceof Error && /DoH|解析/.test(error.message)) throw error;
      throw new Error(`DoH 解析失败：${hostname}（${REDACT(error instanceof Error ? error.message : String(error))}）`);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The shared resolver for this process, rebuilt on env change (test seam). */
export function getSourceDoHResolver(): DoHResolver {
  const url = process.env.SOURCE_DOH_URL?.trim();
  if (!url) return { configured: false, resolve: async () => [] };
  const lookup = createDoHLookup(url);
  return {
    configured: true,
    resolve: async (hostname) => {
      if (isIP(hostname)) {
        // Literal IP: nothing to resolve; guard applies at fetch site.
        return [{ address: hostname, family: isIP(hostname) }];
      }
      return validateAnswers(hostname, await lookup(hostname));
    },
  };
}

export function resolveSourceAddresses(hostname: string, answers: ResolvedAddress[]): ResolvedAddress[] {
  return validateAnswers(hostname, answers);
}
