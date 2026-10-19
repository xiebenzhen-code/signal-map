import { randomUUID } from "node:crypto";
import { knowledgeFailure, safeFailureText } from "./failure.ts";

import { runResearchPipeline } from "../research/research-pipeline.ts";
import type { ResearchResponse } from "../research/types.ts";
import { BudgetManager, type BudgetSnapshot } from "./budget-manager.ts";
import { applyAttentionPreferences, compareKnowledge, evaluateEvidence, reconcileAttentionDecision, reconcileInformationGain } from "./evaluation.ts";
import { persistResearchRecords, updateKnowledgeFromChanges } from "./knowledge-updater.ts";
import { createResearchPlan } from "./query-planner.ts";
import { planQuery } from "../research/query-planner.ts";
import { selectRelatedKnowledge } from "./memory-selection.ts";
import { ResearchRunState, mergeRoundAttempts, type EvidencePreservationSnapshot } from "./research-run-state.ts";
import { toRetrievalPlan } from "./retrieval-plan.ts";
import { chooseResearchStrategy } from "./research-policy.ts";
import { providerIdsFor, selectSource } from "./source-selector.ts";
import { officiallyCoveredEntities } from "../source-registry/resolver.ts";
import { officialTargetCoverage } from "../research/github-discovery.ts";
import { classifyIntent } from "../intent/classifier.ts";
import { mapIntentOutput } from "../intent/output-mapping.ts";
import { sourceProfileForIntent } from "../intent/source-profiles.ts";
import type { AgentRunOptions, AgentRunResult, AgentState, AgentStep, AgentTraceEntry, ResearchStrategy, SourceOutcome, SourceExecutionPlan, SourceSelectionType, ResearchPlan } from "./types.ts";

const now = () => new Date().toISOString();

// Entity recognition is not official-source coverage. Shopify resolves as an
// entity but has no company-registry profile, no official GitHub target and no
// official update page, so treating "entity resolved" as "official can execute"
// locked the run into three providers that all reported not_searched.
function officialCoverageEntities(resolvedEntities: ResearchPlan["resolvedEntities"], originalNeed = "") {
  const entities = (resolvedEntities ?? []).map((entity) => entity.canonicalEntity ?? "").filter(Boolean);
  // Coverage means "a dedicated official adapter can execute here", which needs
  // both signals: a company-registry profile (changelog/newsroom/docs) and an
  // official update target (GitHub releases / update pages). Checking only one
  // either hides usable official sources or invents coverage that does not exist.
  return Array.from(new Set([
    ...officiallyCoveredEntities({ entities, query: originalNeed }),
    ...officialTargetCoverage(entities),
  ])).map((entity) => entity.toLowerCase());
}

function appendLines(existing: string, values: string[]) {
  return [...new Set([existing, ...values].flatMap((value) => value.split(/\r?\n/)).map((value) => value.trim()).filter(Boolean))].join("\n");
}

// A retrieval attempt is identified at the level the provider actually runs:
// one provider asked one normalized query under one set of result-affecting
// parameters. Grouping a whole query set into a single signature is wrong in
// both directions — A/q1 followed by A/[q1,q2] looks brand new and re-requests
// q1, and A/q1 followed by A+B/q1 looks new as soon as B is added even though A
// is a repeat.
//
// Three counts are deliberately kept apart, because they mean different things
// and only one of them is enforceable here:
//
//   plan attempts  — how many times a research plan actually started.
//   provider units — how many (provider x query) combinations were dispatched.
//                    This is the only layer the runner can cap.
//   HTTP requests  — issued inside the retrieval pipeline. Not observable from
//                    the runner, so it is never claimed as bounded here.
//
// Admission is separate from execution: admitting a plan reserves nothing, and a
// unit is only recorded once its provider call has actually started. A source
// the plan merely allowed is therefore never counted as executed.
//
// The ledger is scoped to a single runAgent call on purpose. A process-wide or
// cross-user set would leak one run's coverage into an unrelated question.
export type AttemptUnit = { providerId: string; query: string; signature: string };

export class AttemptLedger {
  private readonly started = new Set<string>();
  private readonly maxUnits: number;
  private readonly maxSlices: number;
  private startedSlices = 0;
  private usedUnits = 0;

  constructor(maxUnits: number, maxSlices: number) {
    this.maxUnits = maxUnits;
    this.maxSlices = maxSlices;
  }

  static normalizeQuery(query: string) {
    return query.trim().toLowerCase().replace(/\s+/g, " ").replace(/[“”‘’]/g, "");
  }

  /** The (provider x query) combinations a plan would actually dispatch. */
  static units(plan: ResearchPlan): AttemptUnit[] {
    // Only genuinely result-affecting parameters belong in the signature. The
    // selected source type and the provider list describe how the run routed the
    // attempt, not what a given provider would return; including them would make
    // every re-pinned fallback look like a new combination.
    const params = [
      plan.freshnessWindow ?? "",
      JSON.stringify(plan.retrievalWindows ?? {}),
    ].join("~");
    const providers = plan.allowedProviderIds?.length
      ? plan.allowedProviderIds
      : ["*"];
    const queries = Array.from(new Set(
      (plan.queries ?? []).map(AttemptLedger.normalizeQuery).filter(Boolean),
    ));
    const units: AttemptUnit[] = [];
    for (const providerId of providers) {
      for (const query of queries) {
        units.push({ providerId, query, signature: `${providerId}|${query}|${params}` });
      }
    }
    return units;
  }

  /**
   * Reserves nothing. Reports which combinations are still new and how many the
   * remaining unit budget can still afford.
   *
   * `reserveUnits` is the capacity a caller must leave for rounds that may still
   * run. The ledger spans the whole research, so without a reservation the first
   * round can spend the entire allowance on one wide batch and leave the
   * escalation round with nothing to execute: a community-only first round then
   * "completes" without ever attempting verification. Reserving does not add
   * budget — it only defers part of the same total to the later round.
   */
  admit(plan: ResearchPlan, reserveUnits = 0) {
    const all = AttemptLedger.units(plan);
    if (!all.length) {
      return { allowed: false as const, reason: "no_retrievable_unit" as const, admitted: [] as AttemptUnit[], duplicates: [] as AttemptUnit[] };
    }
    const fresh = all.filter((unit) => !this.started.has(unit.signature));
    if (!fresh.length) {
      return { allowed: false as const, reason: "duplicate_attempt" as const, admitted: [] as AttemptUnit[], duplicates: all };
    }
    if (this.startedSlices + 1 > this.maxSlices) {
      return { allowed: false as const, reason: "slice_budget_exhausted" as const, admitted: [] as AttemptUnit[], duplicates: [] as AttemptUnit[] };
    }
    const remaining = this.maxUnits - this.usedUnits;
    if (remaining <= 0) {
      return { allowed: false as const, reason: "request_budget_exhausted" as const, admitted: [] as AttemptUnit[], duplicates: [] as AttemptUnit[] };
    }
    // A single combination is still admitted when the reservation would leave
    // nothing: making no attempt at all is never better than a partial one, and
    // the cap itself is still never exceeded.
    const affordable = Math.max(1, remaining - Math.max(0, reserveUnits));
    // Partial admission is deliberate: a batch that only partly fits still gets
    // its new combinations executed, and the next admission observes the
    // remaining zero. A batch can never buy its way past the cap.
    const admitted = fresh.slice(0, affordable);
    return {
      allowed: true as const,
      reason: (admitted.length < fresh.length ? "truncated_by_unit_budget" : undefined) as "truncated_by_unit_budget" | undefined,
      admitted,
      duplicates: all.filter((unit) => !admitted.some((keep) => keep.signature === unit.signature)),
    };
  }

  /**
   * Called immediately before one retrieval slice starts, not when the whole
   * admitted batch was released. Per-slice is the honest boundary: a slice that
   * never runs — because an earlier slice threw, the deadline closed, or the
   * allowance ran out — must not be recorded as started.
   */
  markSliceStarted(units: AttemptUnit[]) {
    for (const unit of units) this.started.add(unit.signature);
    this.startedSlices += 1;
    this.usedUnits += units.length;
  }

  /** Whether one more retrieval slice may still start, before it starts. */
  canStartSlice(unitCount: number) {
    if (this.startedSlices + 1 > this.maxSlices) return false;
    return this.usedUnits + unitCount <= this.maxUnits;
  }

  get startedSliceCount() {
    return this.startedSlices;
  }

  get maxSliceCount() {
    return this.maxSlices;
  }

  get providerQueryUnits() {
    return this.usedUnits;
  }

  get maxProviderQueryUnits() {
    return this.maxUnits;
  }
}

/**
 * Rebuilds executable plan slices from the admitted units.
 *
 * A plan's shape is (providers x queries), so the admitted set has to be
 * expressed as slices of that shape — passing a filtered provider list with the
 * full query list would re-introduce exactly the cross-product the ledger just
 * removed (A/q2 plus B/q1 has no faithful expression as {providers} x
 * {queries}).
 *
 * Providers that admitted exactly the same query set share one slice:
 * (providers x queries) then reproduces the admitted set exactly, so a plan
 * asking several providers the same question still costs a single research
 * call, as before this change. Providers whose admitted query sets differ get
 * their own slice instead of a widened cross product.
 *
 * The slice key must not be a joined string: a normalized query can contain
 * spaces, so joining and re-splitting would silently change the query.
 *
 * Each slice carries the exact units it will dispatch, so the caller can charge
 * only that slice when it actually starts.
 *
 * This goes through the one existing research execution chain; no second
 * executor is introduced.
 */
export type RetrievalSlice = { plan: ResearchPlan; units: AttemptUnit[] };

export function scopeRetrievalSlices(plan: ResearchPlan, units: AttemptUnit[]): RetrievalSlice[] {
  const queriesByProvider = new Map<string, Set<string>>();
  for (const unit of units) {
    const bucket = queriesByProvider.get(unit.providerId) ?? new Set<string>();
    bucket.add(unit.query);
    queriesByProvider.set(unit.providerId, bucket);
  }
  const slices = new Map<string, RetrievalSlice>();
  for (const [providerId, queries] of queriesByProvider) {
    const ordered = [...queries].sort();
    const key = JSON.stringify(ordered);
    const existing = slices.get(key);
    if (existing) {
      existing.plan.allowedProviderIds = providerId === "*"
        ? (plan.allowedProviderIds ? [...plan.allowedProviderIds] : undefined)
        : [...(existing.plan.allowedProviderIds ?? []), providerId];
      existing.units.push(...units.filter((unit) => unit.providerId === providerId));
      continue;
    }
    slices.set(key, {
      plan: {
        ...plan,
        allowedProviderIds: providerId === "*"
          ? (plan.allowedProviderIds ? [...plan.allowedProviderIds] : undefined)
          : [providerId],
        queries: [...ordered],
      },
      units: units.filter((unit) => unit.providerId === providerId),
    });
  }
  return Array.from(slices.values());
}

export function scopePlansByProvider(plan: ResearchPlan, units: AttemptUnit[]): ResearchPlan[] {
  return scopeRetrievalSlices(plan, units).map((slice) => slice.plan);
}

/** Honest counts for diagnostics: what was admitted, not what HTTP did. */
export function attemptUnitCounts(units: AttemptUnit[]) {
  return {
    providerQueryUnits: units.length,
    admittedProviders: Array.from(new Set(units.map((unit) => unit.providerId))),
    admittedQueries: Array.from(new Set(units.map((unit) => unit.query))),
  };
}

function sourceOutcomesFromResponse(response: ResearchResponse): SourceOutcome[] {
  if (response.sourceOutcomes?.length) {
    return response.sourceOutcomes.map((outcome) => ({
      sourceType: outcome.sourceType as SourceOutcome["sourceType"],
      providerId: outcome.providerId,
      resultCount: outcome.resultCount,
      requestCount: outcome.requestCount,
      newEvidenceCount: outcome.newEvidenceCount,
      newClaimCount: outcome.newClaimCount,
      reliabilityGain: outcome.reliabilityGain,
      conflictReduction: outcome.conflictReduction,
    }));
  }
  const signals = response.signals;
  const byType: Array<[SourceOutcome["sourceType"], ResearchResponse["signals"]]> = [
    ["OFFICIAL", signals.filter((signal) => signal.sourceTier === "S")],
    ["PRIMARY", signals.filter((signal) => signal.sourceType === "primary")],
    ["INDEPENDENT_MEDIA", signals.filter((signal) => signal.sourceType === "trusted_media" || signal.sourceType === "industry_media")],
    ["SOCIAL_SIGNAL", signals.filter((signal) => signal.sourceType === "social")],
    ["GENERAL_WEB", signals.filter((signal) => signal.sourceType !== "social")],
  ];
  return byType.map(([sourceType, items]) => ({
    sourceType,
    providerId: sourceType.toLowerCase(),
    resultCount: items.length,
    newEvidenceCount: items.filter((item) => item.knowledgeStatus !== "KNOWN").length,
    newClaimCount: items.reduce((count, item) => count + item.claims.length, 0),
    reliabilityGain: items.length ? Math.max(...items.map((item) => item.reliabilityScore)) : 0,
    conflictReduction: items.filter((item) => item.verificationStatus === "verified").length,
  }));
}

async function applyModelPlanning(options: {
  plan: AgentRunResult["plan"];
  adapter: AgentRunOptions["modelAdapter"];
  userQuery: string;
  relatedKnowledge: string[];
  previousQueries: string[];
  round: number;
  timeoutMs: number;
  onTimeout: () => void;
}) {
  if (!options.adapter || options.adapter.status !== "configured") return options.plan;
  if (options.timeoutMs <= 0) return options.plan;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = Symbol("planning timeout");
  try {
    const result = await Promise.race([options.adapter.planResearch({
      userQuery: options.userQuery,
      relatedKnowledge: options.relatedKnowledge,
      existingEvidence: [],
      previousQueries: options.previousQueries,
      round: options.round,
      signal: controller.signal,
    }), new Promise<typeof expired>((resolve) => {
      timer = setTimeout(() => { resolve(expired); controller.abort(); }, options.timeoutMs);
    })]);
    if (result === expired) { options.onTimeout(); return options.plan; }
    if (result.status !== "configured" || !result.plan) {
      if (result.errorCode === "timeout") options.onTimeout();
      return options.plan;
    }
    const queries = [...result.plan.queries, ...options.plan.queries]
      .map((query) => query.trim())
      .filter((query, index, all) => query && all.indexOf(query) === index)
      .slice(0, options.plan.maxQueries);
    return {
      ...options.plan,
      objective: result.plan.objective || options.plan.objective,
      queries,
    };
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const maxRounds = Math.min(Math.max(options.maxRounds ?? 3, 1), 3);
  const maxQueries = Math.max(options.maxQueriesPerRound ?? 5, 1);
  const startedAt = Date.now();
  const startedAtIso = now();
  const runId = options.runId ?? `agent-run-${randomUUID()}`;
  const steps: AgentStep[] = [];
  const trace: AgentTraceEntry[] = [];
  let phaseContext: { round?: number; attemptId?: string; attemptType?: "primary" | "fallback" | "verification" } = {};
  const markPhase = (phase: string, success = true, itemCount?: number, errorCode?: string, diagnostic?: Record<string, unknown>) =>
    options.onPhase?.({ phase, ...phaseContext, success, itemCount, errorCode, diagnostic });
  const deadlineAt = options.deadlineAt ?? startedAt + (options.maxExecutionTimeMs ?? 30000);
  const budget = new BudgetManager({ deadlineAt });
  const add = (state: AgentState, status: AgentStep["status"], input: unknown, output: unknown, reason?: string) => {
    const step = { state, status, input, output };
    steps.push(step);
    trace.push({ state, status, action: state.toLowerCase(), inputSummary: JSON.stringify(input).slice(0, 500), outputSummary: JSON.stringify(output).slice(0, 500), decisionReason: reason, timestamp: now() });
    return step;
  };

  add("UNDERSTAND", "completed", { query: options.input.currentQuestions || options.input.industry }, { filterContext: "accepted" });
  const persistedKnowledge = options.repository && options.context
    ? await Promise.resolve(options.repository.listPersonalKnowledge(options.context))
    : [];
  const persistedEvidence = options.repository?.listEvidence
    ? await Promise.resolve(options.repository.listEvidence())
    : [];
  const userPreferences = options.repository?.listPreferences
    ? await Promise.resolve(options.repository.listPreferences(options.context ?? { authenticatedUserId: "", filterId: "" }))
    : [];
  const previousRun = options.repository && options.context
    ? await Promise.resolve(options.repository.getLatestRunMetadata(options.context))
    : null;
  // Persisted personal-knowledge records are typed (KNOWN_INFORMATION /
  // JUDGEMENT / TRACKED_*), and each type has its own consumption path.
  // Merging every record into knownInformation turned negative judgements
  // ("Not useful: X") and view-change judgements into "known facts", which
  // penalized fresh evidence as already-known. Split by type instead:
  // - known facts → knownInformation (novelty dedup / already-known penalty)
  // - judgements  → userJudgements (judgement-impact scoring)
  // - tracked entities/events → the same-named input fields
  const knownFactRecords = persistedKnowledge.filter((record) => record.type === "KNOWN_INFORMATION");
  const judgementRecords = persistedKnowledge.filter((record) => record.type === "JUDGEMENT");
  const trackedEntityRecords = persistedKnowledge.filter((record) => record.type === "TRACKED_ENTITY");
  const trackedEventRecords = persistedKnowledge.filter((record) => record.type === "TRACKED_EVENT");
  // Read-back selection: only knowledge that shares the current question's
  // subject (and, once the plan exists, its task) may enter the research
  // context. Every record keeps its id plus a selection/exclusion reason in the
  // RETRIEVE trace; unrelated, time-sensitive or conflicted records stay in the
  // repository untouched. With no related knowledge the run proceeds normally.
  const memoryQuestion = options.userQuery ?? options.input.currentQuestions ?? options.input.industry;
  const memoryEntities = String(options.input.trackedEntities || "").split(/[,，、;；\n]/).map((item) => item.trim()).filter(Boolean);
  // Subject-level selection runs against the declared entities (and their
  // aliases) only, so a generic word inside an unrelated memory ("in" inside
  // "billing") can never bind it to this question. The lightweight plan is
  // computed from the raw input — before any memory joins the context — so the
  // alias list reflects this question, not a previous answer.
  const selectionPlan = planQuery({
    ...options.input,
    knownInformation: options.input.knownInformation,
    // Selection must judge against the *current* question: userQuery overrides
    // a stale input.currentQuestions, so an entity named in the live question
    // ("Did Model X launch?") is what the subject pass matches, not a leftover
    // tracked-entity list from an older question.
    currentQuestions: memoryQuestion,
  });
  const subjectSelection = selectRelatedKnowledge({
    records: knownFactRecords,
    query: memoryQuestion,
    entities: memoryEntities,
    plan: selectionPlan,
    // Subject pass only: task-concept fit and stability are the second
    // pass's verdict and are not repeated here.
    taskLevel: false,
  });
  const subjectDiagnostics = subjectSelection.entries.map((entry) => ({
    recordId: entry.recordId,
    selected: entry.selected,
    reason: entry.reason,
  }));
  // Task-level selection once the plan's task constraints are known: a record
  // that shares the entity but not the task (or that is time-sensitive /
  // conflicted) must not enter knownInformation — it would suppress fresh
  // evidence as already-known. The repository itself is never rewritten.
  const taskSelection = selectRelatedKnowledge({
    records: subjectSelection.selected,
    query: memoryQuestion,
    entities: memoryEntities,
    plan: selectionPlan,
  });
  const finalRelatedKnowledge = taskSelection.selected.map((record) => record.text);
  add("RETRIEVE", "completed", {
    query: memoryQuestion,
    storedRecords: knownFactRecords.length,
    subject: {
      selected: subjectDiagnostics.filter((entry) => entry.selected),
      excluded: subjectDiagnostics.filter((entry) => !entry.selected),
    },
    task: {
      selected: taskSelection.entries.filter((entry) => entry.selected).map((entry) => ({ recordId: entry.recordId, reason: entry.reason })),
      excluded: taskSelection.excluded.map((entry) => ({ recordId: entry.recordId, reason: entry.reason })),
    },
  }, finalRelatedKnowledge.join("\n") || "none");
  const intent = classifyIntent({
    userQuery: (options.userQuery ?? options.input.currentQuestions) || options.input.industry,
    filterContext: options.input,
    relatedKnowledge: finalRelatedKnowledge,
    currentGoal: options.currentGoal,
  });
  const sourceProfile = sourceProfileForIntent(intent.primaryIntent);
  add("INTENT", "completed", { query: options.userQuery ?? options.input.currentQuestions }, { intent, sourceProfile }, intent.reason);

  const researchInput = {
    ...options.input,
    knownInformation: appendLines(options.input.knownInformation, finalRelatedKnowledge),
    userJudgements: appendLines(options.input.userJudgements, judgementRecords.map((record) =>
      /^\s*(?:Not useful|Changed after evidence)\s*:/i.test(record.text)
        ? record.text.replace(/\s*\r?\n\s*/g, " ")
        : record.text)),
    trackedEntities: appendLines(options.input.trackedEntities, trackedEntityRecords.map((record) => record.text)),
    trackedEvents: appendLines(options.input.trackedEvents, trackedEventRecords.map((record) => record.text)),
  };
  const generatedFromRevision = options.context && options.repository
    ? await Promise.resolve(options.repository.getResearchContextRevision(options.context))
    : options.initialRevision ?? 1;
  // Strategy depends on whether any memory actually survived selection, not on
  // how many records the repository holds: an unrelated off-task memory must
  // not force a REFRESH when nothing relevant is present.
  const bootstrapStrategy: ResearchStrategy = finalRelatedKnowledge.length > 0 ? "REFRESH" : "INITIAL";
  // The final plan is built after both selection levels, so excluded memories
  // never shape the initial queries: knownInformation (and therefore
  // knowledgeAwareQueries / searchCombinations) reflects only what survived
  // selection.
  let plan = createResearchPlan(researchInput, 1, maxQueries, finalRelatedKnowledge, bootstrapStrategy, undefined, intent, sourceProfile);
  markPhase("source_selection_started");
  const bootstrapSelection = selectSource({
    strategy: bootstrapStrategy,
    availableSourceCapabilities: options.availableSourceCapabilities,
    sourceProfile,
    resolvedEntities: plan.resolvedEntities,
    officiallyCoveredEntities: officialCoverageEntities(plan.resolvedEntities, plan.objective),
  });
  markPhase("source_selection_finished", true, bootstrapSelection.allowedProviderIds.length, undefined, {
    strategy: bootstrapStrategy,
    intent: intent.primaryIntent,
    discoveryMode: bootstrapSelection.discoveryMode,
    resolvedEntities: plan.resolvedEntities,
    selectedSourceType: bootstrapSelection.primarySourceType,
    fallbackSourceTypes: bootstrapSelection.fallbackSourceTypes,
    allowedProviderIds: bootstrapSelection.allowedProviderIds,
    verificationSourceTypes: bootstrapSelection.verificationSourceTypes,
    sourceGap: bootstrapSelection.sourceGap,
    reason: bootstrapSelection.reason,
    sourceSelectionReason: bootstrapSelection.reason,
  });
  add("SOURCE_SELECTOR", "completed", { round: 1, strategy: bootstrapStrategy }, bootstrapSelection, bootstrapSelection.reason);
  plan = {
    ...plan,
    selectedSourceType: bootstrapSelection.primarySourceType,
    fallbackSourceTypes: bootstrapSelection.fallbackSourceTypes,
    allowedProviderIds: bootstrapSelection.allowedProviderIds,
    reason: bootstrapSelection.reason,
    sourceSelectionReason: bootstrapSelection.reason,
  };
  let response: ResearchResponse | undefined;
  const runState = new ResearchRunState();
  let evaluation = evaluateEvidence({ signals: [], status: [], queryPlan: {} as never, progress: [], failures: [], counts: {} as never, overview: {} as never, coverage: {} as never, fetchedAt: now(), dataMode: "demo" }, 1, maxRounds);
  let allKnowledgeChanges: AgentRunResult["knowledgeChanges"] = [];
  let allEvidenceIds: string[] = [];
  let previousSourceOutcomes: SourceOutcome[] = [];
  let previousStrategies: ResearchStrategy[] = (previousRun?.strategies ?? []).filter((strategy): strategy is ResearchStrategy => [
    "STOP", "REFRESH", "DEEPEN", "BROADEN", "ESCALATE_SOURCE", "VERIFY_CONFLICT", "INITIAL",
  ].includes(strategy));
  let rounds = 0;
  // One ledger per research run. Two independent caps, deliberately not
  // conflated with the deadline and not conflated with each other:
  //   maxResearchProviderQueries — (provider x query) combinations actually
  //     dispatched. HTTP requests issued inside the pipeline are NOT observable
  //     from the runner and are never claimed as bounded.
  //   maxResearchRetrievalSlices — how many retrieval slice calls may actually
  //     start. One slice is one executeResearch call, which is the honest unit:
  //     it is neither a plan nor an HTTP request.
  //
  // The approved budget was expressed in plan opportunities, and every plan
  // opportunity used to execute all of its (provider x query) combinations. The
  // default below restates that same allowance rather than adding any:
  // sliceCap x maxQueriesPerRound combinations, with the slice cap keeping the
  // previous plan-opportunity number. It is a tightening, not a grant.
  const retrievalSliceCap = options.maxResearchRetrievalSlices ?? options.maxResearchPlanAttempts ?? Math.max(maxRounds * 4, 6);
  const maxProviderQueryUnits = options.maxResearchRequests ?? retrievalSliceCap * Math.max(maxQueries, 1);
  const ledger = new AttemptLedger(maxProviderQueryUnits, retrievalSliceCap);
  /**
   * Capacity the current round must leave untouched for the rounds that may
   * still run. The allowance spans the whole research, so without a reservation
   * one round — its primary batch plus its fallback batches — can spend all of
   * it, and the escalation round then answers `request_budget_exhausted` instead
   * of attempting verification. This defers part of the same total; it never
   * grants extra. Half of what is left is the upper bound so an explicitly small
   * budget still spends most of itself in the round that needs it.
   */
  const reserveForLaterRounds = (round: number) => {
    const remaining = ledger.maxProviderQueryUnits - ledger.providerQueryUnits;
    return Math.min(
      Math.max(maxRounds - round, 0) * Math.max(maxQueries, 1),
      Math.floor(remaining / 2),
    );
  };
  const ledgerDiagnostics = () => ({
    // Both are logical counts observed at the runner boundary. Neither is the
    // number of HTTP requests the retrieval pipeline issues internally.
    researchRetrievalSliceCalls: ledger.startedSliceCount,
    maxResearchRetrievalSlices: ledger.maxSliceCount,
    researchProviderQueryUnits: ledger.providerQueryUnits,
    maxResearchProviderQueries: ledger.maxProviderQueryUnits,
  });
  const budgetDiagnostics = (snapshot: BudgetSnapshot, extra: Record<string, unknown> = {}) => ({    remainingDeadlineMsBeforeRound: snapshot.remainingDeadlineMs,
    canStartModelPlanning: snapshot.canStartModelPlanning,
    canStartRetrieval: snapshot.canStartRetrieval,
    cumulativeEvidenceCount: runState.cumulativeEvidenceCount,
    finalEvidenceCount: runState.finalEvidenceCount,
    ...extra,
  });
  const completeWithCumulativeResponse = (round: number, reason: string, extra: Record<string, unknown> = {}): AgentRunResult => {
    const cumulativeResponse = runState.cumulativeResponse;
    if (!cumulativeResponse) {
      return { status: "failed", rounds, plan, evaluation, knowledgeChanges: allKnowledgeChanges, attention: [], steps, trace };
    }
    response = cumulativeResponse;
    evaluation = evaluateEvidence(response, round, maxRounds);
    const status = evaluation.sufficientEvidence ? "completed" : "needs_more_evidence";
    markPhase("agent_finished", true, response.signals.length, undefined, {
      deadlineDegradedGracefully: true,
      cumulativeEvidenceCount: runState.cumulativeEvidenceCount,
      finalEvidenceCount: runState.finalEvidenceCount,
      reason,
      ...extra,
    });
    add("COMPLETE", status === "completed" ? "completed" : "needs_more_evidence", { round }, {
      reason: evaluation.reason,
      carriedForwardEvidence: true,
      deadlineDegradedGracefully: true,
    });
    return { status, rounds, response, plan, evaluation, knowledgeChanges: allKnowledgeChanges, attention: [], steps, trace };
  };
  const prepareRoundResponse = (roundResponse: ResearchResponse) => {
    roundResponse.intent = intent;
    roundResponse.sourceProfile = sourceProfile;
    roundResponse.outputMode = sourceProfile.outputMode;
    roundResponse.intentOutput = mapIntentOutput(roundResponse, sourceProfile);
    return roundResponse;
  };
  /**
   * The one place a retrieval slice is started.
   *
   * Per slice, in this order: check the shared deadline, check the remaining
   * slice allowance and the remaining provider-query allowance, then charge only
   * this slice's units, then run it. A slice that is never entered — because the
   * budget closed, the deadline shut, or an earlier slice threw — is never
   * charged. A slice that did start stays charged even if it fails or its result
   * is unknown, and is not retried inside this research.
   *
   * Shared by the primary and the fallback path so neither can drift into a
   * second executor.
   */
  const runRetrievalSlices = async (input: {
    plan: ResearchPlan;
    admitted: AttemptUnit[];
    attemptType: "primary" | "fallback";
    round: number;
    execute: (scopedPlan: ResearchPlan) => Promise<ResearchResponse>;
    merge: (response: ResearchResponse) => EvidencePreservationSnapshot;
    setPhaseContext: () => void;
  }) => {
    const slices = scopeRetrievalSlices(input.plan, input.admitted);
    let merged: ResearchResponse | undefined;
    const executedProviderIds = new Set<string>();
    let stopReason: "WORKER_DEADLINE" | "RESEARCH_REQUEST_BUDGET_EXHAUSTED" | undefined;
    let stopStage: string | undefined;
    for (const [index, slice] of slices.entries()) {
      const sliceBudget = input.round === 1 ? budget : new BudgetManager({ deadlineAt, attempt: input.round });
      const snapshot = sliceBudget.snapshot();
      if (!snapshot.canStartRetrieval) {
        // Deadline closed before this slice. It never starts, so it is not
        // charged, and the reason is reported rather than silently swallowed.
        markPhase("budget_checked", false, merged?.signals.length ?? 0, "WORKER_DEADLINE", budgetDiagnostics(snapshot, {
          round: input.round,
          stage: "slice_deadline_closed",
          attemptType: input.attemptType,
          notStartedSliceIndex: index,
          notStartedSliceUnits: slice.units.length,
          ...ledgerDiagnostics(),
        }));
        stopReason = "WORKER_DEADLINE";
        stopStage = "slice_deadline_closed";
        break;
      }
      if (!ledger.canStartSlice(slice.units.length)) {
        markPhase("budget_checked", false, merged?.signals.length ?? 0, "RESEARCH_REQUEST_BUDGET_EXHAUSTED", budgetDiagnostics(snapshot, {
          round: input.round,
          stage: "slice_budget_exhausted",
          attemptType: input.attemptType,
          notStartedSliceIndex: index,
          notStartedSliceUnits: slice.units.length,
          ...attemptUnitCounts(slice.units),
          ...ledgerDiagnostics(),
        }));
        stopReason = "RESEARCH_REQUEST_BUDGET_EXHAUSTED";
        stopStage = "slice_budget_exhausted";
        break;
      }
      input.setPhaseContext();
      // Charged immediately before the call: a started slice is spent even if it
      // fails or its result is unknown.
      ledger.markSliceStarted(slice.units);
      markPhase("budget_checked", true, merged?.signals.length, undefined, budgetDiagnostics(snapshot, {
        round: input.round,
        stage: "slice_started",
        attemptType: input.attemptType,
        sliceIndex: index,
        sliceCount: slices.length,
        ...attemptUnitCounts(slice.units),
        ...ledgerDiagnostics(),
      }));
      const response = prepareRoundResponse(await input.execute(slice.plan));
      input.merge(response);
      merged = merged ? prepareRoundResponse(mergeRoundAttempts(merged, response)) : response;
      for (const unit of slice.units) executedProviderIds.add(unit.providerId);
    }
    return { merged, executedProviderIds, startedSlices: slices.length, stopReason, stopStage };
  };
  const initialPlanningBudget = budget.snapshot();
  markPhase("budget_checked", true, undefined, undefined, budgetDiagnostics(initialPlanningBudget, { round: 1, stage: "initial_planning" }));
  if (initialPlanningBudget.canStartModelPlanning) {
    plan = await applyModelPlanning({
      plan,
      adapter: options.modelAdapter,
      userQuery: (options.userQuery ?? options.input.currentQuestions) || options.input.industry,
      relatedKnowledge: finalRelatedKnowledge,
      previousQueries: [],
      round: 1,
      timeoutMs: budget.modelPlanningTimeoutMs(),
      onTimeout: () => markPhase("budget_checked", true, undefined, "MODEL_PLANNING_TIMEOUT", { stage: "model_planning_timeout", fallback: "deterministic_plan" }),
    });
  }
  options.onPlan?.(plan, researchInput, 1);
  markPhase("plan_finished", true, plan.queries.length, undefined, {
    round: 1,
    agentGeneratedQueries: plan.queries,
    selectedSourceType: plan.selectedSourceType,
    fallbackSourceTypes: plan.fallbackSourceTypes,
    allowedProviderIds: plan.allowedProviderIds,
    topicProfile: plan.topicProfile,
    topicProfileSource: plan.topicProfile ? "agent_research_plan" : "unavailable",
    strategy: plan.strategy,
  });
  add("PLAN", "completed", { round: 1 }, plan);
  for (let round = 1; round <= maxRounds; round += 1) {
    if (Date.now() - startedAt > (options.maxExecutionTimeMs ?? 30000)) break;
    rounds = round;
    add("RESEARCH", "completed", { round, plan }, { started: true });
    let roundResponse: ResearchResponse | undefined;
    let preservation: EvidencePreservationSnapshot | undefined;
    const mergeAttemptResponse = (attemptResponse: ResearchResponse, attemptType: "primary" | "fallback") => {
      phaseContext = { round, attemptId: `round-${round}-${attemptType}`, attemptType };
      const snapshot = runState.mergeRoundResponse(attemptResponse);
      markPhase("evidence_preservation_finished", true, snapshot.cumulativeEvidenceCount, undefined, {
        round,
        attemptType,
        ...snapshot,
      });
      return snapshot;
    };
    try {
      const executeResearch = (currentPlan: typeof plan) => (options.research ?? ((input, selectedPlan) => runResearchPipeline(input, undefined, undefined, toRetrievalPlan(selectedPlan))))(researchInput, currentPlan, round);
      // Per-round retrieval gate scales with the attempt (same rationale as
      // the fallback gate): a fixed 4s guard makes rounds 2+ impossible after a
      // budget-heavy first round, even when the round would fit the deadline.
      const roundBudget = round === 1 ? budget : new BudgetManager({ deadlineAt, attempt: round });
      const retrievalBudget = roundBudget.snapshot();
      markPhase("budget_checked", true, undefined, undefined, budgetDiagnostics(retrievalBudget, { round, stage: "retrieval" }));
      if (!retrievalBudget.canStartRetrieval) {
        throw Object.assign(new Error("Worker deadline budget exhausted before research"), { code: "WORKER_DEADLINE" });
      }
      // The ledger spans the whole research, not one round, so a
      // (provider x query) combination that already started cannot be requested
      // again later. Admission reserves nothing; only markSliceStarted() inside
      // runRetrievalSlices, which runs immediately before each slice's provider
      // call, records anything.
      // Leave the still-to-come rounds an executable attempt. Without this the
      // first round's wide batch can consume the whole run-wide allowance and the
      // escalation round has nothing left to start, so a community-only result
      // "completes" without any verification attempt. The reservation never adds
      // budget: it only defers part of the same total, and is capped at half of
      // what is left so an explicitly small budget still spends most of itself
      // immediately.
      const admitPrimary = ledger.admit(plan, reserveForLaterRounds(round));
      if (!admitPrimary.allowed) {
        if (admitPrimary.reason === "request_budget_exhausted" || admitPrimary.reason === "slice_budget_exhausted") {
          markPhase("budget_checked", false, runState.cumulativeEvidenceCount, "RESEARCH_REQUEST_BUDGET_EXHAUSTED", budgetDiagnostics(retrievalBudget, {
            round,
            stage: admitPrimary.reason,
            ...ledgerDiagnostics(),
          }));
          return completeWithCumulativeResponse(round, "research request budget exhausted", ledgerDiagnostics());
        }
        // Everything this round would ask for already ran in an earlier round
        // or fallback, so there is nothing new to request.
        markPhase("budget_checked", true, runState.cumulativeEvidenceCount, "DUPLICATE_ATTEMPT_SKIPPED", budgetDiagnostics(retrievalBudget, {
          round,
          stage: admitPrimary.reason,
          ...ledgerDiagnostics(),
        }));
        if (runState.cumulativeResponse) {
          return completeWithCumulativeResponse(round, "all remaining attempts already executed", ledgerDiagnostics());
        }
        throw Object.assign(new Error("No executable retrieval attempt remains for this research"), { code: "WORKER_DEADLINE" });
      }
      if (admitPrimary.reason === "truncated_by_unit_budget") {
        // The batch only partly fit. It still runs, and the next admission sees
        // the reduced remaining budget, so a batch can never exceed the cap.
        markPhase("budget_checked", true, undefined, "RESEARCH_REQUEST_BUDGET_TRUNCATED", budgetDiagnostics(retrievalBudget, {
          round,
          stage: "unit_budget_truncated",
          ...attemptUnitCounts(admitPrimary.admitted),
          ...ledgerDiagnostics(),
        }));
      }
      phaseContext = { round, attemptId: `round-${round}-primary`, attemptType: "primary" };
      // Scoped per provider so only the newly admitted combinations reach the
      // pipeline — a filtered provider list with the full query list would
      // rebuild the cross-product the ledger just removed. Each slice is charged
      // only when it actually starts, inside runRetrievalSlices.
      const primaryRun = await runRetrievalSlices({
        plan,
        admitted: admitPrimary.admitted,
        attemptType: "primary",
        round,
        execute: executeResearch,
        merge: (response) => { preservation = mergeAttemptResponse(response, "primary"); return preservation as EvidencePreservationSnapshot; },
        setPhaseContext: () => { phaseContext = { round, attemptId: `round-${round}-primary`, attemptType: "primary" }; },
      });
      const executedPrimaryProviderIds = primaryRun.executedProviderIds;
      if (!primaryRun.merged) {
        // The slice executor started nothing: the shared deadline or the
        // allowance closed before the first slice. It already reported the real
        // reason and charged nothing, so there is nothing to execute here.
        // Calling executeResearch(plan) would bypass the executor and dispatch
        // an uncharged provider call. Close out on the cumulative result
        // instead, keeping the reason the executor recorded.
        return completeWithCumulativeResponse(
          round,
          primaryRun.stopReason === "WORKER_DEADLINE"
            ? "retrieval deadline closed before the first slice started"
            : "research request budget exhausted before the first slice started",
          { stage: primaryRun.stopStage, ...ledgerDiagnostics() },
        );
      }
      roundResponse = primaryRun.merged;
      if (!roundResponse.signals.length && plan.fallbackSourceTypes?.length) {
        // Declared fallbacks must actually run. Previously exactly one fallback
        // group was executed and the loop ended, so a source listed in
        // fallbackSourceTypes could be planned but never invoked (observed:
        // attempts were ["OFFICIAL","PRIMARY"] and GENERAL_WEB never ran). Walk
        // the remaining, not-yet-attempted source types instead, stopping as
        // soon as evidence appears, a source yields nothing worth retrying, or
        // the existing deadline forbids another retrieval. The total budget is
        // unchanged and a source that already ran is never repeated.
        //
        // attemptedSourceTypes only guards the source-type level. The real
        // de-duplication lives in the run-wide AttemptLedger, which is keyed by
        // provider + single query + retrieval params and also covers every
        // provider a discovery-mode attempt already started (not just the
        // selected one).
        //
        // A source type counts as attempted only when one of its providers was
        // actually dispatched. Deriving it from plan.selectedSourceType alone
        // would record a source the pipeline never called.
        const executedProviderIds = new Set(
          [...executedPrimaryProviderIds].filter((providerId) => providerId !== "*"),
        );
        const attemptedSourceTypes = new Set<SourceSelectionType>(
          (plan.selectedSourceType ? [plan.selectedSourceType] : [])
            .filter((type) => providerIdsFor(type).some((providerId) => executedProviderIds.has(providerId))),
        );
        let pendingFallbacks = plan.fallbackSourceTypes.filter(
          (type) => type !== plan.selectedSourceType && !attemptedSourceTypes.has(type),
        );
        let mergedAttempts = roundResponse;
        const skippedFallbacks: SourceSelectionType[] = [];
        while (!mergedAttempts.signals.length && pendingFallbacks.length) {
          const fallbackSourceType = pendingFallbacks[0];
          pendingFallbacks = pendingFallbacks.slice(1);
          const fallbackBudget = new BudgetManager({ deadlineAt, attempt: round });
          const fallbackRetrievalBudget = fallbackBudget.snapshot();
          markPhase("budget_checked", true, undefined, undefined, budgetDiagnostics(fallbackRetrievalBudget, { round, stage: "fallback_retrieval" }));
          if (!fallbackRetrievalBudget.canStartRetrieval) {
            // Budget exhausted. If no fallback ever got to run, this is the same
            // deadline condition the single-fallback path used to raise, so keep
            // that contract. If some already ran, stop here and report honestly
            // instead of pretending the remaining sources were covered.
            //
            // `fallback_exhausted` is not in the cloud Handler's phase
            // whitelist, so this is reported through `budget_checked`, which is
            // an already-recorded phase. Nothing here may be described as a
            // cloud-side trace field that does not actually get persisted.
            if (!attemptedSourceTypes.has(fallbackSourceType) && attemptedSourceTypes.size <= 1) {
              throw Object.assign(new Error("Worker deadline budget exhausted before fallback research"), { code: "WORKER_DEADLINE" });
            }
            markPhase("budget_checked", false, pendingFallbacks.length, "FALLBACK_BUDGET_EXHAUSTED", {
              round,
              stage: "fallback_budget_exhausted",
              notExecutedSourceTypes: [fallbackSourceType, ...pendingFallbacks],
              ...ledgerDiagnostics(),
            });
            break;
          }
          const fallbackSelection = selectSource({
            strategy: plan.strategy ?? "INITIAL",
            availableSourceCapabilities: pendingFallbacks.concat(fallbackSourceType).map((type) => ({
              type,
              available: true,
              supportsFreshness: type !== "MEMORY",
              supportsPrimaryDocuments: type === "OFFICIAL" || type === "PRIMARY",
              supportsDomainFilter: type !== "MEMORY",
              supportsTimeFilter: type !== "MEMORY",
            })),
            sourceProfile,
            previousSourceOutcomes: [
              ...previousSourceOutcomes,
              ...Array.from(attemptedSourceTypes).map((sourceType) => ({
                sourceType,
                providerId: plan.allowedProviderIds?.[0] ?? "unknown",
                resultCount: 0,
                newEvidenceCount: 0,
                newClaimCount: 0,
                reliabilityGain: 0,
                conflictReduction: 0,
              })),
            ],
            resolvedEntities: plan.resolvedEntities,
            officiallyCoveredEntities: officialCoverageEntities(plan.resolvedEntities, plan.objective),
          });
          // Pin the attempt to the source we are actually giving a chance to,
          // so the selector cannot re-pick an already-executed type.
          const executableFallback: SourceExecutionPlan = fallbackSelection.primarySourceType
            ? { ...fallbackSelection, primarySourceType: fallbackSourceType, fallbackSourceTypes: [] }
            : { ...fallbackSelection, primarySourceType: fallbackSourceType, fallbackSourceTypes: [], allowedProviderIds: providerIdsFor(fallbackSourceType) };
          phaseContext = { round, attemptId: `round-${round}-fallback`, attemptType: "fallback" };
          plan = createResearchPlan(researchInput, round, maxQueries, finalRelatedKnowledge, plan.strategy, executableFallback, intent, sourceProfile);
          markPhase("plan_finished", true, plan.queries.length, undefined, {
            round,
            fallback: true,
            agentGeneratedQueries: plan.queries,
            selectedSourceType: plan.selectedSourceType,
            fallbackSourceTypes: plan.fallbackSourceTypes,
            allowedProviderIds: plan.allowedProviderIds,
            topicProfile: plan.topicProfile,
            topicProfileSource: plan.topicProfile ? "agent_research_plan" : "unavailable",
            strategy: plan.strategy,
          });
          add("SOURCE_SELECTOR", "completed", { round, fallback: true }, executableFallback, `首选来源无有效结果，执行 fallback 来源 ${fallbackSourceType}`);
          // A fallback that would repeat an identical provider + query + params
          // combination must not spend another unit. A different query on a
          // provider that already started is a legitimately new attempt and is
          // admitted normally, subject to the run-wide provider-query cap.
          const admitFallback = ledger.admit(plan, reserveForLaterRounds(round));
          if (!admitFallback.allowed) {
            skippedFallbacks.push(fallbackSourceType);
            const budgetExhausted = admitFallback.reason === "request_budget_exhausted"
              || admitFallback.reason === "slice_budget_exhausted";
            markPhase("budget_checked", false, pendingFallbacks.length + 1,
              budgetExhausted ? "RESEARCH_REQUEST_BUDGET_EXHAUSTED" : "DUPLICATE_ATTEMPT_SKIPPED", {
                round,
                stage: admitFallback.reason,
                skippedSourceType: fallbackSourceType,
                skippedProviderIds: plan.allowedProviderIds,
                ...ledgerDiagnostics(),
              });
            if (budgetExhausted) break;
            continue;
          }
          if (admitFallback.reason === "truncated_by_unit_budget") {
            markPhase("budget_checked", true, undefined, "RESEARCH_REQUEST_BUDGET_TRUNCATED", {
              round,
              stage: "unit_budget_truncated",
              sourceType: fallbackSourceType,
              ...attemptUnitCounts(admitFallback.admitted),
              ...ledgerDiagnostics(),
            });
          }
          phaseContext = { round, attemptId: `round-${round}-fallback`, attemptType: "fallback" };
          // Same slice executor as the primary path: each slice is charged only
          // when it actually starts, so a slice that never runs is never marked
          // started. A started slice stays charged even if it fails or its result
          // is unknown, and is never retried inside this research.
          const fallbackRun = await runRetrievalSlices({
            plan,
            admitted: admitFallback.admitted,
            attemptType: "fallback",
            round,
            execute: executeResearch,
            merge: (response) => { preservation = mergeAttemptResponse(response, "fallback"); return preservation as EvidencePreservationSnapshot; },
            setPhaseContext: () => { phaseContext = { round, attemptId: `round-${round}-fallback`, attemptType: "fallback" }; },
          });
          const fallbackExecutedProviderIds = fallbackRun.executedProviderIds;
          if (fallbackRun.merged) {
            mergedAttempts = prepareRoundResponse(mergeRoundAttempts(mergedAttempts, fallbackRun.merged));
          }
          if (providerIdsFor(fallbackSourceType).some((providerId) => fallbackExecutedProviderIds.has(providerId))) {
            attemptedSourceTypes.add(fallbackSourceType);
          }
        }
        if (pendingFallbacks.length && !mergedAttempts.signals.length) {
          // Also reported through `budget_checked`: `fallback_exhausted` is not
          // in the Handler phase whitelist, so it never reaches the cloud trace.
          markPhase("budget_checked", true, mergedAttempts.signals.length, "FALLBACK_SOURCES_NOT_EXECUTED", {
            round,
            stage: "fallback_not_executed",
            notExecutedSourceTypes: pendingFallbacks,
            skippedDuplicateSourceTypes: skippedFallbacks,
            ...ledgerDiagnostics(),
          });
        }
        roundResponse = mergedAttempts;
      }
    } catch (error) {
      const errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN_RESEARCH_FAILURE";
      const preservedResponse = runState.cumulativeResponse;
      if (errorCode === "WORKER_DEADLINE" && runState.cumulativeEvidenceCount > 0 && preservedResponse) {
        const snapshot = budget.snapshot();
        markPhase("budget_checked", false, runState.cumulativeEvidenceCount, errorCode, budgetDiagnostics(snapshot, {
          round,
          stage: "deadline_degrade_after_research_error",
          deadlineDegradedGracefully: true,
          skippedNextRoundDueToBudget: true,
        }));
        add("RESEARCH", "needs_more_evidence", { round }, { error: "deadline degraded gracefully" }, error instanceof Error ? error.message : "unknown error");
        return completeWithCumulativeResponse(round, "worker deadline after cumulative evidence", budgetDiagnostics(snapshot, {
          skippedNextRoundDueToBudget: true,
        }));
      }
      if (errorCode === "WORKER_DEADLINE" && preservedResponse) {
        const snapshot = budget.snapshot();
        const reason = "deadline_exhausted_no_evidence";
        const diagnostic = budgetDiagnostics(snapshot, {
          round,
          stage: "deadline_degrade_without_evidence",
          deadlineDegradedGracefully: true,
          skippedNextRoundDueToBudget: true,
          reason,
        });
        markPhase("budget_checked", false, 0, errorCode, diagnostic);
        markPhase("agent_finished", true, 0, errorCode, diagnostic);
        add("RESEARCH", "needs_more_evidence", { round }, { reason }, error instanceof Error ? error.message : "unknown error");
        add("COMPLETE", "needs_more_evidence", { round }, { reason });
        return {
          status: "needs_more_evidence",
          reason,
          rounds,
          response: preservedResponse,
          plan,
          evaluation,
          knowledgeChanges: allKnowledgeChanges,
          attention: [],
          steps,
          trace,
        };
      }
      markPhase("agent_finished", false, undefined, errorCode);
      add("RESEARCH", "failed", { round }, { error: "research failed" }, error instanceof Error ? error.message : "unknown error");
      if (runState.cumulativeEvidenceCount > 0 && preservedResponse) {
        response = preservedResponse;
        evaluation = evaluateEvidence(response, round, maxRounds);
        const preservation = runState.providerFailureSnapshot();
        markPhase("evidence_preservation_finished", false, preservation.cumulativeEvidenceCount, undefined, {
          round,
          ...preservation,
        });
        const status = evaluation.sufficientEvidence ? "completed" : "needs_more_evidence";
        add("COMPLETE", status === "completed" ? "completed" : "needs_more_evidence", { round }, { reason: evaluation.reason, carriedForwardEvidence: true });
        return { status, rounds, response, plan, evaluation, knowledgeChanges: allKnowledgeChanges, attention: [], steps, trace };
      }
      return { status: "failed", failure: { stage: "retrieval", code: safeFailureText(errorCode), message: safeFailureText(error instanceof Error ? error.message : error) }, rounds, plan, evaluation, knowledgeChanges: [], attention: [], steps, trace };
    }
    const cumulativeResponse = runState.cumulativeResponse;
    if (!cumulativeResponse) throw Object.assign(new Error("Missing cumulative response after round merge"), { code: "UNKNOWN_RESEARCH_FAILURE" });
    cumulativeResponse.intent = intent;
    cumulativeResponse.sourceProfile = sourceProfile;
    cumulativeResponse.outputMode = sourceProfile.outputMode;
    cumulativeResponse.intentOutput = mapIntentOutput(cumulativeResponse, sourceProfile);
    response = cumulativeResponse;
    reconcileInformationGain(response, persistedKnowledge, persistedEvidence);
    for (const signal of response.signals) reconcileAttentionDecision(signal);
    applyAttentionPreferences(response, userPreferences);
    add("RESEARCH", "completed", { round }, {
      signals: response.signals.length,
      dataMode: response.dataMode,
      roundEvidenceCount: preservation?.roundEvidenceCount ?? 0,
      cumulativeEvidenceCount: preservation?.cumulativeEvidenceCount ?? runState.cumulativeEvidenceCount,
      carriedForwardEvidenceCount: preservation?.carriedForwardEvidenceCount ?? 0,
      verificationOutcome: preservation?.verificationOutcome ?? "no_evidence",
    });
    const currentSourceOutcomes = sourceOutcomesFromResponse(roundResponse);
    evaluation = evaluateEvidence(response, round, maxRounds);
    add("EVALUATE", evaluation.decision === "CONTINUE" ? "needs_more_evidence" : "completed", { round }, evaluation, evaluation.reason);
    const reliabilityState = response.signals.length === 0
      ? "unknown"
      : response.signals.every((signal) => signal.reliabilityScore >= 70) ? "high"
        : response.signals.some((signal) => signal.reliabilityScore >= 70) ? "mixed" : "low";
    const freshnessState = response.signals.length > 0 && response.signals.every((signal) => signal.eventStatus === "BACKGROUND")
      ? "stale" : response.signals.length > 0 ? "fresh" : "unknown";
    const policyInput = {
      currentEvidence: response,
      relatedKnowledge: finalRelatedKnowledge,
      conflictState: evaluation,
      sourceCoverage: response.coverage,
      freshnessState,
      reliabilityState,
      informationGain: evaluation.informationGain,
      round,
      maxRounds,
      previousStrategies,
    } as const;
    const policy = chooseResearchStrategy(policyInput);
    add("POLICY", "completed", {
      round,
      informationGain: evaluation.informationGain,
      sourceCoverage: response.coverage.level,
      reliabilityState,
      freshnessState,
    }, policy, policy.reason);
    phaseContext = { round, attemptId: `round-${round}-primary`, attemptType: "primary" };
    markPhase("source_selection_started");
    const sourceSelection = selectSource({
      strategy: policy.strategy,
      availableSourceCapabilities: options.availableSourceCapabilities,
      previousSourceOutcomes,
      sourceProfile,
      resolvedEntities: plan.resolvedEntities,
      officiallyCoveredEntities: officialCoverageEntities(plan.resolvedEntities, plan.objective),
    });
    markPhase("source_selection_finished", true, sourceSelection.allowedProviderIds.length, undefined, {
      strategy: policy.strategy,
      intent: intent.primaryIntent,
      discoveryMode: sourceSelection.discoveryMode,
      resolvedEntities: plan.resolvedEntities,
      selectedSourceType: sourceSelection.primarySourceType,
      fallbackSourceTypes: sourceSelection.fallbackSourceTypes,
      allowedProviderIds: sourceSelection.allowedProviderIds,
      verificationSourceTypes: sourceSelection.verificationSourceTypes,
      sourceGap: sourceSelection.sourceGap,
      reason: sourceSelection.reason,
      sourceSelectionReason: sourceSelection.reason,
    });
    add("SOURCE_SELECTOR", policy.strategy === "STOP" ? "skipped" : "completed", { round, strategy: policy.strategy }, sourceSelection, sourceSelection.reason);
    trace[trace.length - 1].selectedSourceType = sourceSelection.primarySourceType;
    trace[trace.length - 1].fallbackSourceTypes = sourceSelection.fallbackSourceTypes;
    trace[trace.length - 1].sourceSelectionReason = sourceSelection.reason;
    trace[trace.length - 1].sourceOutcome = sourceSelection.primarySourceType
      ? currentSourceOutcomes.find((outcome) => outcome.sourceType === sourceSelection.primarySourceType)
      : undefined;
    add("STRATEGY", policy.strategy === "STOP" ? "completed" : "needs_more_evidence", { round }, policy, policy.reason);
    trace[trace.length - 1].strategy = policy.strategy;
    trace[trace.length - 1].strategyReason = policy.reason;
    trace[trace.length - 1].policyInputsSummary = JSON.stringify(policyInput).slice(0, 500);
    previousStrategies = [...previousStrategies, policy.strategy];
    previousSourceOutcomes = [...previousSourceOutcomes, ...currentSourceOutcomes];
    if (policy.strategy === "STOP") {
      const changes = compareKnowledge(
        response,
        researchInput.knownInformation,
        generatedFromRevision,
        persistedKnowledge,
        persistedEvidence,
      );
      const finalAttention = !evaluation.sufficientEvidence || evaluation.conflictDetected
        ? []
        : response.signals.map((signal) => signal.attentionDecision);
      if (options.repository && options.context) {
        try {
          markPhase("knowledge_started");
          const updateResult = await updateKnowledgeFromChanges({
            context: options.context,
            repository: options.repository,
            response,
            changes,
            runId,
            now: now(),
          });
          markPhase("knowledge_finished", true, updateResult.evidenceIds.length);
          allKnowledgeChanges = [...allKnowledgeChanges, ...updateResult.persistedChanges];
          allEvidenceIds = Array.from(new Set([...allEvidenceIds, ...updateResult.evidenceIds]));
        } catch (error) {
          const failure = knowledgeFailure(error);
          options.onPhase?.({ ...phaseContext, phase: "knowledge_finished", success: false, errorCode: failure.code, errorMessage: failure.message });
          add("UPDATE_KNOWLEDGE", "failed", { round }, { error: "knowledge update failed" }, failure.message);
          return { status: "failed", failure, rounds, response, plan, evaluation, knowledgeChanges: allKnowledgeChanges, attention: [], steps, trace };
        }
      } else {
        allKnowledgeChanges = [...allKnowledgeChanges, ...changes];
      }
      add("UPDATE_KNOWLEDGE", "completed", { round }, { changes: changes.length });
      add("ATTENTION", "completed", { round }, { decisions: finalAttention });
      add("COMPLETE", "completed", { round }, { reason: evaluation.reason });
      const status = evaluation.sufficientEvidence ? "completed" : "needs_more_evidence";
      if (options.repository && options.context) {
        markPhase("persistence_started");
        await Promise.resolve(options.repository.saveRunMetadata(options.context, {
          id: runId,
          userQuery: options.userQuery,
          startedAt: startedAtIso,
          completedAt: now(),
          status,
          rounds,
          evidenceIds: allEvidenceIds,
          knowledgeChanges: allKnowledgeChanges,
          attentionResult: finalAttention,
          strategies: previousStrategies,
          trace,
          generatedFromResearchContextRevision: generatedFromRevision,
          dataMode: response.dataMode,
          createdAt: startedAtIso,
        }));
        markPhase("persistence_finished", true);
      }
      return { status, rounds, response, plan, evaluation, knowledgeChanges: allKnowledgeChanges, attention: finalAttention, steps, trace };
    }
    if (options.repository && options.context) {
      try {
        markPhase("knowledge_started");
        const evidenceOnly = await persistResearchRecords({ repository: options.repository, response: roundResponse });
        markPhase("knowledge_finished", true, evidenceOnly.evidenceIds.length);
        allEvidenceIds = Array.from(new Set([...allEvidenceIds, ...evidenceOnly.evidenceIds]));
        add("UPDATE_KNOWLEDGE", "skipped", { round }, { evidenceOnly: true, evidenceIds: evidenceOnly.evidenceIds }, "研究未结束，仅保存 Evidence provenance");
      } catch (error) {
        const failure = knowledgeFailure(error);
        options.onPhase?.({ ...phaseContext, phase: "knowledge_finished", success: false, errorCode: failure.code, errorMessage: failure.message });
        add("UPDATE_KNOWLEDGE", "failed", { round }, { error: "evidence persistence failed" }, failure.message);
        return { status: "failed", failure, rounds, response, plan, evaluation, knowledgeChanges: allKnowledgeChanges, attention: [], steps, trace };
      }
    }
    phaseContext = { round: round + 1, attemptId: `round-${round + 1}-primary`, attemptType: "primary" };
    const nextRoundBudget = budget.snapshot();
    markPhase("budget_checked", true, runState.cumulativeEvidenceCount, undefined, budgetDiagnostics(nextRoundBudget, {
      round: round + 1,
      stage: "next_round_planning",
      skippedNextRoundDueToBudget: budget.shouldGracefullyStop(runState.cumulativeEvidenceCount),
    }));
    if (budget.shouldGracefullyStop(runState.cumulativeEvidenceCount)) {
      return completeWithCumulativeResponse(round, "insufficient budget before next round planning", budgetDiagnostics(nextRoundBudget, {
        skippedNextRoundDueToBudget: true,
      }));
    }
    plan = createResearchPlan(researchInput, round + 1, maxQueries, finalRelatedKnowledge, policy.strategy, sourceSelection, intent, sourceProfile);
    const nextPlanningBudget = budget.snapshot();
    markPhase("budget_checked", true, runState.cumulativeEvidenceCount, undefined, budgetDiagnostics(nextPlanningBudget, {
      round: round + 1,
      stage: "model_planning",
    }));
    if (nextPlanningBudget.canStartModelPlanning) {
      try {
        plan = await applyModelPlanning({
          plan,
          adapter: options.modelAdapter,
          userQuery: (options.userQuery ?? options.input.currentQuestions) || options.input.industry,
          relatedKnowledge: finalRelatedKnowledge,
          previousQueries: plan.queries,
          round: round + 1,
          timeoutMs: budget.modelPlanningTimeoutMs(),
          onTimeout: () => markPhase("budget_checked", true, undefined, "MODEL_PLANNING_TIMEOUT", { stage: "model_planning_timeout", fallback: "deterministic_plan" }),
        });
      } catch (error) {
        const errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN_RESEARCH_FAILURE";
        if (errorCode === "WORKER_DEADLINE" && runState.cumulativeEvidenceCount > 0) {
          const snapshot = budget.snapshot();
          markPhase("budget_checked", false, runState.cumulativeEvidenceCount, errorCode, budgetDiagnostics(snapshot, {
            round: round + 1,
            stage: "model_planning",
            deadlineDegradedGracefully: true,
            skippedNextRoundDueToBudget: true,
          }));
          return completeWithCumulativeResponse(round, "worker deadline during next round planning", budgetDiagnostics(snapshot, {
            skippedNextRoundDueToBudget: true,
          }));
        }
        throw error;
      }
    }
    options.onPlan?.(plan, researchInput, round + 1);
    markPhase("plan_finished", true, plan.queries.length, undefined, {
      round: round + 1,
      agentGeneratedQueries: plan.queries,
      selectedSourceType: plan.selectedSourceType,
      fallbackSourceTypes: plan.fallbackSourceTypes,
      allowedProviderIds: plan.allowedProviderIds,
      topicProfile: plan.topicProfile,
      topicProfileSource: plan.topicProfile ? "agent_research_plan" : "unavailable",
      strategy: plan.strategy,
    });
    add("PLAN", "completed", { round: round + 1 }, plan);
  }
  add("COMPLETE", "needs_more_evidence", { rounds }, { reason: "execution limit" });
  return { status: "needs_more_evidence", rounds, response, plan, evaluation, knowledgeChanges: [], attention: [], steps, trace };
}
