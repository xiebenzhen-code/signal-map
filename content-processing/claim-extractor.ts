import type { CleanedContent, ExtractedClaim } from "./types.ts";

const actionPattern = /发布|新增|更新|推出|上线|开放|停止|变更|支持|集成|招聘|岗位|\b(?:launch(?:ed|es|ing)?|release(?:d|s)?|updat(?:ed|es|ing)|announce(?:d|s)?|add(?:ed|s)?|introduc(?:ed|es|ing)|support(?:s|ed)?|open role|job opening|hiring|lists?)\b/i;

function sentences(value: string) {
  return value
    .split(/(?<=[。.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function hasSubjectAndAction(sentence: string) {
  const hasSubject = /[\p{L}\p{N}]{2,}/u.test(sentence);
  return hasSubject && actionPattern.test(sentence);
}

function actionCenteredStatement(sentence: string) {
  const action = sentence.match(/\b(launch(?:ed|es|ing)?|release(?:d|s)?|updat(?:ed|es|ing)|announce(?:d|s)?|add(?:ed|s)?|introduc(?:ed|es|ing)|support(?:s|ed)?|open role|job opening|hiring|lists?)\b/i);
  if (action?.index !== undefined) {
    const actionWord = action[1].toLowerCase();
    const startsAtAction = /ing$|open role|job opening|hiring/.test(actionWord);
    const prefixStart = startsAtAction
      ? action.index
      : Math.max(sentence.lastIndexOf(".", action.index), sentence.lastIndexOf("。", action.index), sentence.lastIndexOf("\n", action.index), action.index - 80) + 1;
    return sentence
      .slice(prefixStart, action.index + 220)
      .replace(/\s+(Announcements|Newsroom|Related|Recommended)\b[\s\S]*$/i, "")
      .trim();
  }
  const chinese = sentence.match(/([^。.!?]{0,120}(?:发布|新增|更新|推出|上线|开放|停止|变更|支持|集成|招聘|岗位)[^。.!?]{0,180})/)?.[1];
  if (chinese) return chinese.trim();
  return sentence;
}

export function extractClaim(cleaned: CleanedContent, title: string): ExtractedClaim {
  if (cleaned.quality !== "VALID") {
    return { statement: "", quality: "INSUFFICIENT_CONTENT", failureReason: cleaned.failureReason };
  }
  const titleKey = title.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
  const candidate = sentences(cleaned.mainContent).map(actionCenteredStatement).find((sentence) => {
    const sentenceKey = sentence.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
    return sentenceKey !== titleKey && !/^(Announcements|Newsroom|Related|Recommended)\b/i.test(sentence) && hasSubjectAndAction(sentence);
  });
  if (!candidate) {
    return {
      statement: "",
      quality: "INSUFFICIENT_CONTENT",
      failureReason: "NO_SUPPORTED_CLAIM",
    };
  }
  return {
    statement: candidate.length > 220 ? `${candidate.slice(0, 217)}…` : candidate,
    quality: "VALID",
  };
}
