import { socialAccessLayer } from "@/social/providers";

export async function GET() {
  const connections = await socialAccessLayer.getConnectionStatuses();
  return Response.json(
    { connections },
    { headers: { "Cache-Control": "no-store" } },
  );
}
