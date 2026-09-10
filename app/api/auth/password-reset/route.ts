import { handleAuthPasswordReset } from "@/backend/handlers";

export async function POST(request: Request) {
  return handleAuthPasswordReset(request);
}
