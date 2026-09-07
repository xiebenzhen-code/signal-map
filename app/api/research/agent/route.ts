import { handleResearchAgent } from "@/backend/handlers";

export async function POST(request: Request) {
  return handleResearchAgent(request);
}
