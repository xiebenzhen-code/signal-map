import { handleRuntimeStatus } from "@/backend/handlers";

export async function GET() {
  return handleRuntimeStatus();
}
