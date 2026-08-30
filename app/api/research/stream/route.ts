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

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        const result = await runResearchPipeline(
          {
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
          },
          (progress) => send("progress", progress),
        );
        send("result", result);
      } catch {
        send("pipeline_error", {
          error: "Research Pipeline 未能完成。",
          reason: "本轮来源检索暂时不可用，请稍后再试。",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
