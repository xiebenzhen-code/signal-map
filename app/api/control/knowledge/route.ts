import { handleControlKnowledge } from "@/backend/handlers";

export async function GET(request: Request) {
  return handleControlKnowledge(request);
}
