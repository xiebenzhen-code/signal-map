import { handleAuthPasswordRecovery } from "@/backend/handlers";

export async function POST(request: Request) {
  return handleAuthPasswordRecovery(request);
}
