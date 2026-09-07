import { handleAuthLogout } from "@/backend/handlers";

export async function POST(request: Request) {
  return handleAuthLogout(request);
}
