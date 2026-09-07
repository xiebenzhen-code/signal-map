export type TaskAnalysisMode = "SINGLE_TASK" | "DECOMPOSE";

export type TaskAnalysis = {
  mode: TaskAnalysisMode;
  reasons: string[];
};

type TaskAnalysisInput = {
  userQuery: string;
  relatedKnowledge: string[];
};

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasComparison(query: string) {
  return /\b(vs|versus|compare|comparison)\b/i.test(query) || /对比|比较|差异|哪个更|哪一个更/.test(query);
}

function hasMultipleQuestions(query: string) {
  return query.split(/[?？]/).map((part) => part.trim()).filter(Boolean).length > 1;
}

function hasDependentConclusion(query: string) {
  return /\b(then conclude|conclude whether|decide whether|recommend whether)\b/i.test(query) ||
    /然后.*结论|再.*判断|是否.*影响|能否.*决策/.test(query);
}

function isObviouslyBroad(query: string) {
  return query.length > 120 || /\b(facts?|verify|evidence|compare|conclude|limitations?|workflow)\b/i.test(query) && /\b(and|then)\b/i.test(query);
}

export function analyzeTask(input: TaskAnalysisInput): TaskAnalysis {
  const query = normalize(input.userQuery);
  const reasons: string[] = [];
  if (!query) return { mode: "SINGLE_TASK", reasons: ["empty query"] };
  if (hasComparison(input.userQuery)) reasons.push("compares multiple entities");
  if (hasMultipleQuestions(input.userQuery)) reasons.push("contains multiple independent questions");
  if (hasDependentConclusion(input.userQuery)) reasons.push("final conclusion depends on prior facts");
  if (isObviouslyBroad(input.userQuery)) reasons.push("single objective would be too broad");
  if (input.relatedKnowledge.length > 0 && reasons.length > 0) reasons.push("related memory can narrow one or more subtasks");
  return {
    mode: reasons.length > 0 ? "DECOMPOSE" : "SINGLE_TASK",
    reasons,
  };
}
