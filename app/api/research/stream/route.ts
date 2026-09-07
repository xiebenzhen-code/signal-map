import { handleResearchStream } from "@/backend/handlers";

export async function GET(request: Request) {
  return handleResearchStream(request);
}

export async function POST(request: Request) {
  return handleResearchStream(request);
}
