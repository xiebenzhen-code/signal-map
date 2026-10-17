import { handleResearchPlan } from "@/backend/handlers";

export async function GET(request: Request) {
  return handleResearchPlan(request);
}

export async function POST(request: Request) {
  return handleResearchPlan(request);
}
