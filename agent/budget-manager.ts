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
};

export class BudgetManager {
  private readonly deadlineAt: number;
  private readonly modelPlanningGuardMs: number;
  private readonly retrievalGuardMs: number;
  private readonly now: () => number;

  constructor(options: BudgetManagerOptions) {
    this.deadlineAt = options.deadlineAt;
    this.modelPlanningGuardMs = options.modelPlanningGuardMs ?? 9000;
    this.retrievalGuardMs = options.retrievalGuardMs ?? 4000;
    this.now = options.now ?? Date.now;
  }

  remainingMs() {
    return Math.max(0, this.deadlineAt - this.now());
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
