import { handleConnections } from "@/backend/handlers";

export async function GET() {
  return handleConnections();
}
