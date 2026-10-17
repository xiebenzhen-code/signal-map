// Feedback → personal-knowledge record mapping for the detail-modal feedback
// buttons. Semantics are intentionally distinct:
// - already_knew  → KNOWN_INFORMATION ("已知/读过"，不是"不感兴趣")
// - not_useful    → JUDGEMENT ("不感兴趣/无用"，用户判断，不改变可信度)
// - changed_view  → JUDGEMENT (用户判断更新，不等同已核验事实)
// - monitor       → TRACKED_EVENT (持续观察)
export type FeedbackKind = "already_knew" | "not_useful" | "changed_view" | "monitor";

export type FeedbackRecordDraft = {
  type: "KNOWN_INFORMATION" | "JUDGEMENT" | "TRACKED_EVENT";
  text: string;
};

export function feedbackKnowledgeRecord(kind: FeedbackKind, sourceTitle: string): FeedbackRecordDraft {
  const title = sourceTitle.replace(/\s*\r?\n\s*/g, " ").trim();
  if (!title) {
    throw Object.assign(new Error("EMPTY_SOURCE_TITLE"), { code: "EMPTY_SOURCE_TITLE" });
  }
  switch (kind) {
    case "already_knew":
      return { type: "KNOWN_INFORMATION", text: title };
    case "not_useful":
      return { type: "JUDGEMENT", text: `Not useful: ${title}` };
    case "changed_view":
      return { type: "JUDGEMENT", text: `Changed after evidence: ${title}` };
    case "monitor":
      return { type: "TRACKED_EVENT", text: title };
    default:
      throw Object.assign(new Error("UNKNOWN_FEEDBACK_KIND"), { code: "UNKNOWN_FEEDBACK_KIND" });
  }
}

export function feedbackScope(mode: string): "account" | "anonymous-session" {
  return mode === "authenticated" ? "account" : "anonymous-session";
}
