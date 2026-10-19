import { conceptGroupsInText } from "../research/topic-relevance.ts";
import type { PersonalKnowledgeRecord } from "../information/rag-records.ts";
import type { QueryPlan } from "../research/types.ts";

// Knowledge read-back selection. Persisted records of one user+scope used to be
// appended to the research context wholesale, so unrelated memories (tracked
// entities from other questions, stale or conflicted facts) rewrote the current
// question and its topic. Selection reuses the existing task-concept groups
// (topic-relevance.ts) — it is a new consumption policy, not a second
// retrieval/judgement system.

export type KnowledgeSelectionReason =
  | "subject_selected"
  | "no_shared_subject"
  | "task_concepts_overlap"
  | "task_concepts_disjoint"
  | "needs_reverification"
  | "conflicted_record";

export type KnowledgeSelectionEntry = {
  record: PersonalKnowledgeRecord;
  recordId: string;
  selected: boolean;
  reason: KnowledgeSelectionReason;
};

export type KnowledgeSelection = {
  entries: KnowledgeSelectionEntry[];
  /** Records that enter the research context (subject-relevant, task-compatible, stable). */
  selected: PersonalKnowledgeRecord[];
  excluded: KnowledgeSelectionEntry[];
};

function subjectTerms(query: string, entities: string[]) {
  const terms = new Set<string>();
  for (const value of [query, ...entities]) {
    const normalized = String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!normalized) continue;
    for (const token of normalized.split(" ")) {
      if (token.length >= 2) terms.add(token);
    }
  }
  return [...terms];
}

/** Stable = verified fact; a recorded non-verified or conflicted status marks a
 *  time-sensitive / contradicted fact that must not enter the context as
 *  settled knowledge (fresh evidence may re-establish it). Records without a
 *  recorded status (legacy rows, migrations) cannot be judged and stay
 *  readable — over-rejecting them would silently widen amnesia; their write
 *  path was already gated when they were created. */
function stability(record: PersonalKnowledgeRecord): "stable" | "needs_reverification" | "conflicted" {
  const payload = record.structuredPayload as { verificationStatus?: string } | undefined;
  const status = payload?.verificationStatus;
  if (status === "conflicting") return "conflicted";
  if (status === "partially_verified" || status === "unverified") return "needs_reverification";
  return "stable";
}

function questionConceptGroups(plan?: QueryPlan): string[][] {
  if (!plan) return [];
  const declared = [...(plan.coreKeywords || []), ...plan.synonyms, ...(plan.topicKeywords || [])].join(" ");
  return conceptGroupsInText(declared);
}

export function selectRelatedKnowledge(options: {
  records: PersonalKnowledgeRecord[];
  query: string;
  entities: string[];
  /** Plan of the current question. Without it only subject-level selection runs. */
  plan?: QueryPlan;
}): KnowledgeSelection {
  const { records, query, entities, plan } = options;
  const terms = subjectTerms(query, entities);
  const questionGroups = questionConceptGroups(plan);
  const entries: KnowledgeSelectionEntry[] = [];
  for (const record of records) {
    const recordId = record.id ?? record.text;
    const haystack = record.text.toLowerCase();
    const sharesSubject = terms.length === 0 || terms.some((term) => haystack.includes(term));
    if (!sharesSubject) {
      entries.push({ record, recordId, selected: false, reason: "no_shared_subject" });
      continue;
    }
    // Subject pass only decides topical relevance. Stability (time-sensitive /
    // conflicted facts) and task-concept compatibility are judged once the
    // current question's plan is available — splitting them here would hide
    // the deciding reason at the wrong layer.
    if (!plan) {
      entries.push({ record, recordId, selected: true, reason: "subject_selected" });
      continue;
    }
    // Task pass: a stored fact naming a different task concept than the
    // question asks about belongs to another question's answer and must not
    // enter this context. A fact naming no task concept ("Model X is
    // available") is kept — it may be exactly this question's earlier answer,
    // and excluding it would be guessing. Stability then keeps time-sensitive
    // and conflicted facts out of settled context.
    const recordGroups = conceptGroupsInText(record.text);
    const disjoint = questionGroups.length > 0 && recordGroups.length > 0 &&
      !questionGroups.some((questionGroup) =>
        recordGroups.some((recordGroup) => questionGroup === recordGroup));
    if (disjoint) {
      entries.push({ record, recordId, selected: false, reason: "task_concepts_disjoint" });
      continue;
    }
    const state = stability(record);
    if (state === "conflicted") {
      entries.push({ record, recordId, selected: false, reason: "conflicted_record" });
      continue;
    }
    if (state === "needs_reverification") {
      entries.push({ record, recordId, selected: false, reason: "needs_reverification" });
      continue;
    }
    entries.push({
      record,
      recordId,
      selected: true,
      reason: questionGroups.length > 0 && recordGroups.length > 0 ? "task_concepts_overlap" : "subject_selected",
    });
  }
  const selected = entries.filter((entry) => entry.selected).map((entry) => entry.record);
  const excluded = entries.filter((entry) => !entry.selected).map((entry) => ({ ...entry }));
  return { entries, selected, excluded };
}
