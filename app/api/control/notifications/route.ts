import { handleControlNotifications } from "@/backend/handlers";

export async function GET(request: Request) {
  return handleControlNotifications(request);
}
