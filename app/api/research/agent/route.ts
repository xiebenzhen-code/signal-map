import { proxyApiRequest } from "@/backend/api-proxy";

export async function POST(request: Request) {
  return proxyApiRequest(request);
}