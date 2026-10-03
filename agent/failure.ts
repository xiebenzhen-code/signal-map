// Diagnostics must retain the failure cause without retaining credentials.
export function safeFailureText(value: unknown) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-database-url]")
    .replace(/(["']?\b(?:token|token_hash|apikey|api_key|authorization|cookie|password)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^&\s,;}\]]+)/gi, "$1[redacted]")
    .slice(0, 240);
}

export function knowledgeFailure(error: unknown) {
  return {
    stage: "knowledge" as const,
    code: error && typeof error === "object" && "code" in error ? safeFailureText(error.code) : "KNOWLEDGE_UPDATE_FAILED",
    message: safeFailureText(error instanceof Error ? error.message : error),
  };
}
