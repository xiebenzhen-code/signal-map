import { conceptGroupsInText, GENERIC_TERMS, matches, normalize } from "../research/topic-relevance.ts";
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

// Words that can never open a query subject phrase: interrogatives and
// auxiliary verbs at the start of a capitalized run ("Did Model X ...",
// "What changed ..."). The run after them is the subject; they are not.
const SUBJECT_PHRASE_LEADERS = new Set([
  "what", "which", "why", "how", "when", "where", "who", "whom", "whose",
  "did", "do", "does", "is", "are", "was", "were", "will", "would",
  "can", "could", "should", "may", "might", "am", "be", "been",
]);

// A capitalized run in the question ("Model X", "Apple Vision Pro") is a full
// subject phrase: it is kept whole so the qualified subject survives, instead
// of being reduced to its generic head noun ("model" is a generic word and
// must not bind a subject). A run may open with an interrogative/auxiliary
// capital ("Did Model X", "Is Model Y"): leading leaders are stripped and the
// rest of the run is the subject. A phrase that is entirely generic ("API",
// "AI") names no subject and is dropped; single generic head nouns never
// stand in for a subject.
function subjectPhrases(query: string): string[] {
  const phrases: string[] = [];
  for (const run of query.match(/\b[A-Z][A-Za-z0-9.'-]*(?:\s+[A-Z][A-Za-z0-9.'-]*){0,2}\b/g) || []) {
    const normalized = normalize(run);
    if (!normalized) continue;
    const words = normalized.split(" ");
    // Strip interrogative/auxiliary leaders at the head of the run
    // ("Did Model X" -> "Model X") instead of dropping the whole run.
    const firstSubjectWord = words.findIndex((word) => !SUBJECT_PHRASE_LEADERS.has(word));
    if (firstSubjectWord < 0) continue;
    const subject = words.slice(firstSubjectWord).join(" ");
    // A phrase whose every word is generic (e.g. "AI", "API", "New Release")
    // is not a subject; a qualified phrase ("Model X") survives because at
    // least one token is specific.
    if (subject.split(" ").every((token) => GENERIC_TERMS.has(token))) continue;
    phrases.push(subject);
  }
  return phrases;
}

// Subject anchors come from the declared entities (and their aliases) plus the
// question's own capitalized subject phrases: the entities are the unambiguous
// subject, and the full qualified phrase ("Model X") binds same-subject records
// even when the planner treats the head noun as generic. Every match is
// word-boundary ("in" can no longer match inside "billing"), and generic
// single words ("model", "launch", "payment") never stand in for a subject.
function subjectTerms(query: string, entities: string[], plan?: QueryPlan) {
  const terms = new Set<string>();
  const addValue = (value: string | undefined) => {
    const normalized = normalize(value ?? "");
    if (normalized) terms.add(normalized);
  };
  for (const entity of entities) addValue(entity);
  for (const alias of plan?.aliasesConsidered ?? []) addValue(alias);
  for (const resolved of plan?.resolvedEntities ?? []) {
    addValue(resolved.canonicalEntity);
    for (const alias of resolved.aliasesConsidered ?? []) addValue(alias);
  }
  for (const phrase of subjectPhrases(query)) terms.add(phrase);
  return [...terms];
}

function subjectHit(text: string, term: string) {
  // matches() applies latin word boundaries and falls back to substring only
  // for non-latin scripts, so "in" can no longer match inside "billing" and
  // "Node.js" still matches "Node.js 发布了 v22".
  return matches(text, term);
}

// Time-sensitive fact categories: their truth value decays with time, so an
// old record must be re-verified before it enters a question about the current
// value. Stable facts (an office location, an ownership fact) do not expire.
const TIME_SENSITIVE_FACT = /\b(?:price|pricing|cost|costs|fee|fees|rate|rates|percent|percentage|payment processing|discount|promotion|version|versions|release|releases|release line|available|availability|supported|support|policy|policies|plan price|subscription price|revenue|revenues|用户数|收入|营收)\b|价格|定价|费用|费率|折扣|优惠|政策|版本|收费|订阅价/iu;
const FRESHNESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Stable = verified fact that is still current; a recorded non-verified or
 *  conflicted status marks a time-sensitive / contradicted fact that must not
 *  enter the context as settled knowledge (fresh evidence may re-establish
 *  it). Verification state and fact freshness are deliberately separate: a
 *  verified 2022 price is *verified* but no longer *current*. Records without
 *  a recorded status (legacy rows, migrations) cannot be judged and stay
 *  readable — over-rejecting them would silently widen amnesia; their write
 *  path was already gated when they were created. */
function stability(record: PersonalKnowledgeRecord): "stable" | "needs_reverification" | "conflicted" {
  const payload = record.structuredPayload as { verificationStatus?: string } | undefined;
  const status = payload?.verificationStatus;
  if (status === "conflicting") return "conflicted";
  if (status === "partially_verified" || status === "unverified") return "needs_reverification";
  if (TIME_SENSITIVE_FACT.test(record.text)) {
    const recordDate = Math.max(new Date(record.updatedAt).getTime(), new Date(record.createdAt).getTime());
    if (Number.isFinite(recordDate) && Date.now() - recordDate > FRESHNESS_WINDOW_MS) {
      return "needs_reverification";
    }
  }
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
  /** Run the task pass (task-concept + stability) too. The subject pass of the
   *  two-level read-back only decides topical relevance; the task pass is the
   *  second, separate verdict. Passing taskLevel=false keeps the subject pass
   *  from repeating the task pass' judgement on a later subset. */
  taskLevel?: boolean;
}): KnowledgeSelection {
  const { records, query, entities, plan, taskLevel = true } = options;
  const terms = subjectTerms(query, entities, plan);
  const questionGroups = questionConceptGroups(plan);
  const entries: KnowledgeSelectionEntry[] = [];
  for (const record of records) {
    const recordId = record.id ?? record.text;
    const haystack = normalize(record.text);
    const sharesSubject = terms.length === 0 || terms.some((term) => subjectHit(haystack, term));
    if (!sharesSubject) {
      entries.push({ record, recordId, selected: false, reason: "no_shared_subject" });
      continue;
    }
    // Subject pass only decides topical relevance. Stability (time-sensitive /
    // conflicted facts) and task-concept compatibility are judged once the
    // current question's plan is available — splitting them here would hide
    // the deciding reason at the wrong layer.
    if (!plan || !taskLevel) {
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
