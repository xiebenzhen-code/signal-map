import { handlePostgresTransportProbe } from "@/backend/postgres-transport-probe";

export async function POST(request: Request) {
  return handlePostgresTransportProbe(request);
}
