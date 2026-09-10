import { handleAuthPasswordUpdate } from "@/backend/handlers";

export async function POST(request: Request) {
  return handleAuthPasswordUpdate(request);
}
