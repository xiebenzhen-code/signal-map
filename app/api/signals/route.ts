import {
  runResearchPipeline,
  type EligibilityAuditFunnel,
} from "@/research/research-pipeline";
import type { CandidateSelectionAudit } from "@/research/candidate-selection";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const industry = (params.get("industry") || "").trim();
  if (!industry) {
    return Response.json(
      { error: "Query Planner 缺少行业或自然语言需求。" },
      { status: 400 },
    );
  }
  try {
    const includeEligibilityAudit =
      process.env.NODE_ENV !== "production" &&
      ["candidate-selection", "eligibility"].includes(params.get("audit") || "");
    const auditOnly = includeEligibilityAudit && params.get("auditOnly") === "1";
    const auditEventId = includeEligibilityAudit
      ? (params.get("auditEventId") || "").trim()
      : "";
    let candidateSelectionAudit: CandidateSelectionAudit[] = [];
    let eligibilityFunnel: EligibilityAuditFunnel | undefined;
    const result = await runResearchPipeline({
      identity: (params.get("identity") || params.get("role") || "").trim(),
      industry,
      focusAreas: (params.get("focusAreas") || params.get("interests") || "").trim(),
      currentQuestions: (params.get("currentQuestions") || "").trim(),
      knownInformation: (params.get("knownInformation") || params.get("projects") || "").trim(),
      informationGaps: (params.get("informationGaps") || params.get("gaps") || "").trim(),
      trackedEntities: (params.get("trackedEntities") || "").trim(),
      trackedEvents: (params.get("trackedEvents") || "").trim(),
      userJudgements: (params.get("userJudgements") || "").trim(),
      evidenceHistory: (params.get("evidenceHistory") || "").trim(),
      freshnessWindow: (params.get("freshnessWindow") || "7d").trim(),
    }, undefined, includeEligibilityAudit
      ? {
          onCandidateSelectionAudit: (audit) => { candidateSelectionAudit = audit; },
          onEligibilityAudit: (audit) => { eligibilityFunnel = audit; },
        }
      : undefined);
    return Response.json(auditOnly
      ? {
          overview: result.overview,
          debug: {
            candidateSelectionAudit: auditEventId
              ? candidateSelectionAudit.filter((audit) => audit.id === auditEventId)
              : candidateSelectionAudit,
            eligibilityFunnel,
          },
        }
      : includeEligibilityAudit
        ? { ...result, debug: { candidateSelectionAudit, eligibilityFunnel } }
        : result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        error: "Research Pipeline 未能完成。",
        reason: "本轮来源检索暂时不可用，请稍后再试。",
      },
      { status: 502 },
    );
  }
}
