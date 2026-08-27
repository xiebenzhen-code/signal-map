import { planQuery } from "@/research/query-planner";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const industry = (params.get("industry") || "").trim();
  if (!industry) {
    return Response.json({ error: "缺少自然语言需求" }, { status: 400 });
  }
  return Response.json(
    {
      queryPlan: planQuery({
        identity: (params.get("identity") || params.get("role") || "").trim(),
        industry,
        focusAreas: (params.get("focusAreas") || params.get("interests") || "").trim(),
        currentQuestions: (params.get("currentQuestions") || "").trim(),
        knownInformation: (params.get("knownInformation") || "").trim(),
        informationGaps: (params.get("informationGaps") || "").trim(),
        trackedEntities: (params.get("trackedEntities") || "").trim(),
        trackedEvents: (params.get("trackedEvents") || "").trim(),
        userJudgements: (params.get("userJudgements") || "").trim(),
        evidenceHistory: (params.get("evidenceHistory") || "").trim(),
        freshnessWindow: (params.get("freshnessWindow") || "7d").trim(),
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
