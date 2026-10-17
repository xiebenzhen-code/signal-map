import type { IntentClassification, IntentClassifierInput, ResearchIntent } from "./types.ts";

type Rule = {
  intent: ResearchIntent;
  confidence: number;
  reason: string;
  pattern: RegExp;
};

const rules: Rule[] = [
  { intent: "JOB_SEARCH", confidence: 0.92, reason: "问题要求寻找岗位或投递机会", pattern: /岗位|职位|招聘|求职|内推|job|jobs|career|hiring|opening/i },
  { intent: "AIGC_OPPORTUNITY", confidence: 0.9, reason: "问题关注 AIGC 机会、新赛道或创作者采用", pattern: /AIGC.*(赛道|机会|商业|变现|创作者|视频)|(?:赛道|机会).*AIGC|creator adoption/i },
  { intent: "PRODUCT_UPDATE", confidence: 0.88, reason: "问题关注产品最近更新或发布说明", pattern: /更新|版本|发布|release|changelog|what changed|最近.*(改了|新增|变化)/i },
  { intent: "TECH_RESEARCH", confidence: 0.86, reason: "问题要求评估技术方案、文档或生产可用性", pattern: /技术方案|生产|架构|benchmark|文档|docs|API|SDK|可用性|方案值不值得|production/i },
  { intent: "POLICY_REGULATION", confidence: 0.9, reason: "问题涉及政策、监管或法规生效范围", pattern: /政策|监管|法规|合规|条例|办法|regulation|policy|jurisdiction|effective date/i },
  { intent: "ACADEMIC_RESEARCH", confidence: 0.86, reason: "问题关注论文、学术贡献或实验指标", pattern: /论文|arxiv|paper|conference|benchmark|methodology|学术/i },
  { intent: "COMPETITOR_INTELLIGENCE", confidence: 0.84, reason: "问题关注竞品功能、定价或定位变化", pattern: /竞品|竞争对手|对手|pricing|定位|feature comparison/i },
  { intent: "COMPANY_WATCH", confidence: 0.82, reason: "问题关注公司产品、招聘、融资或战略变化", pattern: /公司|融资|funding|leadership|战略|裁员|招聘动态/i },
  { intent: "MARKET_OPPORTUNITY", confidence: 0.82, reason: "问题关注市场需求、增长或竞争空间", pattern: /市场机会|需求|增长|竞争|growth|market opportunity|demand/i },
  { intent: "TOOL_DISCOVERY", confidence: 0.8, reason: "问题要求发现可用工具或替代方案", pattern: /工具|软件|插件|替代|tool|plugin|directory/i },
  { intent: "LEARNING_PATH", confidence: 0.8, reason: "问题要求学习路径或技能补齐", pattern: /学习|课程|路线|入门|skill gap|learning path|教程/i },
  { intent: "PURCHASE_DECISION", confidence: 0.8, reason: "问题要求购买、选择或评测决策", pattern: /购买|买|评测|review|price|价格|值得买吗|选哪/i },
  { intent: "INDUSTRY_TREND", confidence: 0.78, reason: "问题关注行业趋势或最近方向变化", pattern: /趋势|方向|行业|新变化|trend|赛道/i },
];

function text(input: IntentClassifierInput) {
  return [
    input.userQuery,
    input.currentGoal?.type,
    input.currentGoal?.objective,
    input.filterContext?.industry,
    input.filterContext?.focusAreas,
    input.filterContext?.currentQuestions,
  ].filter(Boolean).join("\n");
}

export function classifyIntent(input: IntentClassifierInput): IntentClassification {
  const target = text(input);
  const matches = rules.filter((rule) => rule.pattern.test(target));
  if (!matches.length) {
    return {
      primaryIntent: "GENERAL_RESEARCH",
      confidence: 0.45,
      reason: "没有稳定命中具体任务类型，使用通用研究",
    };
  }
  const [best, second] = matches.sort((a, b) => b.confidence - a.confidence);
  return {
    primaryIntent: best.confidence >= 0.6 ? best.intent : "GENERAL_RESEARCH",
    secondaryIntent: second?.intent,
    confidence: best.confidence,
    reason: best.reason,
  };
}
