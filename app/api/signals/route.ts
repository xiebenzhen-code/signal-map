import { runResearchPipeline } from "@/research/research-pipeline";

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
    });
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error: "Research Pipeline 未能完成。",
        reason:
          error instanceof Error
            ? error.message
            : "发生无法识别的检索错误。",
      },
      { status: 502 },
    );
  }
}
