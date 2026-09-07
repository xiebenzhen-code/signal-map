import { handleSocialProfile } from "@/backend/handlers";

export async function GET(
  _request: Request,
  context: { params: Promise<{ provider: string; id: string }> },
) {
  const params = await context.params;
  return handleSocialProfile(params.provider, params.id);
}
