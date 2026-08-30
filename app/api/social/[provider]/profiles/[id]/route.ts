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
  let profile;
  try {
    profile = await socialAccessLayer.getProfile(provider, params.id);
  } catch {
    return Response.json({ error: "Provider temporarily unavailable" }, { status: 502 });
  }
  return profile
    ? Response.json({ profile }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "Profile not found or provider unavailable" }, { status: 404 });
}
