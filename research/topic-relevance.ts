import type { QueryPlan, TopicProfile, TopicRelevance, TopicRelevanceDecision, TopicRelevanceReason } from "./types.ts";
import { registeredPublisherNames } from "../source-registry/feed-catalog.ts";

export const GENERIC_TERMS = new Set([
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

export function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matches(text: string, term: string) {
  if (!/[a-z0-9]/i.test(term)) return text.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, "i").test(text);
}

function meaningful(term: string) {
  if (GENERIC_TERMS.has(term)) return false;
  if (/^[a-z0-9 ]+$/.test(term)) return term.replace(/\s/g, "").length >= 3;
  return term.length >= 2;
}

function excludedEntitiesOf(plan: QueryPlan): string[] {
  return [...new Set((plan.excludedEntities ?? []).map((value) => normalize(value)).filter(Boolean))];
}

function isExcludedEntityTerm(term: string, excluded: string[]) {
  if (!excluded.length) return false;
  const normalized = normalize(term);
  return excluded.some((entity) => entity === normalized);
}

function excludedEntityMatches(text: string, excluded: string[]) {
  if (!excluded.length) return false;
  return excluded.some((entity) => matches(text, entity));
}

function topicTerms(plan: QueryPlan) {
  const excluded = excludedEntitiesOf(plan);
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
    // An excluded brand ("排除 Shopify") must never become a topic term: the
    // exclusion clause lives in the question text and would otherwise match
    // the very material the user asked to exclude.
    if (meaningful(normalized) && !isExcludedEntityTerm(normalized, excluded)) terms.add(normalized);
    for (const token of normalized.split(" ")) {
      if (meaningful(token) && !isExcludedEntityTerm(token, excluded)) terms.add(token);
    }
  }
  return [...terms].sort((left, right) => right.length - left.length);
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
  "浏览器", "browser", "browsers", "week", "weeks", "month", "months", "day", "days", "year", "years",
  // broad domain register
  "模型", "生成", "成式", "基础", "开源", "开发", "工具", "功能", "特性",
  "改版", "版本号", "个版",
  // latin equivalents
  "version", "versions", "upgrade", "upgrades", "update", "updates", "release",
  "releases", "released", "change", "changes", "recent", "latest", "current",
  "news", "announcement", "announcements", "model", "models", "tool", "tools",
]);
const CONSTRAINT_TIME_PATTERN = /^(?:\d+[a-z]{1,2}|\d{2,4})$/i;

/**
 * Cross-language task-concept groups (generic software/commerce vocabulary,
 * not question-specific): a constraint declared in one language still admits
 * evidence written in another, and an unrelated task in the other language is
 * still rejected. Members are normalized (see normalize()).
 */
const TASK_CONCEPT_GROUPS: string[][] = [
  ["结账", "结帐", "支付", "付款", "付费", "checkout", "checkouts", "payment", "payments", "billing", "bill", "tender", "tenders"],
  ["安全", "security", "secure", "vulnerability", "vulnerabilities", "scan", "scanning"],
  ["订阅", "subscribe", "subscription", "subscriptions"],
  ["性能", "performance", "latency", "throughput"],
  ["许可", "license", "licensing", "licence", "commercial", "商用"],
  ["导出", "export", "exporting"],
  ["迁移", "migration", "migrate"],
  ["权限", "permission", "permissions", "authorization"],
  ["搜索", "检索", "search", "query", "queries"],
];

function conceptGroupOf(term: string): string[][] {
  const normalized = normalize(term);
  return TASK_CONCEPT_GROUPS.filter((group) => group.some((member) => normalize(member) === normalized));
}

/** A constraint matches when any member of its concept group appears in the text. */
function constraintConceptMatches(text: string, constraint: string) {
  const groups = conceptGroupOf(constraint);
  if (!groups.length) return matches(text, constraint);
  return groups.some((group) => group.some((member) => Boolean(normalize(member)) && matches(text, normalize(member))));
}

/** Concept groups activated by any term appearing in the text. Exported for
 *  knowledge read-back selection, which compares the task concepts a stored
 *  fact names against the task concepts the current question asks about. */
export function conceptGroupsInText(text: string): string[][] {
  const groups: string[][] = [];
  for (const group of TASK_CONCEPT_GROUPS) {
    if (group.some((member) => Boolean(normalize(member)) && matches(normalize(text), normalize(member)))) {
      groups.push(group);
    }
  }
  return groups;
}

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
        // Reuse the existing task-concept vocabulary inside compounds, but
        // only when the remainder consists of domain/change wording.
        const concepts = TASK_CONCEPT_GROUPS.flat().filter(member =>
          hasCjk(member) && fragment.includes(member));
        let remainder = fragment;
        for (const term of [...concepts, ...CONSTRAINT_STOP_TERMS].sort((a,b) => b.length-a.length)) {
          remainder = remainder.replaceAll(term, '');
        }
        if (concepts.length && !remainder) {
          for (const concept of concepts) terms.add(concept);
          continue;
        }
        if (fragment.length < 2 || fragment.length > 3) continue;
        if (CONSTRAINT_STOP_TERMS.has(fragment)) continue;
        // Drop fragments carrying a register stop word ("生成式" contains
        // "生成", "视频工具" contains "工具"): the fragment is domain register,
        // not a task.
        if ([...CONSTRAINT_STOP_TERMS].some((stop) => stop.length >= 2 && fragment.includes(stop))) continue;
        terms.add(fragment);
      }
    }
    // Whole latin entries up to three concrete tokens ("video editing",
    // "automatic rough cut"). An entry that contains a generic/register token
    // ("AI developer tools", "official update") names the domain, not a task.
    const latinTokens = normalized.split(" ").filter((token) => /^[a-z0-9]+$/i.test(token));
    if (latinTokens.length > 0 && latinTokens.length <= 3 &&
      latinTokens.every((token) =>
        !GENERIC_TERMS.has(token) && !entities.has(token) &&
        !CONSTRAINT_STOP_TERMS.has(token) && !NON_TASK_FUNCTION_WORDS.has(token) && !CONSTRAINT_TIME_PATTERN.test(token))) {
      terms.add(latinTokens.join(" "));
    }
  }
  return [...terms].filter((term) => !entities.has(term));
}

// Browsing-intent vocabulary: interrogative/time/register words that ask about
// an entity's state without naming a concrete task. A plan whose non-entity
// entries carry no task content is an explicit open-browsing question — its
// material path is the legacy subject+topic match. A plan that names a concrete
// task (or nothing at all beyond the entity) must not default to MATCH when no
// constraint survives extraction.
const BROWSING_WORDS = new Set([
  ...CONSTRAINT_STOP_TERMS,
  ...GENERIC_TERMS,
  "哪", "些", "呢", "吗", "吧", "请", "帮", "下", "一下", "现在", "最近", "最新",
  "今天", "当前", "过去", "未来", "本周", "本月", "动态", "变化", "新动态", "新变化",
  "什么", "有什么", "有哪些", "为什么", "如何", "怎么", "哪些",
  "recent", "latest", "current", "new", "news", "today", "now", "this week",
  "this month", "what", "which", "why", "how", "changes", "change", "update",
  "updates", "released", "release", "releases",
]);
const BROWSING_PHRASES = ["最近", "最新", "新动态", "新变化", "有什么", "有哪些", "什么", "动态", "变化", "更新", "值得", "关注", "推荐", "安排", "最近有", "what's new", "whats new", "what changed", "new changes", "latest update", "release notes"];
const BROWSING_NEED_PATTERN = /最近|最新|新动态|新变化|新消息|有什么|有哪些|什么|动态|变化|更新|现在|今天|当前|过去|未来|值得|关注|推荐|recent|latest|what's new|whats new|what changed|new changes|updates?|changes?|news|released?|推出|发布/iu;

function isBrowsingToken(token: string) {
  if (!token) return false;
  if (GENERIC_TERMS.has(token) || CONSTRAINT_STOP_TERMS.has(token)) return true;
  if (CONSTRAINT_TIME_PATTERN.test(token)) return true;
  if (BROWSING_WORDS.has(token)) return true;
  return BROWSING_PHRASES.some((phrase) => token.includes(phrase));
}

function isBrowsingNeed(need: string) {
  return Boolean(need) && BROWSING_NEED_PATTERN.test(normalize(need));
}

/**
 * Sentence-function words and change/temporal morphology: prepositions,
 * articles, pronouns, copulas and interrogative/auxiliary words never name a
 * task, and neither do change verbs or their inflections ("changed",
 * "updating"). "What changed in Codex?" must not read as a concrete task
 * through "changed" + "in".
 */
const NON_TASK_FUNCTION_WORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "for", "to", "from", "with",
  "without", "by", "as", "than", "into", "onto",
  "is", "are", "was", "were", "be", "been", "am",
  "it", "its", "this", "that", "these", "those", "their", "they", "we",
  "you", "your", "our", "i", "he", "she", "them", "us", "his", "her",
  "what", "which", "why", "how", "when", "where", "who", "whom", "whose",
  "did", "do", "does", "will", "would", "can", "could", "should", "may", "might",
  "changed", "changes", "change", "changing", "latest", "recent", "new",
  "news", "update", "updates", "updated", "updating", "released", "release",
  "releases", "today", "now", "past", "future", "current",
]);

/**
 * A non-entity entry names a task when it carries concrete task content:
 * at least two specific latin tokens ("AI Toolkit security scan" ->
 * toolkit/security/scan) or a task-concept member ("checkout", "security").
 * Browsing wording ("最近有什么新动态"), question modifiers ("优先官方依据"),
 * domain register ("视频工具"), sentence-function words ("What changed in
 * Codex?") and entity-joined phrases ("Premiere和After") are not task content
 * and must not block the open-browsing material path.
 */
function entryNamesTask(entry: string, entities: Set<string>): boolean {
  const latinTokens = entry.split(" ").filter((token) => /^[a-z0-9]+$/i.test(token));
  const concreteLatin = latinTokens.filter((token) =>
    !GENERIC_TERMS.has(token) && !entities.has(token) &&
    !CONSTRAINT_STOP_TERMS.has(token) && !CONSTRAINT_TIME_PATTERN.test(token) &&
    !BROWSING_WORDS.has(token) && !isBrowsingToken(token) &&
    !NON_TASK_FUNCTION_WORDS.has(token));
  if (concreteLatin.length >= 2) return true;
  return TASK_CONCEPT_GROUPS.some((group) =>
    group.some((member) => entry.includes(normalize(member))));
}

/**
 * Task constraints come from the planner's core keywords and synonyms —
 * entries that name what the answer must be about. topicKeywords stay in the
 * topic-term vocabulary (they broaden discovery); originalNeed only fills a
 * language family the others left empty, so a Chinese question with an
 * English evidence stream is not judged on narrative words.
 *
 * `hasNonEntityEntry` records whether the plan declared any *task-bearing*
 * entry beyond the tracked entities: an entry that is entirely browsing
 * wording ("ComfyUI 最近有什么新动态？") names no task, while an entry that
 * names a concrete task ("AI Toolkit security scan") does even when no
 * constraint term survives extraction. A plan that only lists entity names
 * gives no task context at all, and an entity hit alone must not read as
 * task-relevant unless the question itself is an explicit open-browsing ask.
 */
function taskConstraintTerms(plan: QueryPlan): { terms: string[]; hasNonEntityEntry: boolean; openBrowsing: boolean } {
  const entities = new Set(
    [
      ...plan.entities,
      ...(plan.aliasesConsidered || []),
      ...(plan.resolvedEntities ?? []).flatMap((entity) => [entity.canonicalEntity, ...entity.aliasesConsidered]),
    ]
      .map((value) => normalize(value))
      .filter(Boolean),
  );
  const sources = [...(plan.coreKeywords || []), ...plan.synonyms];
  const planned = constraintTermsFrom(sources, entities);
  const plannedHasCjk = planned.some((term) => hasCjk(term));
  const plannedHasLatin = planned.some((term) => !hasCjk(term));
  const fallback = plan.originalNeed
    ? constraintTermsFrom([plan.originalNeed], entities).filter((term) =>
      hasCjk(term) ? !plannedHasCjk : !plannedHasLatin)
    : [];
  const nonEntityEntries = sources.map((value) => normalize(value)).filter((entry) => entry && !entities.has(entry));
  // hasNonEntityEntry = a non-entity entry that was NOT extracted as a
  // constraint (extraction failure on concrete task wording) — same meaning as
  // before: "退货" IS extracted (planned.includes("退货")), so the plan is
  // judgeable; "AI Toolkit security scan" is NOT extractable, so the plan
  // declares task content that tasks cannot be read from.
  const hasNonEntityEntry = nonEntityEntries.some((entry) =>
    !planned.includes(entry) && entry.split(" ").some((token) => !entities.has(token)));
  // openBrowsing = the question explicitly asks about an entity's state
  // without naming a task. A plan whose non-entity entries carry no task
  // content is open browsing, as is a plan with no non-entity entry at all
  // whose original need is a browsing ask. A plan that names concrete task
  // content ("退货", "AI Toolkit security scan") is never open browsing.
  const nonEntityTaskless = nonEntityEntries.length > 0 &&
    nonEntityEntries.every((entry) => !entryNamesTask(entry, entities));
  const openBrowsing = nonEntityEntries.length === 0
    ? isBrowsingNeed(plan.originalNeed ?? "")
    : nonEntityTaskless;
  return { terms: [...new Set([...planned, ...fallback])], hasNonEntityEntry, openBrowsing };
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
  // Explicit profile path: excluded brands never contribute anchors.
  const excluded = excludedEntitiesOf(plan);
  const cleanDomainAnchors = matchedDomainAnchors.filter((term) => !isExcludedEntityTerm(term, excluded));
  const cleanTaskAnchors = matchedTaskAnchors.filter((term) => !isExcludedEntityTerm(term, excluded));
  if (explicit) {
    const hasDomainAnchors = profile.domainAnchors.length > 0;
    const hasTaskAnchors = profile.taskAnchors.length > 0;
    const domainMatch = cleanDomainAnchors.length > 0;
    const taskTextStem = taskConceptStem(normalizedText);
    const variantTaskMatch = profile.taskAnchors.some((anchor) => {
      const stem = taskConceptStem(normalize(anchor));
      return Boolean(stem) && matchesTaskVariant(taskTextStem, stem);
    });
    const taskMatch = cleanTaskAnchors.length > 0 || variantTaskMatch;
    const distinctAnchorMatch = cleanDomainAnchors.some((domain) =>
      cleanTaskAnchors.some((task) => domain !== task),
    ) || (domainMatch && variantTaskMatch);
    // Material whose only anchors are excluded brands is excluded material.
    const onlyExcludedAnchors = (matchedDomainAnchors.length + matchedTaskAnchors.length) > 0 &&
      cleanDomainAnchors.length === 0 && cleanTaskAnchors.length === 0;
    const decision = onlyExcludedAnchors ? "TOPIC_MISMATCH"
      : hasDomainAnchors && hasTaskAnchors && domainMatch && taskMatch && distinctAnchorMatch
        ? "MATCH"
        : "TOPIC_MISMATCH";
    const reason: TopicRelevanceReason = onlyExcludedAnchors
      ? "EXCLUDED_ENTITY"
      : !hasDomainAnchors
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
      matchedTerms: matchedTerms.filter((term) => !isExcludedEntityTerm(term, excluded)),
      matchedDomainAnchors: cleanDomainAnchors,
      matchedTaskAnchors: cleanTaskAnchors,
      matchedGenericTerms,
      matchedQueryTerms: matchedQueryTerms.filter((term) => !isExcludedEntityTerm(term, excluded)),
      relevanceGateApplied: true,
      relevanceGatePassed: decision === "MATCH",
      score: decision === "MATCH"
        ? Math.min(100, 70 + cleanDomainAnchors.length * 10)
        : 0,
    };
  }
  const terms = topicTerms(plan);
  const legacyMatchedTerms = terms.filter((term) => matches(normalizedText, term));
  const entities = [...plan.entities, ...(plan.resolvedEntities ?? []).flatMap((entity) =>
    [entity.canonicalEntity, ...entity.aliasesConsidered])].map(normalize).filter(meaningful);
  const hasEntityMatch = entities.some((term) => matches(normalizedText, term));
  const hasTopicTerms = terms.length > 0;
  const hasExcludedEntityMatch = excludedEntityMatches(normalizedText, excluded);
  // Material about an explicitly excluded brand (and only that brand) is
  // excluded material, regardless of generic task terms it may share.
  const excludedOnlyMatch = hasExcludedEntityMatch && !hasEntityMatch;
  // Task gate: evidence must be on the task the question asked about, not just
  // the tracked entity. Constraints bridge languages through concept groups, so
  // a Chinese constraint still admits an English body naming the same concept
  // (and vice versa). Outcomes:
  //   constraint hit                 -> MATCH
  //   miss, task judgeable (a concept group or plan task context exists)
  //                                -> TOPIC_MISMATCH
  //   miss, nothing judgeable    -> UNCERTAIN: a declared constraint that has no
  //                                concept bridge and no task context must not
  //                                read as relevant through an entity hit.
  //   no constraint at all       -> legacy subject+topic match (tracked-entity
  //                                and open browsing questions stay admissible;
  //                                they simply cannot reach confirmed knowledge
  //                                without a task-relevant verdict upstream).
  const { terms: taskConstraints, hasNonEntityEntry, openBrowsing } = taskConstraintTerms(plan);
  const matchedTaskConstraints = taskConstraints.filter((constraint) => constraintConceptMatches(normalizedText, constraint));
  const conceptBridgeable = taskConstraints.some((constraint) => conceptGroupOf(constraint).length > 0);
  // In broad AI-product research the only extracted task can be "产品".
  // That word cannot prove AI relevance, while literal AI news need not repeat
  // it. Keep this fallback out of named-entity and concrete-task questions.
  const aiMention = /(?:^|[^a-z0-9])ai(?=$|[^a-z0-9])|artificial intelligence|人工智能|大模型/iu;
  // Only a fully recognized broad question may use this fallback. Unknown
  // clauses (subtitles, diagnosis, etc.) stay on the existing task gate.
  const question = (plan.requestedQuestion || "")
    .replace(/保留原始出处和发布日期[，,。]?/g, "")
    .replace(/区分已确认信息与待核对线索[。]?/g, "").trim();
  const withoutTime = question.replace(/^过去\s*\d+\s*天[，,\s]*/u, "");
  const publisherClause = withoutTime.match(/^([^，,？?。；;]+)报道了哪些与/u);
  const publisherOnly = !publisherClause || publisherClause[1].split(/和|、/u)
    .every(name => registeredPublisherNames.some(known => normalize(name) === normalize(known)));
  const subjectQuestion = publisherClause ? withoutTime.slice(publisherClause[0].length) : withoutTime;
  const broadQuestion = publisherOnly && /^(?:国内|中国)?\s*(?:AI|人工智能)\s*(?:产品|产业|工具)(?:或(?:产品|产业|工具))?(?:有关的)?(?:有哪些|有什么)?(?:新进展|新变化|变化|更新)[？?。]?$/iu.test(subjectQuestion);
  const broadAiScope = entities.length === 0 && taskConstraints.length > 0 &&
    taskConstraints.every(term => /^(?:产品|产业|人工智能|人工|智能|国内|中国|新进展)$/.test(term)) &&
    plan.coreKeywords.some(term => aiMention.test(term));
  const broadAiProduct = broadQuestion && broadAiScope;
  const aiSubjectMatch = aiMention.test(text);
  const foreignOnly = /国内|中国/u.test(question) &&
    /美国|英国|德国|柏林|海外|境外|\b(?:Germany|Berlin|United States|United Kingdom|overseas)\b/iu.test(text) &&
    !/国内|中国|中文|\b(?:China|Chinese|domestic)\b/iu.test(text);
  const subjectSatisfied = !entities.length || hasEntityMatch;
  const topicSatisfied = !hasTopicTerms || legacyMatchedTerms.length > 0;
  let decision: TopicRelevanceDecision;
  if (excludedOnlyMatch) {
    decision = "TOPIC_MISMATCH";
  } else if (broadAiProduct) {
    decision = aiSubjectMatch && !foreignOnly ? "MATCH" : "TOPIC_MISMATCH";
  } else if (broadAiScope && plan.requestedQuestion) {
    // Unparsed extra requirements are not permission to fall back to a bare
    // "product" hit. Keep the material uncertain rather than confirming it.
    decision = "UNCERTAIN";
  } else if (!subjectSatisfied || !topicSatisfied) {
    decision = "TOPIC_MISMATCH";
  } else if (taskConstraints.length === 0) {
    // No constraint survived extraction. This is either an explicit open
    // browsing question (legacy subject+topic match stays admissible as
    // material) or constraint-extraction failure on a plan that named task
    // content — the latter must keep the material UNCERTAIN: an entity hit
    // alone is not a task verdict and must not read as confirmed knowledge.
    decision = openBrowsing ? "MATCH" : "UNCERTAIN";
  } else if (matchedTaskConstraints.length > 0) {
    decision = "MATCH";
  } else if (conceptBridgeable || hasNonEntityEntry) {
    decision = "TOPIC_MISMATCH";
  } else {
    decision = "UNCERTAIN";
  }
  return {
    decision,
    reason: broadAiProduct ? (decision === "MATCH" ? "LEGACY_QUERY_TERM_MATCH" : "NO_TASK_CONSTRAINT_MATCH") : excludedOnlyMatch
      ? "EXCLUDED_ENTITY"
      : decision === "TOPIC_MISMATCH" && taskConstraints.length > 0
        ? "NO_TASK_CONSTRAINT_MATCH"
        : decision === "UNCERTAIN"
          ? "UNCERTAIN_TASK_CONSTRAINT"
          : !hasTopicTerms
            ? "NO_TOPIC_TERMS"
            : legacyMatchedTerms.length
              ? "LEGACY_QUERY_TERM_MATCH"
              : "NO_QUERY_TERM_MATCH",
    matchedTerms: broadAiProduct && aiSubjectMatch ? [...new Set([...legacyMatchedTerms, "ai"])] : legacyMatchedTerms,
    matchedDomainAnchors,
    matchedTaskAnchors,
    matchedGenericTerms,
    matchedQueryTerms: legacyMatchedTerms,
    matchedTaskConstraints,
    relevanceGateApplied: false,
    relevanceGatePassed: decision === "MATCH",
    score: broadAiProduct ? (decision === "MATCH" ? 70 : 0) : !hasTopicTerms ? 50 : legacyMatchedTerms.length ? Math.min(100, 60 + legacyMatchedTerms.length * 15) : 0,
  };
}
