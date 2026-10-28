import type { DetailEnrichmentResult } from "./types.ts";
import dns from "node:dns";
import { isIP } from "node:net";
import { isPublicSourceAddress } from "../lib/custom-sources.ts";
import { pinnedRequest, type Address } from "./custom-source.ts";
import { getSourceDoHResolver } from "./doh-resolver.ts";
import { isSafeDetailUrl } from "./safe-url.ts";

type FailureCode = NonNullable<DetailEnrichmentResult["failureCode"]>;
export class DetailReadError extends Error {
  readonly code: FailureCode; constructor(code: FailureCode) { super(code); this.code = code; }
}
/** Internal dependency injection only; never populated from request data or configuration. */
export type DetailReadOptions = {
  lookup?: (host: string) => Promise<Address[]>;
  request?: (url: URL, address: Address, signal: AbortSignal, headers?: Record<string, string>) => Promise<{
    status: number; headers: Record<string, string | undefined>; body: string | AsyncIterable<Uint8Array>;
  }>;
};
const DETAIL_MAX_BYTES = 1024 * 1024;
const DETAIL_HEADERS = { "User-Agent": "SignalMapResearch/0.4", Accept: "text/html,text/plain" };
export async function fetchHtml(value: string, timeoutMs: number, options: DetailReadOptions) {
  if (timeoutMs <= 0) throw new DetailReadError("DETAIL_TIMEOUT");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => { if (controller.signal.aborted) throw new DetailReadError("DETAIL_TIMEOUT"); };
  const work = async () => {
    let current = value;
    for (let hop = 0; hop <= 2; hop++) {
      check();
      if (!isSafeDetailUrl(current)) throw new DetailReadError(hop ? "DETAIL_UNSAFE_REDIRECT" : "DETAIL_PRIVATE_ADDRESS");
      const url = new URL(current);
      const host = url.hostname.replace(/^\[|\]$/g, "");
      let addresses: Address[];
      try {
        const doh = getSourceDoHResolver();
        addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : options.lookup
          ? await options.lookup(host) : doh.configured ? await doh.resolve(host)
            : await new Promise<Address[]>((resolve, reject) => dns.lookup(host, { all: true }, (error, answers) => error ? reject(error) : resolve(answers)));
      } catch (error) {
        check();
        throw new DetailReadError(error instanceof Error && error.message.startsWith("来源解析到非公开地址，已整体拒绝")
          ? "DETAIL_PRIVATE_ADDRESS" : "DETAIL_DNS_FAILED");
      }
      check();
      if (!addresses.length || addresses.some(a => !isIP(a.address) || isIP(a.address) !== a.family)) throw new DetailReadError("DETAIL_DNS_FAILED");
      if (addresses.some(a => !isPublicSourceAddress(a.address))) throw new DetailReadError("DETAIL_PRIVATE_ADDRESS");
      const response = await (options.request
        ? options.request(url, addresses[0], controller.signal, { ...DETAIL_HEADERS })
        : pinnedRequest(url, addresses[0], controller.signal, false, undefined, DETAIL_MAX_BYTES));
      check();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (hop === 2) throw new DetailReadError("DETAIL_REDIRECT_LIMIT");
        try { current = new URL(response.headers.location ?? "", url).href; }
        catch { throw new DetailReadError("DETAIL_UNSAFE_REDIRECT"); }
        if (!response.headers.location) throw new DetailReadError("DETAIL_UNSAFE_REDIRECT");
        continue;
      }
      if (response.status !== 200) return undefined;
      if (typeof response.body === "string") return Buffer.from(response.body).subarray(0, DETAIL_MAX_BYTES).toString("utf8");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        check();
        const part = Buffer.from(chunk).subarray(0, DETAIL_MAX_BYTES - size);
        chunks.push(part); size += part.length;
        if (size >= DETAIL_MAX_BYTES) break;
      }
      check();
      return Buffer.concat(chunks).toString("utf8");
    }
  };
  try {
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new DetailReadError("DETAIL_TIMEOUT")); }, Math.max(0, timeoutMs));
    })]);
  } finally { clearTimeout(timer); }
}
