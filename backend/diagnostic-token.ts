// Shared gate for operator-only diagnostic endpoints.
//
// Both transport probes must use the same decision function so that a missing
// configuration, a missing token and a wrong token always produce identical
// status codes across endpoints. The comparison itself is constant-time: a
// length mismatch still performs one comparison so the rejection path keeps a
// similar cost profile to the success path.
import { timingSafeEqual } from "node:crypto";

export type DiagnosticTokenGate = "disabled" | "unauthorized" | "allowed";

export const DIAGNOSTIC_TOKEN_HEADER = "x-signal-map-diagnostic-token";

export function evaluateDiagnosticToken(
  provided: string | null | undefined,
  expected: string | undefined,
): DiagnosticTokenGate {
  const expectedValue = expected?.trim();
  // Default-off: without a configured token the endpoint must not advertise
  // itself at all, not even with a 401.
  if (!expectedValue) return "disabled";

  const providedValue = provided?.trim() ?? "";
  const providedBuffer = Buffer.from(providedValue);
  const expectedBuffer = Buffer.from(expectedValue);
  if (providedBuffer.length !== expectedBuffer.length) {
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return "unauthorized";
  }
  return timingSafeEqual(providedBuffer, expectedBuffer) ? "allowed" : "unauthorized";
}
