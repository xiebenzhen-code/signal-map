import { handleControlFollows } from "@/backend/handlers";

export async function GET(request: Request) {
  return handleControlFollows(request);
}

export async function POST(request: Request) {
  return handleControlFollows(request);
}
