import { handleControlNotificationRead } from "@/backend/handlers";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  return handleControlNotificationRead(request, params.id);
}
