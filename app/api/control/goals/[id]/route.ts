import { handleControlGoals } from "@/backend/handlers";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  return handleControlGoals(request, params.id);
}
