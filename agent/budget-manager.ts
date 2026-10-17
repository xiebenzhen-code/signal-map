export type BudgetSnapshot = {
  remainingDeadlineMs: number;
  canStartModelPlanning: boolean;
  canStartRetrieval: boolean;
  modelPlanningGuardMs: number;
  retrievalGuardMs: number;
};

export type BudgetManagerOptions = {
  deadlineAt: number;
  modelPlanningGuardMs?: number;
  retrievalGuardMs?: number;
  now?: () => number;
  /**
   * 1-based attempt number (round). Later attempts get scaled-down guards so a
   * verification round stays structurally possible: with fixed 9s/4s guards, a
   * first round that spends its budget on planning + discovery leaves <4s and
   * the fallback/verification retrieval is always WORKER_DEADLINE-blocked
   * (observed in run signals-7dd4694e: 10.7s planning + 12.2s search → 2.0s
   * left → fallback retrieval never ran).
   */
  attempt?: number;
};

export class BudgetManager {
  private readonly deadlineAt: number;
  private readonly modelPlanningGuardMs: number;
  private readonly retrievalGuardMs: number;
  private readonly now: () => number;

  constructor(options: BudgetManagerOptions) {
    this.deadlineAt = options.deadlineAt;
    const attempt = Math.max(1, options.attempt ?? 1);
    // Later attempts run inside the remaining share of the same deadline, so
    // their guards shrink: full guards on attempt 1, then halved per attempt
    // with a 1s floor (below which a retrieval cannot realistically finish).
    const scale = 1 / Math.pow(2, attempt - 1);
    this.modelPlanningGuardMs = options.modelPlanningGuardMs
      ?? Math.max(1000, Math.round(9000 * scale));
    this.retrievalGuardMs = options.retrievalGuardMs
      ?? Math.max(1000, Math.round(4000 * scale));
    this.now = options.now ?? Date.now;
  }

  remainingMs() {
    return Math.max(0, this.deadlineAt - this.now());
  }

  modelPlanningTimeoutMs() {
    const reserve = Math.max(this.modelPlanningGuardMs, this.retrievalGuardMs + 1);
    return Math.max(0, Math.min(8000, this.remainingMs() - reserve));
  }

  canStartModelPlanning() {
    return this.remainingMs() > this.modelPlanningGuardMs;
  }

  canStartRetrieval() {
    return this.remainingMs() > this.retrievalGuardMs;
  }

  shouldGracefullyStop(cumulativeEvidenceCount: number) {
    return cumulativeEvidenceCount > 0 && !this.canStartModelPlanning();
  }

  snapshot(): BudgetSnapshot {
    return {
      remainingDeadlineMs: this.remainingMs(),
      canStartModelPlanning: this.canStartModelPlanning(),
      canStartRetrieval: this.canStartRetrieval(),
      modelPlanningGuardMs: this.modelPlanningGuardMs,
      retrievalGuardMs: this.retrievalGuardMs,
    };
  }
}
