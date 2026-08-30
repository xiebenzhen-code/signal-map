import { socialAccessLayer } from "@/social/providers";
import { toPublicConnectionStatus } from "@/social/access/public-connection";

export async function GET() {
  const connections = (await socialAccessLayer.getConnectionStatuses())
    .map(toPublicConnectionStatus);
  return Response.json(
    { connections },
    { headers: { "Cache-Control": "no-store" } },
  );
}
