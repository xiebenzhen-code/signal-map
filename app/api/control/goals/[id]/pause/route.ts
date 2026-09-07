import { handleControlGoalAction } from "@/backend/handlers";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  return handleControlGoalAction(request, params.id, "pause");
}
