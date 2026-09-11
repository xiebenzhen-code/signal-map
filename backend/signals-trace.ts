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
  | "agent_started"
  | "agent_finished"
  | "knowledge_started"
  | "knowledge_finished"
  | "persistence_started"
  | "persistence_finished"
  | "response_started"
  | "response_finished";

type TraceInput = {
  phase: SignalTracePhase;
  success?: boolean;
  itemCount?: number;
  errorCode?: string;
};

export type SignalPhaseTrace = {
  requestId: string;
  phase: SignalTracePhase;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  success: boolean;
  itemCount?: number;
  errorCode?: string;
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
  const mark = ({ phase, success = true, itemCount, errorCode }: TraceInput) => {
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
      startedAt: iso(started),
      finishedAt: iso(finished),
      durationMs: Math.max(0, finished - started),
      success,
      ...(typeof itemCount === "number" ? { itemCount } : {}),
      ...(errorCode ? { errorCode } : {}),
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
