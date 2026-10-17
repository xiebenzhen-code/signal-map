export const MAX_CUSTOM_SOURCES = 5;

/** Browser-safe syntactic validation. The backend also checks and pins DNS. */
export function publicSourceUrl(value: string): string | undefined {
  if (value.length > 2048) return;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
    if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) return;
    if (!host.includes(".") && !host.includes(":")) return;
    if (host === "localhost" || /\.(?:localhost|local|internal|test|invalid)$/i.test(host)) return;
    if (/^[\d.]+$/.test(host) || host.includes(":")) {
      if (!isPublicSourceAddress(host)) return;
    }
    url.hash = "";
    return url.href;
  } catch { return; }
}

export function isPublicSourceAddress(address: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
    const [a, b, c] = address.split(".").map(Number);
    if (address.split(".").some(part => Number(part) > 255)) return false;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
      a === 203 && b === 0 && c === 113);
  }
  // Only global-unicast IPv6; refuse mapped IPv4 and transition/documentation ranges.
  return /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^2001:(?:0?db8:|0{1,4}:|:)/i.test(address) && !/^2002:/i.test(address);
}

export function parseCustomSources(input: string | string[] | undefined) {
  const lines = (Array.isArray(input) ? input : (input ?? "").split(/\r?\n/))
    .map(value => value.trim()).filter(Boolean);
  const urls: string[] = [];
  const errors: string[] = [];
  for (const line of lines) {
    const url = publicSourceUrl(line);
    if (!url) { errors.push("链接格式不支持：请使用不含账号密码的公开网页链接。"); continue; }
    if (urls.includes(url)) continue;
    if (urls.length >= MAX_CUSTOM_SOURCES) { errors.push(`每个过滤器最多添加 ${MAX_CUSTOM_SOURCES} 个来源。`); break; }
    urls.push(url);
  }
  return { urls, errors };
}

export type CustomSourceCheck = {
  url: string;
  status: "readable" | "login_required" | "too_thin" | "failed" | "blocked" | "not_searched";
  reason: string;
  canonicalUrl?: string;
  title?: string;
  publishedAt?: string;
  /** Which page structure the publication date came from (provenance). */
  publishedAtSource?: "meta" | "jsonld" | "time-element" | "labeled-date";
  /** True when multiple page structures disagree on the publication date. */
  publishedAtConflict?: boolean;
  requestCount: number;
};
