import { socialAccessLayer, type SocialProvider } from "@/social/providers";

type ProviderId = SocialProvider["id"];

function providerId(value: string): ProviderId | null {
  if (value === "x") return "x";
  if (value === "xiaohongshu") return "xiaohongshu";
  return null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ provider: string; id: string }> },
) {
  const params = await context.params;
  const provider = providerId(params.provider);
  if (!provider) return Response.json({ error: "Unknown provider" }, { status: 404 });
  const post = await socialAccessLayer.getPost(provider, params.id);
  return post
    ? Response.json({ post }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "Post not found or provider unavailable" }, { status: 404 });
}
