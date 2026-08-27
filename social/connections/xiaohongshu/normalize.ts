import type { LiveItem, SocialProfile } from "../../providers/types";

type JsonRecord = Record<string, unknown>;

export function xhsItems(payload: unknown): LiveItem[] {
  const body = (payload || {}) as JsonRecord;
  const root = (body.data || body) as JsonRecord | unknown[];
  const candidates = Array.isArray(root)
    ? root
    : ((root.feeds || root.items || root.data || []) as unknown[]);
  return candidates.slice(0, 20).flatMap((candidate) => {
    const item = candidate as JsonRecord;
    const card = (item.note_card || item.noteCard || item) as JsonRecord;
    const user = (card.user || {}) as JsonRecord;
    const interact = (card.interact_info || card.interactInfo || {}) as JsonRecord;
    const id = String(item.id || item.feed_id || card.id || "");
    const xsec = String(item.xsec_token || item.xsecToken || "");
    if (!id) return [];
    return [{
      id,
      title: String(card.display_title || card.title || "Xiaohongshu post"),
      url: `https://www.xiaohongshu.com/explore/${id}${xsec ? `?xsec_token=${encodeURIComponent(xsec)}` : ""}`,
      snippet: `${String(user.nickname || user.nick_name || "Xiaohongshu user")} · ${String(interact.liked_count || interact.likedCount || 0)} likes`,
      source: "Xiaohongshu",
      publishedAt: String(card.time || item.time || new Date().toISOString()),
      channel: "社区",
      authority: 58,
      origin: "xhs",
    } satisfies LiveItem];
  });
}

export function xhsProfile(payload: unknown): SocialProfile | null {
  const body = (payload || {}) as JsonRecord;
  const data = (body.data || body) as JsonRecord;
  const id = String(data.id || data.user_id || data.userId || "");
  const name = String(data.nickname || data.name || "");
  if (!id && !name) return null;
  return {
    id: id || name,
    name: name || id,
    handle: String(data.red_id || data.redId || "") || undefined,
    description: String(data.desc || data.description || "") || undefined,
    url: id ? `https://www.xiaohongshu.com/user/profile/${id}` : undefined,
    source: "xhs",
  };
}

export function isLoggedIn(payload: unknown) {
  const root = (payload || {}) as JsonRecord;
  const data = (root.data || {}) as JsonRecord;
  return Boolean(
    root.loggedIn || root.logged_in || root.isLoggedIn ||
    data.loggedIn || data.logged_in || data.isLoggedIn,
  );
}
