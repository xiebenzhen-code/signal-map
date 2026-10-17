export function describesRecentChange(title: string, summary = "") {
  return /\b(latest|update|updated|new|release|released|announcement|announced|changelog|version|deprecated|deprecation|added|launched|introducing|available|pricing|policy|limitation|v\d+(?:\.\d+)*)\b|发布|更新|上线|推出|新增|调整|弃用|降价|涨价|限制|现已支持/i.test(
    `${title} ${summary}`,
  );
}
