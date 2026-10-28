import type { CleanedContent } from "./types.ts";

const noisePatterns = [
  /--[a-z0-9-]+:/i,
  /data-[a-z0-9-]+=/i,
  /\bclass(Name)?=/i,
  /var\(--[a-z0-9-]+\)/i,
  /\b(function|const|let|var)\s+[a-z_$][\w$]*\s*[=(]/i,
];

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(value: string) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(nav|footer|aside|form|header)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
}

function removeTemplateLines(value: string) {
  const seen = new Set<string>();
  const normalized = value
    .replace(/Skip to main content/gi, " ")
    .replace(/Skip to footer/gi, " ")
    .replace(/Press inquiries\s+\S+@\S+/gi, " ")
    .replace(/Non-media inquiries/gi, " ")
    .replace(/How to get support/gi, " ")
    .replace(/Media assets/gi, " ")
    .replace(/Download press kit/gi, " ");
  return normalized
    .split(/\n|(?<=[。.!?])\s+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .map((line) => {
      // RSS can flatten navigation and prose onto one line. Strip only the
      // menu prefix, preserving a following article sentence and punctuation.
      const labels = [...line.matchAll(/媒体品牌|企业号|企业服务|核心服务|城市之窗|政府服务|创投发布|投资人认证|投资人服务|项目推荐|登录|注册|隐私政策|联系我们/g)];
      if (new Set(labels.map(match => match[0])).size < 4) return line;
      const prefix = line.slice(0, labels[0].index);
      if (/发布|新增|更新|推出|上线|支持|集成/.test(prefix)) return line;
      let end = 0;
      for (let index = 1; index < labels.length; index++) {
        const previous = labels[index - 1];
        const gap = line.slice(previous.index! + previous[0].length, labels[index].index);
        if (/发布|新增|更新|推出|上线|支持|集成/.test(gap)) break;
        end = index;
      }
      if (new Set(labels.slice(0, end + 1).map(match => match[0])).size < 4) return line;
      const last = labels[end];
      return line.slice(last.index! + last[0].length).replace(/^[\s|，。！？；:：.!?;·/]+/, "");
    })
    .filter(Boolean)
    .filter((line) => {
      const lower = line.toLowerCase();
      if (/^(home|menu|login|sign in|sign up|subscribe|cookie|privacy|terms|related|recommended|research|policy|commitments|learn|news|try claude|newsroom|导航|登录|注册|菜单|隐私|条款|推荐)$/.test(lower)) {
        return false;
      }
      if (noisePatterns.some((pattern) => pattern.test(line))) return false;
      if ((line.match(/[{}()[\];:=]/g)?.length ?? 0) > Math.max(4, line.length / 10)) return false;
      const key = lower.replace(/[^\p{L}\p{N}]+/gu, "");
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n");
}

export function cleanContent(rawContent: string, fallbackTitle = ""): CleanedContent {
  const raw = rawContent || fallbackTitle;
  const cleanedContent = removeTemplateLines(decodeHtml(stripHtml(raw)))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const mainContent = cleanedContent
    .split("\n")
    .filter((line) => line.length >= 18 || /发布|新增|更新|推出|launch|release|update|announce|add/i.test(line))
    .slice(0, 8)
    .join("\n")
    .trim();
  const semanticText = mainContent || cleanedContent;
  const titleOnly = fallbackTitle && semanticText.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase() === fallbackTitle.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
  const failed =
    semanticText.length < 28 ||
    titleOnly ||
    noisePatterns.some((pattern) => pattern.test(semanticText));
  return {
    rawContent: raw,
    cleanedContent,
    mainContent: semanticText,
    quality: failed ? "INSUFFICIENT_CONTENT" : "VALID",
    failureReason: failed ? "INSUFFICIENT_CONTENT" : undefined,
  };
}
