import type { ModelCallObservation } from "./types.ts";

export function createModelUsageCollector(onRecord?: (event: ModelCallObservation) => void) {
  const calls: ModelCallObservation[] = [];
  return {
    record(event: ModelCallObservation) {
      calls.push({ ...event, usage: event.usage ? { ...event.usage } : null });
      onRecord?.(event);
    },
    snapshot() {
      const reported = calls.filter((call) => call.usage?.totalTokens != null);
      return {
        scope: "finished_transport_calls" as const,
        callCount: calls.length,
        usageCompleteness: calls.length === 0 ? "not_called" : reported.length === calls.length ? "complete" : reported.length ? "partial" : "none",
        reportedTotalTokens: reported.length ? reported.reduce((sum, call) => sum + (call.usage?.totalTokens ?? 0), 0) : null,
        cost: null,
        billingComplete: false,
        calls: calls.map((call) => ({ ...call, usage: call.usage ? { ...call.usage } : null })),
      };
    },
  };
}
