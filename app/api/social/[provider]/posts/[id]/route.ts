import { handleSocialPost } from "@/backend/handlers";

export async function GET(
  _request: Request,
  context: { params: Promise<{ provider: string; id: string }> },
) {
  const params = await context.params;
  return handleSocialPost(params.provider, params.id);
}
