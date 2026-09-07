import { handleAuthLogin } from "@/backend/handlers";

export async function POST(request: Request) {
  return handleAuthLogin(request);
}
