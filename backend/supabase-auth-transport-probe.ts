// TEMPORARY PRODUCTION DIAGNOSTIC — REMOVE AFTER INCIDENT IS RESOLVED.
//
// Purpose: prove, from inside the running signal-map-api Node container,
// whether CloudBase can reach Supabase Auth. The endpoint is intentionally
// off unless SIGNAL_MAP_DIAGNOSTIC_TOKEN is configured, and it never returns
// hostnames, URLs, IP addresses, keys, certificates or upstream bodies.
//
// Design constraints that must not be relaxed:
// - Resolution MUST use the same system DNS path the Supabase SDK uses. The
//   source DoH resolver exists for third-party page fetches; using it here
//   could report PASS while the real SDK still fails (false positive).
// - TLS keeps Node's default verification. No rejectUnauthorized:false, no
//   NODE_TLS_REJECT_UNAUTHORIZED override, no custom identity check.
// - Any HTTP response — including 401/403/404 — proves DNS, TCP, TLS,
//   hostname verification and HTTP all succeeded. That is a Supabase
//   auth/config layer finding, not a transport failure.
// - No retry, no signInWithPassword, no user creation, no database access.
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { timingSafeEqual } from "node:crypto";

type ProbeStatus = "PASS" | "FAIL" | "NOT_RUN";

export type SupabaseAuthTransportReport = {
  env: { url: "PRESENT" | "MISSING"; key: "PRESENT" | "MISSING" };
  dns: { status: ProbeStatus; durationMs: number };
  https: { status: ProbeStatus; durationMs: number };
  tls: { status: ProbeStatus };
  hostnameVerification: { status: ProbeStatus };
  authEndpoint: { status: ProbeStatus; httpStatus: number | null };
  errorCategory:
    | "NONE"
    | "ENV_MISSING"
    | "DNS_FAILURE"
    | "CONNECT_TIMEOUT"
    | "CONNECTION_REFUSED"
    | "TLS_FAILURE"
    | "HOSTNAME_FAILURE"
    | "AUTH_HTTP_ERROR"
    | "UPSTREAM_SERVER_ERROR"
    | "UNKNOWN";
};

const DNS_TIMEOUT_MS = 3000;
const HTTPS_TIMEOUT_MS = 4000;
const TOTAL_TIMEOUT_MS = 8000;
const AUTH_PATH = "/auth/v1/";

function emptyReport(url: string | undefined, key: string | undefined): SupabaseAuthTransportReport {
  return {
    env: { url: url ? "PRESENT" : "MISSING", key: key ? "PRESENT" : "MISSING" },
    dns: { status: "NOT_RUN", durationMs: 0 },
    https: { status: "NOT_RUN", durationMs: 0 },
    tls: { status: "NOT_RUN" },
    hostnameVerification: { status: "NOT_RUN" },
    authEndpoint: { status: "NOT_RUN", httpStatus: null },
    errorCategory: "NONE",
  };
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, code: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function errorCode(error: unknown) {
  return String((error as { code?: unknown } | null)?.code ?? "");
}

function classifyTransportError(error: unknown): SupabaseAuthTransportReport["errorCategory"] {
  const code = errorCode(error);
  const name = String((error as { name?: unknown } | null)?.name ?? "");
  const message = `${code} ${name} ${error instanceof Error ? error.message : ""}`;
  if (/ENOTFOUND|EAI_AGAIN|ENODATA|ESERVFAIL/.test(message)) return "DNS_FAILURE";
  if (/ECONNREFUSED/.test(message)) return "CONNECTION_REFUSED";
  if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|ESOCKETTIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH/.test(message)) {
    return "CONNECT_TIMEOUT";
  }
  // Node reports hostname mismatch separately from chain-of-trust failures.
  if (/ERR_TLS_CERT_ALTNAME_INVALID|Hostname\/IP does not match/i.test(message)) return "HOSTNAME_FAILURE";
  if (/CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT|CERT_SIGNATURE_FAILURE|CERT_UNTRUSTED|ERR_TLS|SSL|TLS/.test(message)) {
    return "TLS_FAILURE";
  }
  return "UNKNOWN";
}

type HttpsProbe = { httpStatus: number };

// Any HTTP response proves DNS, TCP, TLS and hostname verification all
// succeeded — that verdict is only ever reached after a real HTTPS request
// completed with Node's default verification intact. The status then decides
// only which non-transport layer is implicated:
// - 2xx/3xx: nothing to report.
// - 4xx: the Auth endpoint answered and rejected or could not find the
//   resource. It says nothing about whether the key is correct.
// - 5xx: the Auth service or an intermediary failed. This is deliberately NOT
//   folded into the auth/config category, because the fault may be upstream of
//   the credentials.
export function applyAuthEndpointOutcome(report: SupabaseAuthTransportReport, httpStatus: number) {
  report.tls = { status: "PASS" };
  report.hostnameVerification = { status: "PASS" };
  report.authEndpoint = {
    status: httpStatus >= 200 && httpStatus < 500 ? "PASS" : "FAIL",
    httpStatus,
  };
  report.errorCategory = httpStatus >= 200 && httpStatus < 400
    ? "NONE"
    : httpStatus >= 500
      ? "UPSTREAM_SERVER_ERROR"
      : "AUTH_HTTP_ERROR";
  return report;
}

// Node validates the certificate chain before the hostname, so a name mismatch
// means chain verification actually succeeded. TLS and hostname are therefore
// reported separately, and both stay NOT_RUN for non-TLS failures (timeouts,
// refused connections) where neither check ever completed.
export function applyTransportFailureOutcome(
  report: SupabaseAuthTransportReport,
  category: SupabaseAuthTransportReport["errorCategory"],
) {
  if (category === "HOSTNAME_FAILURE") {
    report.tls = { status: "PASS" };
    report.hostnameVerification = { status: "FAIL" };
  } else if (category === "TLS_FAILURE") {
    report.tls = { status: "FAIL" };
    report.hostnameVerification = { status: "FAIL" };
  } else {
    report.tls = { status: "NOT_RUN" };
    report.hostnameVerification = { status: "NOT_RUN" };
  }
  report.errorCategory = category;
  return report;
}

function httpsProbe(url: URL, apiKey: string, signal: AbortSignal): Promise<HttpsProbe> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: "GET",
      signal,
      agent: false,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      // The status line is the only evidence needed; the body is never read.
      response.destroy();
      resolve({ httpStatus: status });
    });
    request.on("error", reject);
    request.end();
  });
}

export async function runSupabaseAuthTransportProbe(): Promise<SupabaseAuthTransportReport> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  const report = emptyReport(url, key);

  if (!url || !key) {
    report.errorCategory = "ENV_MISSING";
    return report;
  }

  let authUrl: URL;
  try {
    authUrl = new URL(`${url.replace(/\/+$/, "")}${AUTH_PATH}`);
    if (authUrl.protocol !== "https:") throw new Error("UNSUPPORTED_PROTOCOL");
  } catch {
    report.errorCategory = "ENV_MISSING";
    return report;
  }

  const dnsStarted = Date.now();
  try {
    // System DNS only: this must mirror what the Supabase SDK does at runtime.
    const addresses = await withTimeout(lookup(authUrl.hostname, { all: true }), DNS_TIMEOUT_MS, "DNS_TIMEOUT");
    report.dns = { status: addresses.length ? "PASS" : "FAIL", durationMs: Date.now() - dnsStarted };
    if (!addresses.length) {
      report.errorCategory = "DNS_FAILURE";
      return report;
    }
  } catch (error) {
    report.dns = { status: "FAIL", durationMs: Date.now() - dnsStarted };
    report.errorCategory = errorCode(error) === "DNS_TIMEOUT" ? "CONNECT_TIMEOUT" : classifyTransportError(error);
    return report;
  }

  const httpsStarted = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTPS_TIMEOUT_MS);
  try {
    const { httpStatus } = await withTimeout(httpsProbe(authUrl, key, controller.signal), HTTPS_TIMEOUT_MS, "HTTPS_TIMEOUT");
    report.https = { status: "PASS", durationMs: Date.now() - httpsStarted };
    applyAuthEndpointOutcome(report, httpStatus);
  } catch (error) {
    report.https = { status: "FAIL", durationMs: Date.now() - httpsStarted };
    const category = errorCode(error) === "HTTPS_TIMEOUT" || errorCode(error) === "ABORT_ERR"
      ? "CONNECT_TIMEOUT"
      : classifyTransportError(error);
    applyTransportFailureOutcome(report, category);
  } finally {
    clearTimeout(timer);
  }
  return report;
}

// Constant-time comparison keeps the token check free of timing side channels.
function tokenMatches(provided: string, expected: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const handleSupabaseAuthTransportProbe = async (request: Request) => {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  }
  const expected = process.env.SIGNAL_MAP_DIAGNOSTIC_TOKEN?.trim();
  if (!expected) {
    // Default-off: the endpoint must not advertise itself in production.
    return Response.json({ error: "Not found" }, { status: 404, headers });
  }
  const provided = request.headers.get("x-signal-map-diagnostic-token")?.trim() ?? "";
  if (!tokenMatches(provided, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  try {
    return Response.json(await withTimeout(runSupabaseAuthTransportProbe(), TOTAL_TIMEOUT_MS, "PROBE_TIMEOUT"), { headers });
  } catch {
    return Response.json({ error: "Diagnostic probe timed out" }, { status: 503, headers });
  }
};
