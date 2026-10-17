type Outcome = "completed" | "failed" | "incomplete";
type Observation = {
  stage: "browser_research";
  requestId: string | null;
  firstFeedbackMs: number | null;
  visibleCompletionMs: number | null;
  outcome: Outcome;
  longTaskCount: number | null;
  maxLongTaskMs: number | null;
};

// Measurements contain no prompt, account, DOM text, response or credentials.
export function createResearchObservation(now: () => number, emit: (event: Observation) => void,
  longTasks?: () => { count: number; maxMs: number } | null) {
  const started = now();
  let feedbackMs: number | null = null;
  let requestId: string | null = null;
  let finished = false;
  return {
    outcome: null as Outcome | null,
    request(id: string) { requestId = /^[a-zA-Z0-9-]{1,100}$/.test(id) ? id : null; },
    feedback() { if (feedbackMs === null) feedbackMs = Math.max(0, now() - started); },
    complete(outcome: Outcome) {
      if (finished) return;
      finished = true;
      const tasks = longTasks?.();
      emit({ stage: "browser_research", requestId, firstFeedbackMs: feedbackMs,
        visibleCompletionMs: outcome === "incomplete" ? null : Math.max(0, now() - started), outcome,
        longTaskCount: tasks?.count ?? null, maxLongTaskMs: tasks?.maxMs ?? null });
    },
  };
}

export function createBrowserResearchObservation() {
  if (typeof window === "undefined" || new URLSearchParams(window.location.search).get("observe") !== "1") return null;
  let tasks: { count: number; maxMs: number } | null = null;
  let observer: PerformanceObserver | undefined;
  try {
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      tasks = { count: 0, maxMs: 0 };
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (tasks) { tasks.count += 1; tasks.maxMs = Math.max(tasks.maxMs, entry.duration); }
        }
      });
      observer.observe({ type: "longtask" });
    }
  } catch { tasks = null; }
  const result = createResearchObservation(() => performance.now(), (event) => {
    clearTimeout(timeout);
    observer?.disconnect();
    console.info(JSON.stringify(event));
  }, () => tasks);
  const timeout = setTimeout(() => result.complete("incomplete"), 60_000);
  return result;
}
