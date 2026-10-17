export function decodeHtmlText(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripHtmlForDetail(value: string) {
  return decodeHtmlText(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

export function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeHtmlText(
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ||
      html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"))?.[1] ||
      "",
  );
}

export function htmlTitle(html: string) {
  return decodeHtmlText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

export function isThinDetail(value?: string) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  return normalized.length < 80;
}
