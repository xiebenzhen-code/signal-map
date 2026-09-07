import { handleControlGoals } from "@/backend/handlers";

export async function GET(request: Request) {
  return handleControlGoals(request);
}
