// SSRF-safe URL validation shared by detail enrichment and the Google News
// wrapper resolver. Only public http(s) URLs are allowed, never loopback /
// private / link-local literals. DNS rebinding to a private address is out of
// scope for this minimal safety surface.

const LOOPBACK_HOSTS = new Set(["localhost", "localtest.me", "loopback", "0.0.0.0", "::", "::1"]);

function ipLiteralPrivate(host: string) {
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // IPv6 literal: loopback (::1 / ::ffff:127.*), link-local (fe80::), ULA (fc/fd::).
  if (/^[0-9a-f:]+$/i.test(host) && host.includes(":")) {
    const lower = host.replace(/^\[|\]$/g, "").toLowerCase();
    if (
      lower === "::1" ||
      lower.startsWith("::ffff:7f") ||
      lower.startsWith("fe80") ||
      /^f[c-d]/.test(lower) ||
      lower.startsWith("::")
    ) return true;
  }
  return false;
}

export function isSafeDetailUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return false;
  if (ipLiteralPrivate(host)) return false;
  return true;
}