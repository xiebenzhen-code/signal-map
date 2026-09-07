import { handleControlAgentRuns } from "@/backend/handlers";

export async function GET(request: Request) {
  return handleControlAgentRuns(request);
}
