import type { QueryPlan, TopicProfile, TopicRelevance, TopicRelevanceReason } from "./types.ts";

const GENERIC_TERMS = new Set([
  "a",
  "an",
  "and",
  "ai",
  "api",
  "agent",
  "agents",
  "announcement",
  "artificial",
  "artificial intelligence",
  "change",
  "changes",
  "changelog",
  "current",
  "for",
  "from",
  "general",
  "github",
  "information",
  "intelligence",
  "latest",
  "model",
  "models",
  "new",
  "news",
  "notes",
  "official",
  "primary",
  "recent",
  "release",
  "release notes",
  "releases",
  "research",
  "source",
  "technology",
  "the",
  "today",
  "update",
  "updates",
  "what",
  "with",
  "official documentation",
  "documentation",
  "docs",
  "document",
]);

const PROFILE_GENERIC_TERMS = new Set([
  "ai",
  "artificial intelligence",
  "model",
  "models",
  "multimodal",
  "multi modal",
  "observation",
  "observations",
  "workflow",
  "automation",
  "research",
  "paper",
  "dataset",
  "method",
  "system",
]);

const PROFILE_DOMAIN_HINTS = /\b(video|audio|image|text|code|coding|software|developer|medical|health|finance|financial|education|legal|robotics|marketing|security)\b|视频|音频|图像|文本|代码|软件|医疗|健康|金融|教育|法律|机器人|营销|安全/iu;
const PROFILE_TASK_HINTS = /\b(edit|editing|rough cut|shot selection|multi[- ]?(?:asset|clip)|batch|generation|detection|classification|retrieval|summarization|translation|production)\b|剪辑|粗剪|镜头|素材|批量|生成|检测|分类|检索|摘要|翻译/iu;
const TASK_SPECIFIC_PATTERN = /\b(video editing|audio editing|rough cut|shot selection|multi[- ]?(?:asset|clip) understanding|batch processing|production|generation|detection|classification|retrieval|summarization|translation)\b|剪辑|粗剪|镜头选择|素材理解|批量处理|工作流|自动化|生成|检测|分类|检索|摘要|翻译/iu;
const QUESTION_GENERIC_TERMS = new Set([
  ...PROFILE_GENERIC_TERMS,
  "video",
  "editing",
]);
const PROFILE_ANCHOR_INSTRUCTION = /排除|告诉我|为什么|值得|优先|不要|避免|只看|有哪些|什么|过去|最近|当前|现在|exclude|tell|why|worth|prefer|avoid|only|what|recent|latest/iu;

function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningful(term: string) {
  if (GENERIC_TERMS.has(term)) return false;
  if (/^[a-z0-9 ]+$/.test(term)) return term.replace(/\s/g, "").length >= 3;
  return term.length >= 2;
}

function topicTerms(plan: QueryPlan) {
  const values = [
    plan.originalNeed,
    ...plan.coreKeywords,
    ...plan.englishKeywords,
    ...plan.synonyms,
    ...plan.entities,
    ...(plan.aliasesConsidered || []),
    ...plan.industryKeywords,
  ];
  const terms = new Set<string>();
  for (const value of values) {
    const normalized = normalize(value);
    if (meaningful(normalized)) terms.add(normalized);
    for (const token of normalized.split(" ")) {
      if (meaningful(token)) terms.add(token);
    }
  }
  return [...terms].sort((left, right) => right.length - left.length);
}

function matches(text: string, term: string) {
  if (!/[a-z0-9]/i.test(term)) return text.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, "i").test(text);
}

function isTaskAnchor(term: string) {
  const normalized = normalize(term);
  return normalized.length > 2 && !PROFILE_GENERIC_TERMS.has(normalized) && TASK_SPECIFIC_PATTERN.test(normalized);
}

// Morphological + qualifier tolerance so a real-language variant of a task
// concept (e.g. "Agentic Video Editing", "video editor") can match a task
// anchor ("AI video editing"). Strictly scoped to the profile's task anchors,
// so a bare "AI" or "video" still cannot satisfy the task half.
function taskConceptStem(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/\b(?:agentic|ai[- ]?(?:assisted|powered|driven|native)?|artificial[- ]intelligence)\b/g, " ")
    .replace(/\bedit(?:or|ing|s|ed)?\b/g, "edit")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesTaskVariant(textStem: string, taskStem: string) {
  const index = textStem.indexOf(taskStem);
  if (index < 0) return false;
  const preceding = textStem.slice(Math.max(0, index - 32), index);
  return !(/\b(?:no|not|without|none)\s*$/i.test(preceding) || /(?:无|没有|不是|不含)\s*$/u.test(preceding));
}

const CJK_STOP_CHARS = "与和或的以及之在对于有是";
const CJK_CONNECTIVES = "与和或的以及之跟同并及";

/**
 * Words that name *interrogation intent* or broad domain vocabulary rather
 * than a task constraint: "哪些版本" asks which, "模型更新" is the domain
 * register, "30d" is the freshness window. Admitting them as constraints
 * rejects real change evidence (e.g. a release note that never says
 * "版本"). Question-object words ("版本","升级") and register nouns
 * ("模型","开源","工具") are deliberately excluded; concrete task nouns
 * ("结账","支付","checkout","payment") are kept.
 */
const CONSTRAINT_STOP_TERMS = new Set([
  // question objects and intent words
  "版本", "升级", "哪些", "有哪", "有哪些", "什么", "为什么", "如何", "怎么", "值得", "安排", "动态",
  "变化", "变更", "更新", "发布", "推出", "上线", "最近", "过去", "未来", "当前",
  "现在", "今天", "昨天", "本周", "本月", "一个", "个月", "新闻", "公告",
  // broad domain register
  "模型", "生成", "成式", "基础", "开源", "开发", "工具", "功能", "特性",
  "改版", "版本号", "个版",
  // latin equivalents
  "version", "versions", "upgrade", "upgrades", "update", "updates", "release",
  "releases", "released", "change", "changes", "recent", "latest", "current",
  "news", "announcement", "announcements", "model", "models", "tool", "tools",
]);
const CONSTRAINT_TIME_PATTERN = /^(?:\d+[a-z]{1,2}|\d{2,4})$/i;

function hasCjk(text: string) {
  return /[\u3400-\u9fff]/u.test(text);
}

/**
 * Extract candidate task-constraint terms from planner-designated values.
 * - Entity names (and their aliases) are excluded: "show me Shopify" is a
 *   subject, not a task constraint.
 * - GENERIC_TERMS are skipped so generic registries ("release") do not become
 *   constraints, while specific latin terms ("launch", "checkout") survive.
 * - CJK runs are split into 2-grams so a compound like "结账与支付" matches a
 *   text naming either half ("结账", "支付").
 */
/**
 * Candidate task-constraint *words* from planner-designated entries.
 * - Entity names (and their aliases) are excluded: "show me Shopify" is a
 *   subject, not a task constraint.
 * - GENERIC_TERMS / stop terms / time windows ("30d") are skipped so generic
 *   registers ("release", "最近") do not constrain, while specific words
 *   ("checkout", "结账", "launch") survive.
 * - CJK compounds split on connectives ("结账与支付" -> 结账 / 支付); each
 *   fragment must be a short word. Longer narrative phrases ("开源开发与
 *   工具", "值得我测试的") contribute nothing: their 2-grams would otherwise
 *   fabricate constraints like "发与" that reject real change evidence.
 * - Only short, clause-free entries are read: a narrative question
 *   ("ComfyUI 最近一个月在 GitHub 发布了哪些版本？…") is not a constraint
 *   list.
 */
function constraintTermsFrom(values: string[], entities: Set<string>): string[] {
  const terms = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (/[?？。，,；;、]/.test(value)) continue;
    const normalized = normalize(value);
    if (!normalized) continue;
    for (const run of normalized.match(/[\u3400-\u9fff]+/gu) || []) {
      const trimmed = run.replace(
        new RegExp(`^[${CJK_STOP_CHARS}]+|[${CJK_STOP_CHARS}]+$`, "gu"),
        "",
      );
      if (!trimmed) continue;
      const fragments = trimmed.split(new RegExp(`[${CJK_CONNECTIVES}]`, "u")).filter(Boolean);
      for (const fragment of fragments) {
        if (fragment.length < 2 || fragment.length > 3) continue;
        if (CONSTRAINT_STOP_TERMS.has(fragment)) continue;
        terms.add(fragment);
      }
    }
    for (const token of normalized.split(" ")) {
      if (!token || !/^[a-z0-9]+$/i.test(token)) continue;
      if (GENERIC_TERMS.has(token) || entities.has(token)) continue;
      if (CONSTRAINT_STOP_TERMS.has(token) || CONSTRAINT_TIME_PATTERN.test(token)) continue;
      // A multi-word latin phrase ("AI developer tools", "official update")
      // names the domain register, not a task; only compact entries
      // ("checkout", "payment", "coding") carry a task constraint.
      if (normalized.split(" ").length > 2) break;
      terms.add(token);
    }
  }
  return [...terms].filter((term) => !entities.has(term));
}

/**
 * Gate constraints come from the planner's core keywords only — the entries
 * that name what the answer must be about. synonyms and topicKeywords stay in
 * the topic-term vocabulary (they broaden discovery), but as constraints they
 * over-constrain with register nouns ("模型更新"). originalNeed only fills a
 * language family the core keywords left empty, so a Chinese question with an
 * English evidence stream ("Generate and create … Premiere …") is not judged
 * on narrative words.
 */
function taskConstraintTerms(plan: QueryPlan): string[] {
  const entities = new Set(
    [
      ...plan.entities,
      ...(plan.aliasesConsidered || []),
      ...(plan.resolvedEntities ?? []).flatMap((entity) => [entity.canonicalEntity, ...entity.aliasesConsidered]),
    ]
      .map((value) => normalize(value))
      .filter(Boolean),
  );
  const planned = constraintTermsFrom(plan.coreKeywords || [], entities);
  const plannedHasCjk = planned.some((term) => hasCjk(term));
  const plannedHasLatin = planned.some((term) => !hasCjk(term));
  const fallback = plan.originalNeed
    ? constraintTermsFrom([plan.originalNeed], entities).filter((term) =>
      hasCjk(term) ? !plannedHasCjk : !plannedHasLatin)
    : [];
  return [...new Set([...planned, ...fallback])];
}

function isUsableProfileAnchor(term: string) {
  const raw = term.trim();
  const normalized = normalize(raw);
  return Boolean(normalized) && raw.length <= 80 &&
    !PROFILE_ANCHOR_INSTRUCTION.test(raw) &&
    !(normalized.split(" ").length > 8) &&
    !(raw.length > 24 && /[\u3400-\u9fff]/u.test(raw));
}

function domainParts(term: string) {
  const normalized = normalize(term);
  const parts = normalized.split(" ").filter((part) => /^(video|audio|image|text|code|software|developer|medical|health|finance|education|legal|robotics|marketing|security)$/i.test(part));
  return parts.length ? parts : [normalized];
}

export function isGenericQuestionTerm(term: string) {
  return QUESTION_GENERIC_TERMS.has(normalize(term));
}

function topicProfile(plan: QueryPlan): { profile: TopicProfile; explicit: boolean } {
  if (plan.topicProfile) {
    const genericTerms = new Set(plan.topicProfile.genericTerms.map(normalize));
    const cleanDomainInputs = plan.topicProfile.domainAnchors.filter(isUsableProfileAnchor);
    const cleanTaskInputs = plan.topicProfile.taskAnchors.filter(isUsableProfileAnchor);
    const domainAnchors = [...new Set(cleanDomainInputs
      .flatMap(domainParts)
      .filter((term) => term.length > 1 && !PROFILE_GENERIC_TERMS.has(term) && !genericTerms.has(term)))];
    const taskAnchors = [...new Set([...cleanDomainInputs, ...cleanTaskInputs]
      .map(normalize)
      .filter((term) => isTaskAnchor(term) && !genericTerms.has(term)))];
    const taskSet = new Set(taskAnchors);
    return {
      profile: {
        domainAnchors: domainAnchors.filter((term) => !taskSet.has(term)),
        taskAnchors,
        genericTerms: [...genericTerms],
      },
      explicit: true,
    };
  }
  const candidates = [
    ...(plan.topicAnchors || []),
    ...(plan.topicKeywords || []),
    ...plan.industryKeywords,
  ].map((term) => normalize(term)).filter(Boolean);
  const words = [...new Set(candidates.flatMap((term) => term.split(" ")))]
    .filter((term) => term.length > 1);
  return {
    profile: {
      domainAnchors: [...new Set([
        ...candidates.filter((term) => PROFILE_DOMAIN_HINTS.test(term)),
        ...words.filter((term) => PROFILE_DOMAIN_HINTS.test(term)),
      ])],
      taskAnchors: [...new Set([
        ...candidates.filter((term) => PROFILE_TASK_HINTS.test(term)),
        ...words.filter((term) => PROFILE_TASK_HINTS.test(term) && !PROFILE_GENERIC_TERMS.has(term)),
      ])],
      genericTerms: [...PROFILE_GENERIC_TERMS],
    },
    explicit: false,
  };
}

export function assessTopicRelevance(text: string, plan: QueryPlan): TopicRelevance {
  const normalizedText = normalize(text);
  const { profile, explicit } = topicProfile(plan);
  const matchedDomainAnchors = profile.domainAnchors.filter((term) => matches(normalizedText, normalize(term)));
  const matchedTaskAnchors = profile.taskAnchors.filter((term) => matches(normalizedText, normalize(term)));
  const matchedGenericTerms = profile.genericTerms
    .map(normalize)
    .filter((term) => term && matches(normalizedText, term));
  const matchedTerms = [...new Set([...matchedDomainAnchors, ...matchedTaskAnchors])];
  const matchedQueryTerms = topicTerms(plan).filter((term) => matches(normalizedText, term));
  if (explicit) {
    const hasDomainAnchors = profile.domainAnchors.length > 0;
    const hasTaskAnchors = profile.taskAnchors.length > 0;
    const domainMatch = matchedDomainAnchors.length > 0;
    const taskTextStem = taskConceptStem(normalizedText);
    const variantTaskMatch = profile.taskAnchors.some((anchor) => {
      const stem = taskConceptStem(normalize(anchor));
      return Boolean(stem) && matchesTaskVariant(taskTextStem, stem);
    });
    const taskMatch = matchedTaskAnchors.length > 0 || variantTaskMatch;
    const distinctAnchorMatch = matchedDomainAnchors.some((domain) =>
      matchedTaskAnchors.some((task) => domain !== task),
    ) || (domainMatch && variantTaskMatch);
    const decision = hasDomainAnchors && hasTaskAnchors && domainMatch && taskMatch && distinctAnchorMatch
      ? "MATCH"
      : "TOPIC_MISMATCH";
    const reason: TopicRelevanceReason = !hasDomainAnchors
      ? "MISSING_DOMAIN_ANCHOR"
      : !hasTaskAnchors
        ? "MISSING_TASK_ANCHOR"
        : !domainMatch
          ? "MISSING_DOMAIN_ANCHOR"
          : !taskMatch
            ? "MISSING_TASK_ANCHOR"
            : !distinctAnchorMatch
              ? "NO_DOMAIN_OR_TASK_ANCHOR_MATCH"
              : "DOMAIN_AND_TASK_ANCHOR_MATCH";
    return {
      decision,
      reason,
      matchedTerms,
      matchedDomainAnchors,
      matchedTaskAnchors,
      matchedGenericTerms,
      matchedQueryTerms,
      relevanceGateApplied: true,
      relevanceGatePassed: decision === "MATCH",
      score: decision === "MATCH"
        ? Math.min(100, 70 + matchedTerms.length * 10)
        : 0,
    };
  }
  const terms = topicTerms(plan);
  const legacyMatchedTerms = terms.filter((term) => matches(normalizedText, term));
  const entities = [...plan.entities, ...(plan.resolvedEntities ?? []).flatMap((entity) =>
    [entity.canonicalEntity, ...entity.aliasesConsidered])].map(normalize).filter(meaningful);
  const hasEntityMatch = entities.some((term) => matches(normalizedText, term));
  const hasTopicTerms = terms.length > 0;
  // Task constraints gate on what the user asked the evidence to be about.
  // Constraints that share no language family with the text (a Chinese plan
  // against an English changelog) cannot be judged and are skipped rather than
  // rejected; explicit subject-only material still passes via the entity gate.
  const taskConstraints = taskConstraintTerms(plan);
  const textIsCjk = hasCjk(normalizedText);
  const applicableConstraints = taskConstraints.filter((constraint) => hasCjk(constraint) === textIsCjk);
  const matchedTaskConstraints = applicableConstraints.filter((constraint) => matches(normalizedText, constraint));
  const subjectSatisfied = !entities.length || hasEntityMatch;
  const taskSatisfied = applicableConstraints.length === 0 || matchedTaskConstraints.length > 0;
  const topicSatisfied = !hasTopicTerms || legacyMatchedTerms.length > 0;
  const decision = subjectSatisfied && taskSatisfied && topicSatisfied
    ? "MATCH"
    : "TOPIC_MISMATCH";
  return {
    decision,
    reason: !taskSatisfied
      ? "NO_TASK_CONSTRAINT_MATCH"
      : !hasTopicTerms
        ? "NO_TOPIC_TERMS"
        : legacyMatchedTerms.length
          ? "LEGACY_QUERY_TERM_MATCH"
          : "NO_QUERY_TERM_MATCH",
    matchedTerms: legacyMatchedTerms,
    matchedDomainAnchors,
    matchedTaskAnchors,
    matchedGenericTerms,
    matchedQueryTerms: legacyMatchedTerms,
    matchedTaskConstraints,
    relevanceGateApplied: false,
    relevanceGatePassed: decision === "MATCH",
    score: !hasTopicTerms ? 50 : legacyMatchedTerms.length ? Math.min(100, 60 + legacyMatchedTerms.length * 15) : 0,
  };
}
