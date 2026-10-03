import { proxyApiRequest } from "@/backend/api-proxy";

export async function GET(request: Request) {
  return proxyApiRequest(request);
}
export async function POST(request: Request) {
  return proxyApiRequest(request);
}
