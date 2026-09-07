import { handleSignals } from "@/backend/handlers";

export async function GET(request: Request) {
  return handleSignals(request);
}

export async function POST(request: Request) {
  return handleSignals(request);
}
