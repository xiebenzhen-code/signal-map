import { proxyApiRequest } from "@/backend/api-proxy";

// TEMPORARY production diagnostic. Proxied to the standalone Node backend so
// the probe runs in the same runtime and network position as production login.
// REMOVE AFTER INCIDENT IS RESOLVED.
export async function POST(request: Request) {
  return proxyApiRequest(request);
}
