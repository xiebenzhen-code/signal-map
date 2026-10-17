export type SignalTracePhase =
  | "request_received"
  | "auth_resolved"
  | "request_parsed"
  | "research_started"
  | "research_finished"
  | "source_selection_started"
  | "source_selection_finished"
  | "search_started"
  | "search_finished"
  | "detail_fetch_started"
  | "detail_fetch_finished"
  | "aggregation_started"
  | "aggregation_finished"
  | "evidence_started"
  | "evidence_finished"
  | "evidence_preservation_finished"
  | "agent_started"
  | "budget_checked"
  | "plan_finished"
  | "agent_failed_before_source_selection"
  | "agent_failed"
  | "agent_finished"
  | "knowledge_started"
  | "knowledge_finished"
  | "persistence_started"
  | "persistence_finished"
  | "response_started"
  | "response_finished";

type TraceInput = {
  phase: SignalTracePhase;
  round?: number;
  attemptId?: string;
  attemptType?: "primary" | "fallback" | "verification";
  success?: boolean;
  itemCount?: number;
  errorCode?: string;
  errorName?: string;
  errorMessage?: string;
  topStackFrame?: string;
  failureKind?: "throw_exception" | "failure_result" | "empty_response";
  diagnostic?: Record<string, unknown>;
};

export type SignalPhaseTrace = {
  requestId: string;
  phase: SignalTracePhase;
  round?: number;
  attemptId?: string;
  attemptType?: "primary" | "fallback" | "verification";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  success: boolean;
  itemCount?: number;
  errorCode?: string;
  errorName?: string;
  errorMessage?: string;
  topStackFrame?: string;
  failureKind?: "throw_exception" | "failure_result" | "empty_response";
  diagnostic?: Record<string, unknown>;
};

function nowMs() {
  return Date.now();
}

function iso(value: number) {
  return new Date(value).toISOString();
}

function phaseGroup(phase: SignalTracePhase) {
  return phase.replace(/_(started|finished)$/, "");
}

export function createSignalsRequestId(headerValue?: string | null) {
  const provided = headerValue?.trim();
  if (provided && /^[a-z0-9._:-]{8,120}$/i.test(provided)) return provided;
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `signals-${id}`;
}

export function createSignalTracer(requestId: string) {
  const startedByGroup = new Map<string, number>();
  const records: SignalPhaseTrace[] = [];
  const sanitizeDiagnostic = (value: unknown): unknown => {
    if (value === undefined || value === null) return value;
    if (typeof value === "string") {
      return value
        .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-database-url]")
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
        .replace(/\b(password|token|token_hash|apikey|api_key|authorization|cookie)=([^&\s]+)/gi, "$1=[redacted]")
        .slice(0, 300);
    }
    if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeDiagnostic);
    if (typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
          key,
          /password|token|secret|key|authorization|cookie|database_url/i.test(key)
            ? "[redacted]"
            : sanitizeDiagnostic(entry),
        ]),
      );
    }
    return value;
  };
  const mark = ({ phase, round, attemptId, attemptType, success = true, itemCount, errorCode, errorName, errorMessage, topStackFrame, failureKind, diagnostic }: TraceInput) => {
    const finished = nowMs();
    const group = phaseGroup(phase);
    const isStart = phase.endsWith("_started") || phase === "request_received";
    const started = isStart
      ? finished
      : startedByGroup.get(group) ?? finished;
    if (isStart) startedByGroup.set(group, finished);
    const record: SignalPhaseTrace = {
      requestId,
      phase,
      ...(typeof round === "number" ? { round } : {}),
      ...(attemptId ? { attemptId } : {}),
      ...(attemptType ? { attemptType } : {}),
      startedAt: iso(started),
      finishedAt: iso(finished),
      durationMs: Math.max(0, finished - started),
      success,
      ...(typeof itemCount === "number" ? { itemCount } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(errorName ? { errorName } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      ...(topStackFrame ? { topStackFrame } : {}),
      ...(failureKind ? { failureKind } : {}),
      ...(diagnostic ? { diagnostic: sanitizeDiagnostic(diagnostic) as Record<string, unknown> } : {}),
    };
    records.push(record);
    console.info(JSON.stringify({ event: "signals_phase_trace", ...record }));
  };
  return {
    requestId,
    records,
    mark,
  };
}
